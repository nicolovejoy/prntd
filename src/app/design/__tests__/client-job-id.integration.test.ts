/**
 * #245: `generateDesign(designId, text, { jobId })` — the client-minted job id
 * that lets a lost/replayed response be reconciled by exact lookup.
 *
 * Mock boilerplate mirrors generation-races.integration.test.ts /
 * refused-submit-no-row.integration.test.ts: the DB is real in-memory libSQL,
 * auth is a mocked session (default `u1`), and the generator/AI/R2 stack is
 * mocked. `next/server`'s `after` is a collector, not a no-op, so every
 * "no second continuation" assertion below is explicit about draining it.
 */
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import { createTestDb } from "@/lib/__tests__/test-db";
import * as schema from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { dayKeyUTC } from "@/lib/generation-quota";

type Db = Awaited<ReturnType<typeof createTestDb>>;
let testDb: Db;

vi.mock("@/lib/db", () => ({
  get db() {
    return testDb;
  },
}));

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));

const afterQueue = vi.hoisted(() => ({
  callbacks: [] as Array<() => unknown>,
}));
vi.mock("next/server", () => ({
  after: (cb: () => unknown) => {
    afterQueue.callbacks.push(cb);
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(async () => ({
        user: { id: "u1", isAnonymous: false },
      })),
    },
  },
  isAnonymousUser: () => false,
}));

const GENERATE_BRIEF = {
  operation: "generate" as const,
  message: "Here it is",
  spec: { subject: "a happy cat", elements: [{ type: "obj" as const, desc: "a happy cat" }] },
};

vi.mock("@/lib/ai", () => ({
  constructDesignBrief: vi.fn(async () => GENERATE_BRIEF),
  chatAboutDesign: vi.fn(async () => ({
    message: "",
    readyToGenerate: true,
    options: [],
  })),
}));

vi.mock("@/lib/r2", () => ({
  uploadImageObject: vi.fn(
    async (imageId: string) => `https://r2/images/${imageId}.png`
  ),
  deleteImageObject: vi.fn(async () => {}),
}));

vi.mock("@/lib/generators/registry", () => {
  const ideogram = {
    id: "ideogram",
    label: "Ideogram",
    costFor: () => 0.03,
    generate: vi.fn(async () => "https://src/ideogram.png"),
  };
  return {
    DEFAULT_GENERATOR_ID: "ideogram",
    GENERATORS: { ideogram },
    getGenerator: () => ideogram,
  };
});

const { generateDesign } = await import("@/app/design/actions");
const { GENERATION_CONCURRENCY_CAP } = await import("@/lib/generation-job");
const ai = await import("@/lib/ai");
const { auth: authMock } = await import("@/lib/auth");

const briefMock = ai.constructDesignBrief as Mock;

async function seedUser(id = "u1") {
  await testDb.insert(schema.user).values({ id, email: `${id}@b.c`, name: id });
}

async function jobRow(id: string) {
  const [row] = await testDb
    .select()
    .from(schema.imageGeneration)
    .where(eq(schema.imageGeneration.id, id));
  return row;
}

async function jobsById(id: string) {
  return testDb
    .select()
    .from(schema.imageGeneration)
    .where(eq(schema.imageGeneration.id, id));
}

async function quotaCount(bucket = "user:u1"): Promise<number> {
  const [usage] = await testDb
    .select()
    .from(schema.generationUsage)
    .where(eq(schema.generationUsage.bucket, bucket));
  return usage?.count ?? 0;
}

/** Fill `count` of a user's concurrency slots with running jobs on another design. */
async function fillSlots(userId: string, count: number) {
  const [other] = await testDb
    .insert(schema.design)
    .values({ userId })
    .returning();
  for (let i = 0; i < count; i += 1) {
    await testDb.insert(schema.imageGeneration).values({
      designId: other.id,
      userId,
      status: "running",
      operation: "generate",
      imageId: crypto.randomUUID(),
      r2Key: "images/x.png",
      generationNumber: i + 1,
      dayKey: dayKeyUTC(new Date()),
      cost: 0.03,
      startedAt: new Date(),
    });
  }
}

beforeEach(async () => {
  testDb = await createTestDb();
  afterQueue.callbacks.length = 0;
  process.env.GUEST_FUNNEL_ENABLED = "true";
  briefMock.mockReset().mockResolvedValue(GENERATE_BRIEF);
});

afterEach(() => {
  delete process.env.GUEST_FUNNEL_ENABLED;
  vi.restoreAllMocks();
});

