/**
 * #197: `generateDesign` must not create the `design` row for a submit that
 * gets refused before the render is even attempted. Before this fix,
 * `getOrCreateDesign` ran before the quota and capacity checks, so a refused
 * submit on a never-seen designId still left a row behind — a dead, chatless
 * "Untitled" design a refresh would show.
 *
 * Mock boilerplate mirrors generation-races.integration.test.ts /
 * explicit-anchor.integration.test.ts: the DB is real in-memory libSQL, auth
 * is a fixed `u1` session, and the generator/AI/R2 stack is mocked (none of
 * the cases below reach far enough to call it, but `actions.ts` imports the
 * real modules at load time, and those construct live API clients).
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

vi.mock("@/lib/ai", () => ({
  constructDesignBrief: vi.fn(async () => ({
    operation: "generate",
    message: "Here it is",
    spec: { subject: "a happy cat", elements: [{ type: "obj", desc: "a happy cat" }] },
  })),
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

// Partially mocked so the "concurrent double-submit" test can inject a rival
// insert exactly between this call's advisory capacity check and its own
// design-row insert — see that test for why (a genuine Promise.all race is
// not reachable here once GUEST_FUNNEL_ENABLED is on).
vi.mock("@/lib/generation-job", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/generation-job")>();
  return { ...actual, countRunningJobsForUser: vi.fn(actual.countRunningJobsForUser) };
});

const { generateDesign } = await import("@/app/design/actions");
const { GENERATION_CONCURRENCY_CAP, countRunningJobsForUser } = await import(
  "@/lib/generation-job"
);
const countRunningJobsForUserMock = countRunningJobsForUser as Mock;

async function seedUser(id = "u1") {
  await testDb.insert(schema.user).values({ id, email: `${id}@b.c`, name: id });
}

async function getDesignRow(designId: string) {
  const [row] = await testDb
    .select()
    .from(schema.design)
    .where(eq(schema.design.id, designId));
  return row;
}

/** Fill `count` of u1's concurrency slots with running jobs on ANOTHER design. */
async function fillSlots(count: number) {
  const [other] = await testDb
    .insert(schema.design)
    .values({ userId: "u1" })
    .returning();
  for (let i = 0; i < count; i += 1) {
    await testDb.insert(schema.imageGeneration).values({
      designId: other.id,
      userId: "u1",
      status: "running",
      operation: "generate",
      imageId: crypto.randomUUID(),
      r2Key: "images/x.png",
      generationNumber: i + 1,
      dayKey: "2026-08-29",
      cost: 0.03,
      startedAt: new Date(),
    });
  }
}

async function quotaCount(bucket: string): Promise<number | null> {
  const [usage] = await testDb
    .select()
    .from(schema.generationUsage)
    .where(eq(schema.generationUsage.bucket, bucket));
  return usage?.count ?? null;
}

beforeEach(async () => {
  testDb = await createTestDb();
  afterQueue.callbacks.length = 0;
});

afterEach(() => {
  delete process.env.GUEST_FUNNEL_ENABLED;
  vi.restoreAllMocks();
});

describe("generateDesign: no design row on a refused submit (#197)", () => {
  it("quota-refused unanchored submit on an unseen id leaves no design row", async () => {
    process.env.GUEST_FUNNEL_ENABLED = "true";
    await seedUser();

    // Pre-fill today's identity bucket to the cap so the very next increment
    // is over it — no other rows, no design, nothing pre-existing.
    const day = dayKeyUTC(new Date());
    await testDb.insert(schema.generationUsage).values({
      bucket: "user:u1",
      day,
      count: 50, // USER_GEN_DAILY_CAP default
    });

    const designId = crypto.randomUUID();
    const result = await generateDesign(designId, "a red dragon");

    expect(result.kind).toBe("limit");
    expect(await getDesignRow(designId)).toBeUndefined();
    expect(afterQueue.callbacks).toHaveLength(0);
  });

  it("capacity-refused submit on an unseen id leaves no design row", async () => {
    process.env.GUEST_FUNNEL_ENABLED = "true";
    await seedUser();
    await fillSlots(GENERATION_CONCURRENCY_CAP);

    const designId = crypto.randomUUID();
    const result = await generateDesign(designId, "a red dragon");

    expect(result.kind).toBe("at_capacity");
    expect(await getDesignRow(designId)).toBeUndefined();
    expect(afterQueue.callbacks).toHaveLength(0);
  });

  // Happy path — an allowed submit on an unseen id creates the row with the
  // caller as owner — is already covered by
  // src/app/design/__tests__/explicit-anchor.integration.test.ts
  // ("a fresh design id creates the conversation and generates into it");
  // not duplicated here.

  it("an existing design owned by another user throws Unauthorized and consumes no quota", async () => {
    await seedUser("u1");
    await seedUser("owner2");
    const [theirs] = await testDb
      .insert(schema.design)
      .values({ userId: "owner2" })
      .returning();

    await expect(generateDesign(theirs.id, "a red dragon")).rejects.toThrow(
      "Unauthorized"
    );

    // The row is untouched (still owned by owner2) and no quota bucket was
    // ever created for u1 — the throw happens before consumeGenerationQuota.
    expect((await getDesignRow(theirs.id)).userId).toBe("owner2");
    expect(await quotaCount("user:u1")).toBeNull();
    expect(afterQueue.callbacks).toHaveLength(0);
  });
});

