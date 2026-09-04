/**
 * Auto-archive sweep (studio-plan slice 4) against a real in-memory libSQL.
 *
 * What needs a real DB here: the sweep's whole job is a conditional UPDATE
 * plus three batched activity reads across four tables, and idempotency is a
 * property of that UPDATE rather than of any pure function.
 *
 * The db is injected directly — sweepIdleConversations takes it as an option,
 * the sweepStaleJobs pattern — so no module mocking is needed.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/__tests__/test-db";
import { makeUser, makeSourceImage } from "@/lib/__tests__/factories";
import * as schema from "@/lib/db/schema";
import {
  ARCHIVE_AFTER_MS,
  sweepIdleConversations,
} from "@/lib/archive-conversations";
import { insertGenerationJob } from "@/lib/generation-job";
import { dayKeyUTC } from "@/lib/generation-quota";

type Db = Awaited<ReturnType<typeof createTestDb>>;
let db: Db;

// Timestamp columns round-trip at seconds precision, so anchor the clock on a
// whole second and express every gap in days/hours.
const NOW = new Date(Math.floor(Date.now() / 1000) * 1000);
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000);

async function makeDesignAt(
  userId: string,
  updatedAt: Date,
  overrides: Partial<typeof schema.design.$inferInsert> = {}
) {
  const [row] = await db
    .insert(schema.design)
    .values({ userId, updatedAt, ...overrides })
    .returning();
  return row;
}

async function closedAtOf(designId: string) {
  const [row] = await db
    .select({ closedAt: schema.design.closedAt })
    .from(schema.design)
    .where(eq(schema.design.id, designId));
  return row.closedAt;
}

beforeEach(async () => {
  db = await createTestDb();
  await makeUser(db, "owner");
});

describe("sweepIdleConversations", () => {
  it("archives a conversation idle past the threshold", async () => {
    const idle = await makeDesignAt("owner", daysAgo(4));

    const result = await sweepIdleConversations({
      scope: "user",
      userId: "owner",
      now: NOW,
      db,
    });

    expect(result.archived).toBe(1);
    expect(result.designIds).toEqual([idle.id]);
    expect(await closedAtOf(idle.id)).toEqual(NOW);
  });

  it("leaves a conversation still inside the threshold open", async () => {
    const recent = await makeDesignAt("owner", daysAgo(2));

    const result = await sweepIdleConversations({
      scope: "user",
      userId: "owner",
      now: NOW,
      db,
    });

    expect(result.archived).toBe(0);
    expect(await closedAtOf(recent.id)).toBeNull();
  });

  it("counts a recent image as activity even when updatedAt is stale", async () => {
    const design = await makeDesignAt("owner", daysAgo(9));
    await makeSourceImage(db, {
      designId: design.id,
      ownerId: "owner",
      imageUrl: "https://cdn.example/fresh.png",
      createdAt: daysAgo(1),
    });

    const result = await sweepIdleConversations({
      scope: "user",
      userId: "owner",
      now: NOW,
      db,
    });

    expect(result.archived).toBe(0);
    expect(await closedAtOf(design.id)).toBeNull();
  });

  it("counts a recent chat turn as activity even when updatedAt is stale", async () => {
    const design = await makeDesignAt("owner", daysAgo(9));
    await db.insert(schema.chatMessage).values({
      designId: design.id,
      role: "user",
      content: "still here",
      createdAt: daysAgo(1),
    });

    const result = await sweepIdleConversations({
      scope: "user",
      userId: "owner",
      now: NOW,
      db,
    });

    expect(result.archived).toBe(0);
    expect(await closedAtOf(design.id)).toBeNull();
  });

  it("never archives a conversation with a running generation", async () => {
    const design = await makeDesignAt("owner", daysAgo(9));
    const res = await insertGenerationJob({
      designId: design.id,
      userId: "owner",
      operation: "generate",
      imageId: crypto.randomUUID(),
      r2Key: `images/${crypto.randomUUID()}.png`,
      anchorImageId: null,
      generationNumber: 1,
      dayKey: dayKeyUTC(NOW),
      ip: null,
      cost: 0.03,
      // Old enough that the job's own start is not recent activity — the
      // running row alone must be what holds the lane open.
      now: daysAgo(9),
      db,
    });
    expect(res.ok).toBe(true);

    const result = await sweepIdleConversations({
      scope: "user",
      userId: "owner",
      now: NOW,
      db,
    });

    expect(result.archived).toBe(0);
    expect(await closedAtOf(design.id)).toBeNull();
  });

  it("archives an idle conversation whose only job already finished", async () => {
    const design = await makeDesignAt("owner", daysAgo(9));
    const res = await insertGenerationJob({
      designId: design.id,
      userId: "owner",
      operation: "generate",
      imageId: crypto.randomUUID(),
      r2Key: `images/${crypto.randomUUID()}.png`,
      anchorImageId: null,
      generationNumber: 1,
      dayKey: dayKeyUTC(NOW),
      ip: null,
      cost: 0.03,
      now: daysAgo(9),
      db,
    });
    if (!res.ok) throw new Error("expected insert to succeed");
    await db
      .update(schema.imageGeneration)
      .set({ status: "succeeded" })
      .where(eq(schema.imageGeneration.id, res.job.id));

    const result = await sweepIdleConversations({
      scope: "user",
      userId: "owner",
      now: NOW,
      db,
    });

    expect(result.archived).toBe(1);
  });

  it("is idempotent — a second sweep archives nothing", async () => {
    await makeDesignAt("owner", daysAgo(4));

    const first = await sweepIdleConversations({
      scope: "user",
      userId: "owner",
      now: NOW,
      db,
    });
    const second = await sweepIdleConversations({
      scope: "user",
      userId: "owner",
      now: NOW,
      db,
    });

    expect(first.archived).toBe(1);
    expect(second.archived).toBe(0);
    expect(second.scanned).toBe(0);
  });

  it("scope user never touches another user's conversations", async () => {
    await makeUser(db, "stranger");
    const mine = await makeDesignAt("owner", daysAgo(4));
    const theirs = await makeDesignAt("stranger", daysAgo(4));

    const result = await sweepIdleConversations({
      scope: "user",
      userId: "owner",
      now: NOW,
      db,
    });

    expect(result.designIds).toEqual([mine.id]);
    expect(await closedAtOf(theirs.id)).toBeNull();
  });

  it("scope all sweeps every user's idle conversations", async () => {
    await makeUser(db, "stranger");
    const mine = await makeDesignAt("owner", daysAgo(4));
    const theirs = await makeDesignAt("stranger", daysAgo(4));

    const result = await sweepIdleConversations({ scope: "all", now: NOW, db });

    expect(result.archived).toBe(2);
    expect([...result.designIds].sort()).toEqual([mine.id, theirs.id].sort());
  });

  it("bounds a run with limit, oldest first, and drains across calls", async () => {
    const oldest = await makeDesignAt("owner", daysAgo(9));
    const middle = await makeDesignAt("owner", daysAgo(7));
    await makeDesignAt("owner", daysAgo(5));

    const first = await sweepIdleConversations({
      scope: "all",
      now: NOW,
      limit: 2,
      db,
    });
    expect(first.designIds).toEqual([oldest.id, middle.id]);

    const second = await sweepIdleConversations({
      scope: "all",
      now: NOW,
      limit: 2,
      db,
    });
    expect(second.archived).toBe(1);
  });

  it("leaves an already-closed conversation's closed_at alone", async () => {
    const closedAt = daysAgo(6);
    const design = await makeDesignAt("owner", daysAgo(9), { closedAt });

    const result = await sweepIdleConversations({ scope: "all", now: NOW, db });

    expect(result.archived).toBe(0);
    expect(await closedAtOf(design.id)).toEqual(closedAt);
  });

  it("archives exactly at the threshold boundary and not a moment before", async () => {
    const past = await makeDesignAt(
      "owner",
      new Date(NOW.getTime() - ARCHIVE_AFTER_MS - 1000)
    );
    const boundary = await makeDesignAt(
      "owner",
      new Date(NOW.getTime() - ARCHIVE_AFTER_MS + 1000)
    );

    const result = await sweepIdleConversations({ scope: "all", now: NOW, db });

    expect(result.designIds).toEqual([past.id]);
    expect(await closedAtOf(boundary.id)).toBeNull();
  });
});
