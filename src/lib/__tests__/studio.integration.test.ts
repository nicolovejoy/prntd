/**
 * Studio read model (studio-plan slice 2) against a real in-memory libSQL.
 * What needs a real DB here: the lane query joins three tables plus the
 * grouped first-chat-turn read (whose bare-column-with-min() shape is
 * SQLite-specific), and `sweepStudioForUser` actually transitions an
 * overdue `image_generation` row / archives an idle design on read.
 *
 * The db is injected directly — getStudioLanesData and sweepStudioForUser
 * both take it as an argument — so no module mocking is needed. Since #204,
 * the sweeps no longer run inside getStudioLanesData (callers schedule them
 * separately via `after()`); tests that depend on swept state call
 * sweepStudioForUser explicitly first, the way a real request's second
 * poll would see it.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/__tests__/test-db";
import { makeUser, makeSourceImage } from "@/lib/__tests__/factories";
import * as schema from "@/lib/db/schema";
import {
  getStudioArchiveData,
  getStudioLanesData,
  laneLastActiveAt,
  sweepStudioForUser,
} from "@/lib/studio";
import { insertGenerationJob, cancelGenerationJob } from "@/lib/generation-job";
import { dayKeyUTC } from "@/lib/generation-quota";

type Db = Awaited<ReturnType<typeof createTestDb>>;
let db: Db;

// sweepStudioForUser (via sweepStaleJobs) has no injectable `now` at these
// call sites — it defaults to the real clock — so times are wall-clock
// relative. Timestamp columns round-trip at seconds precision, so gaps are
// minutes, not milliseconds.
const NOW = new Date(Math.floor(Date.now() / 1000) * 1000);
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60 * 1000);

async function makeOpenDesign(
  userId: string,
  overrides: Partial<typeof schema.design.$inferInsert> = {}
) {
  const [row] = await db
    .insert(schema.design)
    .values({ userId, updatedAt: NOW, ...overrides })
    .returning();
  return row;
}

async function seedRunningJob(
  designId: string,
  userId: string,
  overrides: Partial<Parameters<typeof insertGenerationJob>[0]> = {}
) {
  const res = await insertGenerationJob({
    designId,
    userId,
    operation: "generate",
    imageId: crypto.randomUUID(),
    r2Key: `images/${crypto.randomUUID()}.png`,
    anchorImageId: null,
    generationNumber: 1,
    dayKey: dayKeyUTC(NOW),
    ip: null,
    cost: 0.03,
    now: NOW,
    db,
    ...overrides,
  });
  if (!res.ok) throw new Error("expected insert to succeed");
  return res.job;
}

beforeEach(async () => {
  db = await createTestDb();
  await makeUser(db, "owner");
});

describe("getStudioLanesData", () => {
  it("lanes are only the caller's open conversations", async () => {
    const open = await makeOpenDesign("owner");
    await makeOpenDesign("owner", { closedAt: minutesAgo(5) });
    await makeOpenDesign("owner", { status: "archived" });
    await makeUser(db, "stranger");
    await makeOpenDesign("stranger");

    const lanes = await getStudioLanesData("owner", { db });

    expect(lanes.map((l) => l.designId)).toEqual([open.id]);
  });

  it("orders lanes most recently active first", async () => {
    const older = await makeOpenDesign("owner", { updatedAt: minutesAgo(60) });
    const newer = await makeOpenDesign("owner", { updatedAt: minutesAgo(10) });

    const lanes = await getStudioLanesData("owner", { db });

    expect(lanes.map((l) => l.designId)).toEqual([newer.id, older.id]);
  });

  it("a running job floats an otherwise stale lane to the top", async () => {
    const stale = await makeOpenDesign("owner", { updatedAt: minutesAgo(60) });
    const fresh = await makeOpenDesign("owner", { updatedAt: minutesAgo(10) });
    await seedRunningJob(stale.id, "owner", { now: NOW });

    const lanes = await getStudioLanesData("owner", { db });

    expect(lanes.map((l) => l.designId)).toEqual([stale.id, fresh.id]);
  });

  it("cells run in creation order with the primary marked, seed first", async () => {
    const design = await makeOpenDesign("owner");
    const first = await makeSourceImage(db, {
      designId: design.id,
      ownerId: "owner",
      imageUrl: "https://cdn.example/first.png",
      createdAt: minutesAgo(20),
    });
    const second = await makeSourceImage(db, {
      designId: design.id,
      ownerId: "owner",
      imageUrl: "https://cdn.example/second.png",
      createdAt: minutesAgo(10),
    });
    // A seed carried in from another thread: the image predates this
    // conversation, the link tags it role=seed.
    const seedId = crypto.randomUUID();
    await db.insert(schema.image).values({
      id: seedId,
      ownerId: "owner",
      imageUrl: "https://cdn.example/seed.png",
      aspectRatio: "1:1",
      createdAt: minutesAgo(120),
    });
    await db.insert(schema.conversationImage).values({
      designId: design.id,
      imageId: seedId,
      role: "seed",
    });
    await db
      .update(schema.design)
      .set({ primaryImageId: second })
      .where(eq(schema.design.id, design.id));

    const [lane] = await getStudioLanesData("owner", { db });

    expect(lane.cells.map((c) => c.imageId)).toEqual([seedId, first, second]);
    expect(lane.cells.map((c) => c.isPrimary)).toEqual([false, false, true]);
  });

  it("running jobs render as pending cells; cancelled ones do not", async () => {
    const design = await makeOpenDesign("owner");
    const live = await seedRunningJob(design.id, "owner", {
      generationNumber: 1,
    });
    const cancelled = await seedRunningJob(design.id, "owner", {
      generationNumber: 2,
    });
    expect(
      await cancelGenerationJob({ jobId: cancelled.id, userId: "owner", db })
    ).toBe(true);

    const [lane] = await getStudioLanesData("owner", { db });

    expect(lane.pending).toEqual([
      { jobId: live.id, generationNumber: 1, startedAt: NOW },
    ]);
  });

  it("a brand-new conversation with only a job in flight is still a lane", async () => {
    const design = await makeOpenDesign("owner");
    const job = await seedRunningJob(design.id, "owner");

    const [lane] = await getStudioLanesData("owner", { db });

    expect(lane.designId).toBe(design.id);
    expect(lane.cells).toEqual([]);
    expect(lane.pending.map((p) => p.jobId)).toEqual([job.id]);
  });

  it("sweeps an overdue running job on read instead of reporting it pending", async () => {
    const design = await makeOpenDesign("owner");
    const job = await seedRunningJob(design.id, "owner", {
      now: minutesAgo(10),
    });

    await sweepStudioForUser("owner", db);
    const [lane] = await getStudioLanesData("owner", { db });

    expect(lane.pending).toEqual([]);
    const [row] = await db
      .select()
      .from(schema.imageGeneration)
      .where(eq(schema.imageGeneration.id, job.id));
    expect(row.status).toBe("failed");
  });

  it("titles a lane with its first user chat turn", async () => {
    const design = await makeOpenDesign("owner");
    await db.insert(schema.chatMessage).values([
      {
        designId: design.id,
        role: "assistant",
        content: "What style?",
        createdAt: minutesAgo(30),
      },
      {
        designId: design.id,
        role: "user",
        content: "geometric wolf head",
        createdAt: minutesAgo(25),
      },
      {
        designId: design.id,
        role: "user",
        content: "make it bigger",
        createdAt: minutesAgo(20),
      },
    ]);

    const [lane] = await getStudioLanesData("owner", { db });

    expect(lane.title).toBe("geometric wolf head");
  });

  it("falls back to the first image prompt, then null, when there is no chat", async () => {
    const withPrompt = await makeOpenDesign("owner", {
      updatedAt: minutesAgo(5),
    });
    await makeSourceImage(db, {
      designId: withPrompt.id,
      ownerId: "owner",
      imageUrl: "https://cdn.example/a.png",
      prompt: "retro sunset",
    });
    await makeOpenDesign("owner", { updatedAt: minutesAgo(10) });

    const lanes = await getStudioLanesData("owner", { db });

    expect(lanes.map((l) => l.title)).toEqual(["retro sunset", null]);
  });

  it("returns [] for a user with no open conversations", async () => {
    expect(await getStudioLanesData("owner", { db })).toEqual([]);
  });
});

describe("laneLastActiveAt", () => {
  it("is the freshest of updatedAt, newest cell, and any running job", () => {
    const base = { updatedAt: minutesAgo(60), cells: [], pending: [] };
    expect(laneLastActiveAt(base)).toEqual(minutesAgo(60));
    expect(
      laneLastActiveAt({
        ...base,
        cells: [{ createdAt: minutesAgo(30) }, { createdAt: minutesAgo(90) }],
      })
    ).toEqual(minutesAgo(30));
    expect(
      laneLastActiveAt({
        ...base,
        cells: [{ createdAt: minutesAgo(30) }],
        pending: [{ startedAt: minutesAgo(1) }],
      })
    ).toEqual(minutesAgo(1));
  });
});

describe("auto-archive on sweepStudioForUser (slice 4)", () => {
  // sweepStudioForUser has no injectable `now` at these call sites — same as
  // the stale-job sweep above — so idleness is wall-clock.
  const daysAgo = (d: number) =>
    new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000);

  it("drops a three-day-idle lane and files it in the archive", async () => {
    const idle = await makeOpenDesign("owner", { updatedAt: daysAgo(4) });
    const active = await makeOpenDesign("owner", { updatedAt: daysAgo(2) });

    await sweepStudioForUser("owner", db);
    const lanes = await getStudioLanesData("owner", { db });

    expect(lanes.map((l) => l.designId)).toEqual([active.id]);
    const archive = await getStudioArchiveData("owner", { db });
    expect(archive.map((a) => a.designId)).toEqual([idle.id]);
  });

  it("keeps a three-day-idle lane whose generation is still running", async () => {
    const idle = await makeOpenDesign("owner", { updatedAt: daysAgo(4) });
    // Started just now, so the stale-job sweep leaves it running.
    await seedRunningJob(idle.id, "owner", { now: NOW });

    await sweepStudioForUser("owner", db);
    const lanes = await getStudioLanesData("owner", { db });

    expect(lanes.map((l) => l.designId)).toEqual([idle.id]);
  });
});

describe("getStudioArchiveData", () => {
  it("lists only the caller's closed conversations, newest closed first", async () => {
    const older = await makeOpenDesign("owner", { closedAt: minutesAgo(90) });
    const newer = await makeOpenDesign("owner", { closedAt: minutesAgo(10) });
    await makeOpenDesign("owner");
    await makeOpenDesign("owner", {
      closedAt: minutesAgo(5),
      status: "archived",
    });
    await makeUser(db, "stranger");
    await makeOpenDesign("stranger", { closedAt: minutesAgo(1) });

    const archive = await getStudioArchiveData("owner", { db });

    expect(archive.map((a) => a.designId)).toEqual([newer.id, older.id]);
    expect(archive[0].closedAt).toEqual(minutesAgo(10));
  });

  it("takes the hero from the primary image, else the newest one", async () => {
    const pinned = await makeOpenDesign("owner", { closedAt: minutesAgo(10) });
    const firstId = await makeSourceImage(db, {
      designId: pinned.id,
      ownerId: "owner",
      imageUrl: "https://cdn.example/pinned.png",
      createdAt: minutesAgo(60),
    });
    await makeSourceImage(db, {
      designId: pinned.id,
      ownerId: "owner",
      imageUrl: "https://cdn.example/newer.png",
      createdAt: minutesAgo(30),
    });
    await db
      .update(schema.design)
      .set({ primaryImageId: firstId })
      .where(eq(schema.design.id, pinned.id));

    const unpinned = await makeOpenDesign("owner", { closedAt: minutesAgo(20) });
    await makeSourceImage(db, {
      designId: unpinned.id,
      ownerId: "owner",
      imageUrl: "https://cdn.example/old.png",
      createdAt: minutesAgo(60),
    });
    await makeSourceImage(db, {
      designId: unpinned.id,
      ownerId: "owner",
      imageUrl: "https://cdn.example/latest.png",
      createdAt: minutesAgo(15),
    });

    const archive = await getStudioArchiveData("owner", { db });

    expect(archive.map((a) => a.heroImageUrl)).toEqual([
      "https://cdn.example/pinned.png",
      "https://cdn.example/latest.png",
    ]);
  });

  it("titles a row like a lane: first user turn, else a prompt, else null", async () => {
    const chatted = await makeOpenDesign("owner", { closedAt: minutesAgo(10) });
    await db.insert(schema.chatMessage).values([
      {
        designId: chatted.id,
        role: "user",
        content: "geometric wolf head",
        createdAt: minutesAgo(80),
      },
      {
        designId: chatted.id,
        role: "user",
        content: "make it bigger",
        createdAt: minutesAgo(70),
      },
    ]);
    const prompted = await makeOpenDesign("owner", { closedAt: minutesAgo(20) });
    await makeSourceImage(db, {
      designId: prompted.id,
      ownerId: "owner",
      imageUrl: "https://cdn.example/p.png",
      prompt: "retro sunset",
    });
    await makeOpenDesign("owner", { closedAt: minutesAgo(30) });

    const archive = await getStudioArchiveData("owner", { db });

    expect(archive.map((a) => a.title)).toEqual([
      "geometric wolf head",
      "retro sunset",
      null,
    ]);
  });

  it("returns [] when nothing is archived", async () => {
    await makeOpenDesign("owner");
    expect(await getStudioArchiveData("owner", { db })).toEqual([]);
  });
});
