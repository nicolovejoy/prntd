/**
 * getDesignJobs (durable-generation-job task 4) against a real in-memory
 * libSQL. The two things worth a real DB here: the lazy sweep actually
 * transitions an overdue row (failGenerationJob's conditional UPDATE), and
 * the owner gate gets exercised with real rows rather than a mock.
 *
 * Auth is mocked; the database is real.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/lib/__tests__/test-db";
import { makeUser, makeDesign } from "@/lib/__tests__/factories";
import { insertGenerationJob, cancelGenerationJob, succeedJobStatement } from "@/lib/generation-job";
import { dayKeyUTC } from "@/lib/generation-quota";

type Db = Awaited<ReturnType<typeof createTestDb>>;
let testDb: Db;

const h = vi.hoisted(() => ({ userId: "owner" as string | null }));

vi.mock("@/lib/db", () => ({
  get db() {
    return testDb;
  },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () =>
        h.userId ? { user: { id: h.userId, isAnonymous: false } } : null,
    },
  },
  isAnonymousUser: () => false,
}));
// design/actions.ts constructs the Anthropic client at import time; the
// generation/chat path isn't exercised here.
vi.mock("@/lib/ai", () => ({
  assessReadiness: vi.fn(),
  constructDesignBrief: vi.fn(),
  chatAboutDesign: vi.fn(),
}));
vi.mock("@/lib/r2", () => ({
  uploadImageObject: vi.fn(),
  deleteImageObject: vi.fn(),
}));

const { getDesignJobs } = await import("@/app/design/actions");

// sweepStaleJobs (called inside getDesignJobs) has no injectable `now` at
// this call site — it defaults to the real clock — so these have to be real
// wall-clock-relative times, not a fixed fictional date.
const NOW = new Date();
const TEN_MIN_AGO = new Date(NOW.getTime() - 10 * 60 * 1000);

async function seedRunningJob(
  designId: string,
  overrides: Partial<Parameters<typeof insertGenerationJob>[0]> = {}
) {
  const res = await insertGenerationJob({
    designId,
    userId: "owner",
    operation: "generate",
    imageId: crypto.randomUUID(),
    r2Key: `images/${crypto.randomUUID()}.png`,
    anchorImageId: null,
    generationNumber: 1,
    dayKey: dayKeyUTC(NOW),
    ip: "10.0.0.1",
    cost: 0.03,
    now: NOW,
    db: testDb,
    ...overrides,
  });
  if (!res.ok) throw new Error("expected insert to succeed");
  return res.job;
}

beforeEach(async () => {
  testDb = await createTestDb();
  h.userId = "owner";
  await makeUser(testDb, "owner");
});

describe("getDesignJobs", () => {
  it("refuses a non-owner", async () => {
    const design = await makeDesign(testDb, "owner");
    await makeUser(testDb, "stranger");
    h.userId = "stranger";

    await expect(getDesignJobs(design.id, [])).rejects.toThrow(/Unauthorized/);
  });

  it("refuses a signed-out caller", async () => {
    const design = await makeDesign(testDb, "owner");
    h.userId = null;

    await expect(getDesignJobs(design.id, [])).rejects.toThrow(/Unauthorized/);
  });

  it("reports a genuinely running job as running, not settled", async () => {
    const design = await makeDesign(testDb, "owner");
    const job = await seedRunningJob(design.id, { now: NOW });

    const result = await getDesignJobs(design.id, [job.id]);

    // Drizzle's timestamp mode round-trips through epoch SECONDS, so
    // sub-second precision on `now` doesn't survive the write.
    expect(result.running).toEqual([
      {
        jobId: job.id,
        generationNumber: 1,
        startedAt: Math.floor(NOW.getTime() / 1000) * 1000,
      },
    ]);
    expect(result.settled).toEqual([]);
  });

  it("sweeps an overdue row and reports it as settled/failed in the same call", async () => {
    const design = await makeDesign(testDb, "owner");
    const job = await seedRunningJob(design.id, { now: TEN_MIN_AGO });

    const result = await getDesignJobs(design.id, [job.id]);

    expect(result.running).toEqual([]);
    expect(result.settled).toEqual([
      { jobId: job.id, status: "failed", imageId: null, error: "Generation timed out" },
    ]);
  });

  it("excludes a cancelled-but-running job from both running and settled", async () => {
    const design = await makeDesign(testDb, "owner");
    const plain = await seedRunningJob(design.id, { now: NOW, generationNumber: 1 });
    const cancelled = await seedRunningJob(design.id, { now: NOW, generationNumber: 2 });
    const cancelledOk = await cancelGenerationJob({
      jobId: cancelled.id,
      userId: "owner",
      db: testDb,
    });
    expect(cancelledOk).toBe(true);

    const result = await getDesignJobs(design.id, [plain.id, cancelled.id]);

    // The cancelled job is still `status = 'running'` (cancel doesn't stop
    // the render) — getRunningJobsForDesign's docblock is explicit that a
    // consumer surfacing running jobs to a UI must read cancelledAt, not
    // just status. It must not show up as an active spinner (running) NOR
    // as a resolved result (settled): the render is still in flight and
    // will land as a normal completion later.
    expect(result.running.map((j) => j.jobId)).toEqual([plain.id]);
    expect(result.settled).toEqual([]);
  });

  it("reports a succeeded job's imageId in settled", async () => {
    const design = await makeDesign(testDb, "owner");
    const job = await seedRunningJob(design.id, { now: NOW });

    await succeedJobStatement(testDb, job.id, NOW);

    const result = await getDesignJobs(design.id, [job.id]);

    expect(result.running).toEqual([]);
    expect(result.settled).toEqual([
      { jobId: job.id, status: "succeeded", imageId: job.imageId, error: null },
    ]);
  });

  it("does not report a tracked job id that belongs to a different design", async () => {
    const design = await makeDesign(testDb, "owner");
    const otherDesign = await makeDesign(testDb, "owner");
    const foreignJob = await seedRunningJob(otherDesign.id, { now: TEN_MIN_AGO });

    const result = await getDesignJobs(design.id, [foreignJob.id]);

    expect(result.running).toEqual([]);
    expect(result.settled).toEqual([]);
  });
});
