/**
 * Real-DB coverage for the cron backstop. sweepStaleJobs itself is unit/
 * integration-tested in generation-job.integration.test.ts; this suite
 * exercises the composition — the `{ scope: "all" }` call, the R2 reclaim
 * per swept job, the batch cap, and idempotency across two runs — against
 * the same in-memory libSQL harness (FKs enforced).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "./test-db";
import { makeUser, makeDesign } from "./factories";
import { sweepStaleJobs, STALE_JOB_MS, type GenerationJob } from "@/lib/generation-job";
import { insertGenerationJob } from "@/lib/generation-job";
import { dayKeyUTC } from "@/lib/generation-quota";
import { sweepOrphanedGenerations, type SweepGenerationsDeps } from "@/lib/sweep-generations";

type Db = Awaited<ReturnType<typeof createTestDb>>;

const NOW = new Date("2026-08-29T18:00:00.000Z");
const STALE_STARTED_AT = new Date(NOW.getTime() - STALE_JOB_MS - 60_000); // overdue

async function seedStaleJob(db: Db, userId: string, designId: string) {
  const res = await insertGenerationJob({
    designId,
    userId,
    operation: "generate",
    imageId: crypto.randomUUID(),
    r2Key: `images/${crypto.randomUUID()}.png`,
    anchorImageId: null,
    generationNumber: 1,
    dayKey: dayKeyUTC(STALE_STARTED_AT),
    ip: "10.0.0.1",
    cost: 0.03,
    now: STALE_STARTED_AT,
    db,
  });
  if (!res.ok) throw new Error("expected insert to succeed");
  return res.job;
}

function makeDeps(db: Db, overrides: Partial<SweepGenerationsDeps> = {}): SweepGenerationsDeps {
  return {
    sweep: (params) => sweepStaleJobs({ ...params, db } as Parameters<typeof sweepStaleJobs>[0]),
    reclaimImageObject: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("sweepOrphanedGenerations", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("sweeps overdue running jobs across multiple users and reclaims each R2 object", async () => {
    await makeUser(db, "user-a");
    await makeUser(db, "user-b");
    const designA = await makeDesign(db, "user-a");
    const designB = await makeDesign(db, "user-b");
    const jobA = await seedStaleJob(db, "user-a", designA.id);
    const jobB = await seedStaleJob(db, "user-b", designB.id);

    const deps = makeDeps(db);
    const result = await sweepOrphanedGenerations(deps, { now: NOW });

    expect(result).toEqual({ scanned: 2, failed: 2, reclaimed: 2, reclaimErrors: 0 });
    expect(deps.reclaimImageObject).toHaveBeenCalledTimes(2);
    expect(deps.reclaimImageObject).toHaveBeenCalledWith(jobA.imageId);
    expect(deps.reclaimImageObject).toHaveBeenCalledWith(jobB.imageId);
  });

  it("does not touch a running job that isn't overdue yet", async () => {
    await makeUser(db, "user-a");
    const design = await makeDesign(db, "user-a");
    await insertGenerationJob({
      designId: design.id,
      userId: "user-a",
      operation: "generate",
      imageId: crypto.randomUUID(),
      r2Key: "images/fresh.png",
      anchorImageId: null,
      generationNumber: 1,
      dayKey: dayKeyUTC(NOW),
      ip: "10.0.0.1",
      cost: 0.03,
      now: NOW, // started "now" — well inside STALE_JOB_MS
      db,
    });

    const deps = makeDeps(db);
    const result = await sweepOrphanedGenerations(deps, { now: NOW });

    expect(result).toEqual({ scanned: 0, failed: 0, reclaimed: 0, reclaimErrors: 0 });
    expect(deps.reclaimImageObject).not.toHaveBeenCalled();
  });

  it("a failed R2 reclaim is best-effort and never fails the run", async () => {
    await makeUser(db, "user-a");
    const design = await makeDesign(db, "user-a");
    await seedStaleJob(db, "user-a", design.id);

    const deps = makeDeps(db, {
      reclaimImageObject: vi.fn().mockRejectedValue(new Error("R2 down")),
    });

    const result = await sweepOrphanedGenerations(deps, { now: NOW });

    expect(result).toEqual({ scanned: 1, failed: 1, reclaimed: 0, reclaimErrors: 1 });
  });

  it("is idempotent across two consecutive runs", async () => {
    await makeUser(db, "user-a");
    const design = await makeDesign(db, "user-a");
    await seedStaleJob(db, "user-a", design.id);
    const deps = makeDeps(db);

    const first = await sweepOrphanedGenerations(deps, { now: NOW });
    const second = await sweepOrphanedGenerations(deps, { now: NOW });

    expect(first).toEqual({ scanned: 1, failed: 1, reclaimed: 1, reclaimErrors: 0 });
    // Second run finds the row already `failed`, not `running` — nothing left
    // to scan, and no double reclaim of the same R2 object.
    expect(second).toEqual({ scanned: 0, failed: 0, reclaimed: 0, reclaimErrors: 0 });
    expect(deps.reclaimImageObject).toHaveBeenCalledTimes(1);
  });

  it("respects the batch cap, leaving the rest for a later run", async () => {
    await makeUser(db, "user-a");
    const design = await makeDesign(db, "user-a");
    const jobs: GenerationJob[] = [];
    for (let i = 0; i < 3; i++) {
      jobs.push(await seedStaleJob(db, "user-a", design.id));
    }

    const deps = makeDeps(db);
    const result = await sweepOrphanedGenerations(deps, { now: NOW, limit: 2 });

    expect(result).toEqual({ scanned: 2, failed: 2, reclaimed: 2, reclaimErrors: 0 });
    expect(deps.reclaimImageObject).toHaveBeenCalledTimes(2);

    // The follow-up run picks up the one row the cap left behind.
    const followUp = await sweepOrphanedGenerations(deps, { now: NOW, limit: 2 });
    expect(followUp).toEqual({ scanned: 1, failed: 1, reclaimed: 1, reclaimErrors: 0 });
  });
});