describe("concurrent double-submit on a fresh id (fix round 1)", () => {
  it("both submits win: one row, two jobs, two user turns, quota spent twice — no refund, no throw", async () => {
    process.env.GUEST_FUNNEL_ENABLED = "true";
    await seedUser();
    const designId = crypto.randomUUID();

    // SIMULATED, not true Promise.all concurrency — true concurrency is not
    // reachable in this harness once GUEST_FUNNEL_ENABLED is on. Root cause,
    // confirmed with a minimal two-line repro (`Promise.all([import("@/lib/db"),
    // import("@/lib/db")])` against this same "@/lib/db" mock, in isolation,
    // no generateDesign involved): consumeGenerationQuota's own fallback
    // `(await import("./db")).db` — needed because generateDesign calls it
    // without an injected db — races when awaited twice concurrently, even
    // once the module is already resolved and cached; one of the two in-
    // flight dynamic imports loses vi.mock's interception and the REAL
    // "@/lib/db" module executes, constructing a real libsql client with no
    // DATABASE_URL and throwing. This is a Vitest/vite-node limitation with
    // concurrent dynamic `import()` of a mocked module, unrelated to the
    // #197 fix or to generateDesign's own logic — countRunningJobsForUser
    // and the design-row insert are both called with an explicit `db` and
    // never hit this path; only consumeGenerationQuota's fallback does.
    //
    // Simulated instead: countRunningJobsForUser (called with an explicit
    // db, right after the quota check and right before the design-row
    // insert) is mocked to inject, on its first call only, the FULL effect
    // of a rival submit that already won the race for this designId — its
    // own row, job, user turn, and quota spend — then returns the real
    // running-job count so this call's own capacity check still behaves
    // normally. The real call proceeds into its own insert next, which then
    // hits the just-inserted row's primary-key uniqueness, exercising the
    // exact catch-and-continue path fix round 1 added.
    countRunningJobsForUserMock.mockImplementationOnce(async (userId: string) => {
      await testDb.insert(schema.design).values({ id: designId, userId });
      await testDb.insert(schema.chatMessage).values({
        designId,
        role: "user",
        content: "a blue dragon",
      });
      await testDb.insert(schema.imageGeneration).values({
        designId,
        userId,
        status: "running",
        operation: "generate",
        imageId: crypto.randomUUID(),
        r2Key: "images/rival.png",
        generationNumber: 1,
        dayKey: dayKeyUTC(new Date()),
        cost: 0.03,
        startedAt: new Date(),
      });
      // The real consumeGenerationQuota already ran (and created this
      // bucket/day row at count 1) before this mock fires, so the rival's
      // own spend is an INCREMENT, not a fresh insert — a plain insert here
      // would collide with that already-existing row.
      await testDb
        .update(schema.generationUsage)
        .set({ count: sql`${schema.generationUsage.count} + 1` })
        .where(
          and(
            eq(schema.generationUsage.bucket, `user:${userId}`),
            eq(schema.generationUsage.day, dayKeyUTC(new Date()))
          )
        );
      return 1; // one running job for u1 — comfortably under the cap
    });

    const result = await generateDesign(designId, "a red dragon");

    expect(result.kind).toBe("queued");

    const rows = await testDb
      .select()
      .from(schema.design)
      .where(eq(schema.design.id, designId));
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe("u1");

    const jobRows = await testDb
      .select()
      .from(schema.imageGeneration)
      .where(eq(schema.imageGeneration.designId, designId));
    expect(jobRows).toHaveLength(2);

    const msgs = await testDb
      .select()
      .from(schema.chatMessage)
      .where(eq(schema.chatMessage.designId, designId));
    expect(msgs.filter((m) => m.role === "user")).toHaveLength(2);

    // The rival's simulated spend (1) plus this call's real spend through
    // consumeGenerationQuota (1) — neither refunded.
    expect(await quotaCount("user:u1")).toBe(2);
    expect(afterQueue.callbacks).toHaveLength(1);
  });
});

describe("non-unique insert failure refunds and rethrows (fix round 1)", () => {
  it("an FK violation on the design insert throws and gives the unit back", async () => {
    process.env.GUEST_FUNNEL_ENABLED = "true";
    // Deliberately no seedUser(): the auth mock always returns userId "u1",
    // but with no `user` row for it the design insert's FK
    // (design.user_id -> user.id) rejects — a real, non-unique failure,
    // distinct from the unique-violation race handled above.
    const designId = crypto.randomUUID();

    await expect(generateDesign(designId, "a red dragon")).rejects.toThrow();

    expect(await getDesignRow(designId)).toBeUndefined();
    // Consumed once by consumeGenerationQuota, then refunded once by the
    // outer catch: back to exactly 0, not left at 1 (unrefunded) and not
    // null (never spent).
    expect(await quotaCount("user:u1")).toBe(0);
    expect(afterQueue.callbacks).toHaveLength(0);
  });
});
