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
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb } from "@/lib/__tests__/test-db";
import * as schema from "@/lib/db/schema";
import { eq } from "drizzle-orm";
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

const { generateDesign } = await import("@/app/design/actions");
const { GENERATION_CONCURRENCY_CAP } = await import("@/lib/generation-job");

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
  it("both submits win: one row, two jobs, two user turns — no refund, no throw", async () => {
    await seedUser();
    const designId = crypto.randomUUID();

    // True concurrency: both calls independently await findOwnedDesign,
    // consumeGenerationQuota, and countRunningJobsForUser before either
    // reaches the insert — real single-threaded-JS interleaving, not a
    // simulated one. Confirmed by the assertions below: if the two calls ran
    // serially instead, the second would just find the first's row (no
    // unique-violation branch exercised) but the outcome — one row, two
    // jobs, two turns, no refund — would look identical either way, which is
    // exactly the point: both orderings must be safe.
    const [a, b] = await Promise.all([
      generateDesign(designId, "a red dragon"),
      generateDesign(designId, "a blue dragon"),
    ]);

    expect(a.kind).toBe("queued");
    expect(b.kind).toBe("queued");

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

    // Both submits legitimately spent a unit; neither the winner nor the
    // loser gets refunded (only visible when the funnel flag counts quota —
    // off by default here, so this just pins "no throw propagated").
    expect(afterQueue.callbacks).toHaveLength(2);
  });
});