describe("generateDesign({ jobId }) — client-minted job id (#245)", () => {
  it("the job row carries the client id", async () => {
    await seedUser();
    const designId = crypto.randomUUID();
    const jobId = crypto.randomUUID();

    const res = await generateDesign(designId, "a red dragon", { jobId });

    expect(res.kind).toBe("queued");
    expect(res.kind === "queued" && res.jobId).toBe(jobId);
    expect(await jobRow(jobId)).toBeDefined();
  });

  it("a malformed job id is refused before quota is spent", async () => {
    await seedUser();
    const designId = crypto.randomUUID();

    await expect(
      generateDesign(designId, "a red dragon", { jobId: "not-a-uuid" })
    ).rejects.toThrow("Invalid job id");

    expect(await quotaCount()).toBe(0);
    expect(afterQueue.callbacks).toHaveLength(0);
  });

  it("own-id replay returns the same queued result, spends no quota, calls no brief, schedules no continuation", async () => {
    await seedUser();
    const designId = crypto.randomUUID();
    const jobId = crypto.randomUUID();

    const first = await generateDesign(designId, "a red dragon", { jobId });
    expect(first.kind).toBe("queued");
    expect(briefMock).toHaveBeenCalledTimes(1);
    expect(afterQueue.callbacks).toHaveLength(1);
    const quotaAfterFirst = await quotaCount();

    const second = await generateDesign(designId, "a red dragon", { jobId });

    expect(second).toEqual(first);
    expect(briefMock).toHaveBeenCalledTimes(1); // not called again
    expect(afterQueue.callbacks).toHaveLength(1); // no second continuation
    expect(await quotaCount()).toBe(quotaAfterFirst); // no additional spend
    expect(await jobsById(jobId)).toHaveLength(1);
  });

  it("another user's job id is refused before quota, and their row is untouched", async () => {
    await seedUser("u1");
    await seedUser("owner2");
    const theirDesignId = crypto.randomUUID();
    const jobId = crypto.randomUUID();

    (authMock.api.getSession as unknown as Mock).mockResolvedValueOnce({
      user: { id: "owner2", isAnonymous: false },
    });
    const theirs = await generateDesign(theirDesignId, "a blue cat", { jobId });
    expect(theirs.kind).toBe("queued");

    const designId = crypto.randomUUID();
    await expect(
      generateDesign(designId, "a red dragon", { jobId })
    ).rejects.toThrow("Invalid job id");

    expect(await quotaCount("user:u1")).toBe(0);
    const row = await jobRow(jobId);
    expect(row.userId).toBe("owner2");
    expect(row.designId).toBe(theirDesignId);
  });

  it("the caller's own id on a DIFFERENT design is refused before quota", async () => {
    await seedUser();
    const jobId = crypto.randomUUID();
    const firstDesignId = crypto.randomUUID();
    const first = await generateDesign(firstDesignId, "a red dragon", { jobId });
    expect(first.kind).toBe("queued");
    const quotaAfterFirst = await quotaCount();

    const secondDesignId = crypto.randomUUID();
    await expect(
      generateDesign(secondDesignId, "a blue dragon", { jobId })
    ).rejects.toThrow("Invalid job id");

    expect(await quotaCount()).toBe(quotaAfterFirst);
    const row = await jobRow(jobId);
    expect(row.designId).toBe(firstDesignId);
  });

  it("capacity is still enforced with a client id: refused, refunded, no row", async () => {
    await seedUser();
    await fillSlots("u1", GENERATION_CONCURRENCY_CAP);
    const designId = crypto.randomUUID();
    const jobId = crypto.randomUUID();

    const res = await generateDesign(designId, "a red dragon", { jobId });

    expect(res.kind).toBe("at_capacity");
    expect(await jobRow(jobId)).toBeUndefined();
    expect(await quotaCount()).toBe(0);
    expect(afterQueue.callbacks).toHaveLength(0);
  });

  it("an insert racing its own original (under the cap) returns the original's queued result, refunds this call's unit, no second continuation", async () => {
    await seedUser();
    const designId = crypto.randomUUID();
    const jobId = crypto.randomUUID();

    // The mocked brief call inserts the "rival's" row + spends its own quota
    // unit as a side effect, simulating a concurrent request that reached
    // insertGenerationJob first, entirely inside this call's window between
    // the early replay check (which ran before the row existed) and this
    // call's own insertGenerationJob.
    briefMock.mockImplementationOnce(async () => {
      await testDb.insert(schema.imageGeneration).values({
        id: jobId,
        designId,
        userId: "u1",
        status: "running",
        operation: "generate",
        imageId: crypto.randomUUID(),
        r2Key: "images/rival.png",
        generationNumber: 1,
        dayKey: dayKeyUTC(new Date()),
        cost: 0.03,
        startedAt: new Date(),
      });
      await testDb
        .update(schema.generationUsage)
        .set({ count: sql`${schema.generationUsage.count} + 1` })
        .where(
          and(
            eq(schema.generationUsage.bucket, "user:u1"),
            eq(schema.generationUsage.day, dayKeyUTC(new Date()))
          )
        );
      return GENERATE_BRIEF;
    });

    const original = await jobRow(jobId).catch(() => undefined);
    expect(original).toBeUndefined(); // does not exist before the call

    const res = await generateDesign(designId, "a red dragon", { jobId });

    expect(res.kind).toBe("queued");
    expect(res.kind === "queued" && res.jobId).toBe(jobId);
    expect(res.kind === "queued" && res.generationNumber).toBe(1);

    const rows = await jobsById(jobId);
    expect(rows).toHaveLength(1);
    expect(res.kind === "queued" && res.imageId).toBe(rows[0].imageId);

    // Net quota consumed = one unit (the rival's); this call's own spend was
    // refunded when insertGenerationJob reported `duplicate`.
    expect(await quotaCount()).toBe(1);
    expect(afterQueue.callbacks).toHaveLength(0);
  });

  it("an insert racing its own original (at the cap) still resolves as duplicate, not at_capacity", async () => {
    await seedUser();
    await fillSlots("u1", GENERATION_CONCURRENCY_CAP - 1);
    const designId = crypto.randomUUID();
    const jobId = crypto.randomUUID();

    briefMock.mockImplementationOnce(async () => {
      // This insert brings the user to the cap — the real insert's guarded
      // WHERE then sees `count = cap`, so it selects zero rows rather than
      // hitting the primary-key check at all.
      await testDb.insert(schema.imageGeneration).values({
        id: jobId,
        designId,
        userId: "u1",
        status: "running",
        operation: "generate",
        imageId: crypto.randomUUID(),
        r2Key: "images/rival.png",
        generationNumber: 1,
        dayKey: dayKeyUTC(new Date()),
        cost: 0.03,
        startedAt: new Date(),
      });
      await testDb
        .update(schema.generationUsage)
        .set({ count: sql`${schema.generationUsage.count} + 1` })
        .where(
          and(
            eq(schema.generationUsage.bucket, "user:u1"),
            eq(schema.generationUsage.day, dayKeyUTC(new Date()))
          )
        );
      return GENERATE_BRIEF;
    });

    const res = await generateDesign(designId, "a red dragon", { jobId });

    expect(res.kind).toBe("queued");
    expect(res.kind === "queued" && res.jobId).toBe(jobId);
    const rows = await jobsById(jobId);
    expect(rows).toHaveLength(1);
    expect(afterQueue.callbacks).toHaveLength(0);
    // Net quota consumed = 1, the rival's own unit spent inline above:
    // fillSlots writes rows directly, spending no quota, and this call's
    // own spend was refunded.
    expect(await quotaCount()).toBe(1);
  });

  it("a FOREIGN row appearing at insert time throws and refunds exactly once", async () => {
    await seedUser("u1");
    await seedUser("owner2");
    const designId = crypto.randomUUID();
    const jobId = crypto.randomUUID();

    briefMock.mockImplementationOnce(async () => {
      const [otherDesign] = await testDb
        .insert(schema.design)
        .values({ userId: "owner2" })
        .returning();
      await testDb.insert(schema.imageGeneration).values({
        id: jobId,
        designId: otherDesign.id,
        userId: "owner2",
        status: "running",
        operation: "generate",
        imageId: crypto.randomUUID(),
        r2Key: "images/foreign.png",
        generationNumber: 1,
        dayKey: dayKeyUTC(new Date()),
        cost: 0.03,
        startedAt: new Date(),
      });
      return GENERATE_BRIEF;
    });

    await expect(
      generateDesign(designId, "a red dragon", { jobId })
    ).rejects.toThrow("Invalid job id");

    // Refunded exactly once by the outer catch — spent 1, refunded 1.
    expect(await quotaCount()).toBe(0);
    const row = await jobRow(jobId);
    expect(row.userId).toBe("owner2");
    expect(afterQueue.callbacks).toHaveLength(0);
  });
});
