/**
 * Real-DB coverage for the job lifecycle layer. The whole point of this module
 * is the guarded INSERT and the transition-gated refund, neither of which a
 * mocked db can exercise — so every case here runs against an in-memory libSQL
 * built from schema.ts (FKs enforced).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb } from "./test-db";
import { makeUser, makeDesign } from "./factories";
import { generationUsage, imageGeneration } from "@/lib/db/schema";
import { consumeGenerationQuota, dayKeyUTC } from "@/lib/generation-quota";
import {
  GENERATION_CONCURRENCY_CAP,
  STALE_JOB_MS,
  cancelGenerationJob,
  countRunningJobsForUser,
  countActiveGenerationsForUser,
  failGenerationJob,
  getRunningJobsForDesign,
  insertGenerationJob,
  succeedJobStatement,
  sweepStaleJobs,
} from "@/lib/generation-job";

type Db = Awaited<ReturnType<typeof createTestDb>>;

let db: Db;
let designId: string;
const USER = "user-a";
const IP = "10.0.0.1";
const NOW = new Date("2026-08-29T18:00:00.000Z");

async function seedJob(
  overrides: Partial<Parameters<typeof insertGenerationJob>[0]> = {}
) {
  const res = await insertGenerationJob({
    designId,
    userId: USER,
    operation: "generate",
    imageId: crypto.randomUUID(),
    r2Key: `images/${crypto.randomUUID()}.png`,
    anchorImageId: null,
    generationNumber: 1,
    dayKey: dayKeyUTC(NOW),
    ip: IP,
    cost: 0.03,
    now: NOW,
    db,
    ...overrides,
  });
  if (!res.ok) throw new Error("expected insert to succeed");
  return res.job;
}

function usageCount(bucket: string, day: string) {
  return db
    .select()
    .from(generationUsage)
    .where(and(eq(generationUsage.bucket, bucket), eq(generationUsage.day, day)))
    .then((rows) => rows[0]?.count ?? 0);
}

beforeEach(async () => {
  process.env.GUEST_FUNNEL_ENABLED = "true";
  db = await createTestDb();
  await makeUser(db, USER);
  const design = await makeDesign(db, USER);
  designId = design.id;
});

afterEach(() => {
  delete process.env.GUEST_FUNNEL_ENABLED;
});

describe("insertGenerationJob", () => {
  it("inserts a running job and returns it", async () => {
    const job = await seedJob({ generationNumber: 7, anchorImageId: "anchor-1" });

    expect(job.status).toBe("running");
    expect(job.operation).toBe("generate");
    expect(job.generationNumber).toBe(7);
    expect(job.anchorImageId).toBe("anchor-1");
    expect(job.dayKey).toBe("2026-08-29");
    expect(job.ip).toBe(IP);
    expect(job.cost).toBeCloseTo(0.03);
    expect(job.startedAt.getTime()).toBe(NOW.getTime());
    expect(job.finishedAt).toBeNull();
    expect(job.cancelledAt).toBeNull();

    const [persisted] = await db
      .select()
      .from(imageGeneration)
      .where(eq(imageGeneration.id, job.id));
    expect(persisted.status).toBe("running");
  });

  it("refuses the job past the cap, and admits one again once a job is failed", async () => {
    for (let i = 0; i < GENERATION_CONCURRENCY_CAP; i++) {
      await seedJob({ generationNumber: i + 1 });
    }
    expect(await countRunningJobsForUser(USER, db)).toBe(GENERATION_CONCURRENCY_CAP);

    const refused = await insertGenerationJob({
      designId,
      userId: USER,
      operation: "generate",
      imageId: crypto.randomUUID(),
      r2Key: "images/x.png",
      anchorImageId: null,
      generationNumber: 4,
      dayKey: dayKeyUTC(NOW),
      ip: IP,
      cost: 0.03,
      now: NOW,
      db,
    });
    expect(refused).toEqual({ ok: false, reason: "at_capacity" });

    // The predicate must read status, not a bare row count: the three rows are
    // still there after one is failed, but only two are running.
    const [first] = await getRunningJobsForDesign(designId, db);
    await failGenerationJob({ jobId: first.id, error: "boom", now: NOW, db });

    const admitted = await insertGenerationJob({
      designId,
      userId: USER,
      operation: "generate",
      imageId: crypto.randomUUID(),
      r2Key: "images/y.png",
      anchorImageId: null,
      generationNumber: 4,
      dayKey: dayKeyUTC(NOW),
      ip: IP,
      cost: 0.03,
      now: NOW,
      db,
    });
    expect(admitted.ok).toBe(true);
  });

  it("caps per user — user A at capacity does not block user B", async () => {
    for (let i = 0; i < GENERATION_CONCURRENCY_CAP; i++) {
      await seedJob({ generationNumber: i + 1 });
    }
    await makeUser(db, "user-b");
    const otherDesign = await makeDesign(db, "user-b");

    const res = await insertGenerationJob({
      designId: otherDesign.id,
      userId: "user-b",
      operation: "generate",
      imageId: crypto.randomUUID(),
      r2Key: "images/b.png",
      anchorImageId: null,
      generationNumber: 1,
      dayKey: dayKeyUTC(NOW),
      ip: IP,
      cost: 0.03,
      now: NOW,
      db,
    });
    expect(res.ok).toBe(true);
    expect(await countRunningJobsForUser("user-b", db)).toBe(1);
  });

  it("admits exactly one of two concurrent inserts at the cap boundary", async () => {
    for (let i = 0; i < GENERATION_CONCURRENCY_CAP - 1; i++) {
      await seedJob({ generationNumber: i + 1 });
    }

    const attempt = (n: number) =>
      insertGenerationJob({
        designId,
        userId: USER,
        operation: "generate",
        imageId: crypto.randomUUID(),
        r2Key: `images/race-${n}.png`,
        anchorImageId: null,
        generationNumber: n,
        dayKey: dayKeyUTC(NOW),
        ip: IP,
        cost: 0.03,
        now: NOW,
        db,
      });

    const results = await Promise.all([attempt(90), attempt(91)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
    expect(await countRunningJobsForUser(USER, db)).toBe(GENERATION_CONCURRENCY_CAP);
  });
});

describe("failGenerationJob", () => {
  it("transitions running -> failed, records the error and finishedAt, and refunds once", async () => {
    const job = await seedJob();
    await consumeGenerationQuota({
      userId: USER,
      isAnonymous: false,
      ip: IP,
      now: NOW,
      db,
    });
    expect(await usageCount(`user:${USER}`, "2026-08-29")).toBe(1);

    const finishedAt = new Date(NOW.getTime() + 1000);
    const res = await failGenerationJob({
      jobId: job.id,
      error: "provider 500",
      now: finishedAt,
      db,
    });
    expect(res).toEqual({ failed: true, refunded: true });

    const [row] = await db
      .select()
      .from(imageGeneration)
      .where(eq(imageGeneration.id, job.id));
    expect(row.status).toBe("failed");
    expect(row.error).toBe("provider 500");
    expect(row.finishedAt?.getTime()).toBe(finishedAt.getTime());

    expect(await usageCount(`user:${USER}`, "2026-08-29")).toBe(0);
    expect(await usageCount(`ip:${IP}`, "2026-08-29")).toBe(0);
  });

  it("is a no-op on an already-failed job and does not refund twice", async () => {
    const job = await seedJob();
    await consumeGenerationQuota({
      userId: USER,
      isAnonymous: false,
      ip: IP,
      now: NOW,
      db,
    });
    await consumeGenerationQuota({
      userId: USER,
      isAnonymous: false,
      ip: IP,
      now: NOW,
      db,
    });
    expect(await usageCount(`user:${USER}`, "2026-08-29")).toBe(2);

    const first = await failGenerationJob({ jobId: job.id, error: "boom", now: NOW, db });
    const second = await failGenerationJob({ jobId: job.id, error: "boom again", now: NOW, db });

    expect(first).toEqual({ failed: true, refunded: true });
    expect(second).toEqual({ failed: false, refunded: false });
    expect(await usageCount(`user:${USER}`, "2026-08-29")).toBe(1);

    const [row] = await db
      .select()
      .from(imageGeneration)
      .where(eq(imageGeneration.id, job.id));
    expect(row.error).toBe("boom");
  });

  it("refunds the job's stored dayKey, not the day the failure is noticed", async () => {
    const yesterday = new Date("2026-08-28T23:50:00.000Z");
    const job = await seedJob({ dayKey: dayKeyUTC(yesterday), now: yesterday });
    await consumeGenerationQuota({
      userId: USER,
      isAnonymous: false,
      ip: IP,
      now: yesterday,
      db,
    });
    // A separate spend today, which must be left untouched.
    await consumeGenerationQuota({
      userId: USER,
      isAnonymous: false,
      ip: IP,
      now: NOW,
      db,
    });
    expect(await usageCount(`user:${USER}`, "2026-08-28")).toBe(1);
    expect(await usageCount(`user:${USER}`, "2026-08-29")).toBe(1);

    await failGenerationJob({ jobId: job.id, error: "timed out", now: NOW, db });

    expect(await usageCount(`user:${USER}`, "2026-08-28")).toBe(0);
    expect(await usageCount(`user:${USER}`, "2026-08-29")).toBe(1);
    expect(await usageCount(`ip:${IP}`, "2026-08-28")).toBe(0);
    expect(await usageCount(`ip:${IP}`, "2026-08-29")).toBe(1);
  });

  it("does not refund a job the success path already claimed", async () => {
    const job = await seedJob();
    await consumeGenerationQuota({
      userId: USER,
      isAnonymous: false,
      ip: IP,
      now: NOW,
      db,
    });

    await succeedJobStatement(db, job.id, NOW);
    const res = await failGenerationJob({ jobId: job.id, error: "late error", now: NOW, db });

    expect(res).toEqual({ failed: false, refunded: false });
    expect(await usageCount(`user:${USER}`, "2026-08-29")).toBe(1);

    const [row] = await db
      .select()
      .from(imageGeneration)
      .where(eq(imageGeneration.id, job.id));
    expect(row.status).toBe("succeeded");
    expect(row.finishedAt?.getTime()).toBe(NOW.getTime());
  });
});

describe("succeedJobStatement", () => {
  it("cannot resurrect a job the sweeper already failed", async () => {
    // The direction that matters: a slow-but-alive job gets swept and refunded,
    // then its completion batch fires anyway. If the statement were not
    // conditional on `running`, that refunded row would end up marked
    // succeeded — quota given back for a generation the books call a success.
    const job = await seedJob();
    await consumeGenerationQuota({
      userId: USER,
      isAnonymous: false,
      ip: IP,
      now: NOW,
      db,
    });

    const failedAt = new Date(NOW.getTime() + 1000);
    const failure = await failGenerationJob({
      jobId: job.id,
      error: "Generation timed out",
      now: failedAt,
      db,
    });
    expect(failure).toEqual({ failed: true, refunded: true });
    expect(await usageCount(`user:${USER}`, "2026-08-29")).toBe(0);

    // The late completion. It must be inert, not an error.
    const completedAt = new Date(NOW.getTime() + 60_000);
    await succeedJobStatement(db, job.id, completedAt);

    const [row] = await db
      .select()
      .from(imageGeneration)
      .where(eq(imageGeneration.id, job.id));
    expect(row.status).toBe("failed");
    // finishedAt and error are the sweeper's, not the completion's.
    expect(row.finishedAt?.getTime()).toBe(failedAt.getTime());
    expect(row.error).toBe("Generation timed out");
    // And no second bite at the quota in either direction.
    expect(await usageCount(`user:${USER}`, "2026-08-29")).toBe(0);
  });
});

describe("cancelGenerationJob", () => {
  it("sets cancelledAt and leaves the status running", async () => {
    const job = await seedJob();
    expect(await cancelGenerationJob({ jobId: job.id, userId: USER, db })).toBe(true);

    const [row] = await db
      .select()
      .from(imageGeneration)
      .where(eq(imageGeneration.id, job.id));
    expect(row.cancelledAt).not.toBeNull();
    expect(row.status).toBe("running");
  });

  it("refuses a different user", async () => {
    const job = await seedJob();
    await makeUser(db, "user-c");

    expect(await cancelGenerationJob({ jobId: job.id, userId: "user-c", db })).toBe(false);

    const [row] = await db
      .select()
      .from(imageGeneration)
      .where(eq(imageGeneration.id, job.id));
    expect(row.cancelledAt).toBeNull();
  });

  it("refuses an already-finished job", async () => {
    const job = await seedJob();
    await failGenerationJob({ jobId: job.id, error: "boom", now: NOW, db });

    expect(await cancelGenerationJob({ jobId: job.id, userId: USER, db })).toBe(false);
  });
});

describe("slot count vs display count", () => {
  it("a cancelled job keeps its slot but stops being shown as generating", async () => {
    const running = await seedJob({ generationNumber: 1 });
    const cancelled = await seedJob({ generationNumber: 2 });
    await cancelGenerationJob({ jobId: cancelled.id, userId: USER, db });

    // The render is still going, so the slot is still taken — the cap must
    // see 2 or a third generation would over-subscribe the user.
    expect(await countRunningJobsForUser(USER, db)).toBe(2);
    // The header pill must see 1: the user already stopped watching the other.
    expect(await countActiveGenerationsForUser(USER, db)).toBe(1);

    // And when the only remaining job is cancelled, nothing is shown at all —
    // the regression this split exists to prevent (a pinned "1 generating"
    // until the provider call finished).
    await cancelGenerationJob({ jobId: running.id, userId: USER, db });
    expect(await countRunningJobsForUser(USER, db)).toBe(2);
    expect(await countActiveGenerationsForUser(USER, db)).toBe(0);
  });

  it("neither count includes settled jobs, and both are user-scoped", async () => {
    const job = await seedJob();
    await makeUser(db, "user-d");
    await seedJob({ userId: "user-d", generationNumber: 1 });

    await failGenerationJob({ jobId: job.id, error: "boom", now: NOW, db });
    expect(await countRunningJobsForUser(USER, db)).toBe(0);
    expect(await countActiveGenerationsForUser(USER, db)).toBe(0);
    expect(await countActiveGenerationsForUser("user-d", db)).toBe(1);
  });
});

describe("sweepStaleJobs", () => {
  it("fails + refunds an overdue job, leaves a fresh one, and is idempotent", async () => {
    const staleStart = new Date(NOW.getTime() - STALE_JOB_MS - 1000);
    const stale = await seedJob({ generationNumber: 1, now: staleStart });
    const fresh = await seedJob({ generationNumber: 2, now: NOW });

    await consumeGenerationQuota({
      userId: USER,
      isAnonymous: false,
      ip: IP,
      now: NOW,
      db,
    });
    await consumeGenerationQuota({
      userId: USER,
      isAnonymous: false,
      ip: IP,
      now: NOW,
      db,
    });
    expect(await usageCount(`user:${USER}`, "2026-08-29")).toBe(2);

    const first = await sweepStaleJobs({ scope: "design", designId, now: NOW, db });
    expect(first).toEqual(
      expect.objectContaining({ swept: 1, scanned: 1, jobs: [expect.objectContaining({ id: stale.id })] })
    );
    expect(await usageCount(`user:${USER}`, "2026-08-29")).toBe(1);

    const [staleRow] = await db
      .select()
      .from(imageGeneration)
      .where(eq(imageGeneration.id, stale.id));
    expect(staleRow.status).toBe("failed");
    expect(staleRow.finishedAt?.getTime()).toBe(NOW.getTime());

    const [freshRow] = await db
      .select()
      .from(imageGeneration)
      .where(eq(imageGeneration.id, fresh.id));
    expect(freshRow.status).toBe("running");

    const second = await sweepStaleJobs({ scope: "design", designId, now: NOW, db });
    expect(second).toEqual({ swept: 0, scanned: 0, jobs: [] });
    expect(await usageCount(`user:${USER}`, "2026-08-29")).toBe(1);
  });

  it("scopes to one user, and scope 'all' reaches every user", async () => {
    const staleStart = new Date(NOW.getTime() - STALE_JOB_MS - 1000);
    await seedJob({ now: staleStart });

    await makeUser(db, "user-b");
    const otherDesign = await makeDesign(db, "user-b");
    const otherJob = await seedJob({
      userId: "user-b",
      designId: otherDesign.id,
      now: staleStart,
    });

    expect(
      await sweepStaleJobs({ scope: "user", userId: USER, now: NOW, db })
    ).toEqual(expect.objectContaining({ swept: 1 }));
    const [otherRow] = await db
      .select()
      .from(imageGeneration)
      .where(eq(imageGeneration.id, otherJob.id));
    expect(otherRow.status).toBe("running");

    expect(await sweepStaleJobs({ scope: "all", now: NOW, db })).toEqual(
      expect.objectContaining({ swept: 1, jobs: [expect.objectContaining({ id: otherJob.id })] })
    );
    expect(await countRunningJobsForUser("user-b", db)).toBe(0);
  });
});

describe("getRunningJobsForDesign", () => {
  it("excludes finished jobs and orders by generationNumber", async () => {
    const third = await seedJob({ generationNumber: 3 });
    await seedJob({ generationNumber: 1 });
    const second = await seedJob({ generationNumber: 2 });

    await failGenerationJob({ jobId: second.id, error: "boom", now: NOW, db });

    const running = await getRunningJobsForDesign(designId, db);
    expect(running.map((j) => j.generationNumber)).toEqual([1, 3]);
    expect(running.map((j) => j.id)).toContain(third.id);
  });

  it("still returns a cancelled job, with cancelledAt set to distinguish it", async () => {
    // Cancel does not stop the render, so the job is still running and still
    // holds its slot. Consumers must read cancelledAt rather than treating
    // everything in this list as in-flight work.
    const cancelled = await seedJob({ generationNumber: 1 });
    await seedJob({ generationNumber: 2 });
    expect(await cancelGenerationJob({ jobId: cancelled.id, userId: USER, db })).toBe(true);

    const running = await getRunningJobsForDesign(designId, db);
    expect(running.map((j) => j.generationNumber)).toEqual([1, 2]);

    const row = running.find((j) => j.id === cancelled.id);
    expect(row?.cancelledAt).toBeInstanceOf(Date);
    expect(running.find((j) => j.generationNumber === 2)?.cancelledAt).toBeNull();
    // It is still counted against the concurrency cap.
    expect(await countRunningJobsForUser(USER, db)).toBe(2);
  });

  it("does not leak another design's jobs", async () => {
    await seedJob();
    const otherDesign = await makeDesign(db, USER);

    expect(await getRunningJobsForDesign(otherDesign.id, db)).toHaveLength(0);
  });
});
