/**
 * A generate turn with no words (undefined, "", whitespace) is refused at the
 * top of `generateDesign`: before the replay check, the design lookup, the
 * quota, the capacity check, any write and any model call. It returns
 * `{ kind: "empty" }` rather than throwing, and leaves no trace.
 *
 * Real in-memory libSQL; auth, headers, AI, R2 and the generator are mocked
 * (same harness as generation-quota.integration.test.ts).
 */
import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { createTestDb } from "@/lib/__tests__/test-db";
import { makeUser, makeDesign, makeSourceImage } from "@/lib/__tests__/factories";
import * as schema from "@/lib/db/schema";
import { USER_GEN_DAILY_CAP, dayKeyUTC } from "@/lib/generation-quota";
import { EMPTY_GENERATE_TURN } from "@/lib/action-copy";

type Db = Awaited<ReturnType<typeof createTestDb>>;
let testDb: Db;

const IP = "203.0.113.9";

vi.mock("@/lib/db", () => ({
  get db() {
    return testDb;
  },
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => {
    const hdrs = new Headers();
    hdrs.set("x-forwarded-for", "203.0.113.9");
    return hdrs;
  }),
}));

const afterQueue = vi.hoisted(() => ({ callbacks: [] as Array<() => unknown> }));
vi.mock("next/server", () => ({
  after: (cb: () => unknown) => {
    afterQueue.callbacks.push(cb);
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(async () => ({ user: { id: "u1", isAnonymous: false } })),
    },
  },
  isAnonymousUser: (user: { isAnonymous?: boolean | null }) =>
    user.isAnonymous === true,
}));

vi.mock("@/lib/ai", () => ({
  constructDesignBrief: vi.fn(async () => ({
    operation: "generate",
    message: "Here it is",
    spec: { subject: "a happy cat", elements: [{ type: "obj", desc: "a happy cat" }] },
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
const { constructDesignBrief } = await import("@/lib/ai");
const briefMock = constructDesignBrief as Mock;

async function counts() {
  const [designs, messages, jobs, usage] = await Promise.all([
    testDb.select().from(schema.design),
    testDb.select().from(schema.chatMessage),
    testDb.select().from(schema.imageGeneration),
    testDb.select().from(schema.generationUsage),
  ]);
  return {
    designs: designs.length,
    messages: messages.length,
    jobs: jobs.length,
    usage: usage.length,
  };
}

function expectEmpty(result: Awaited<ReturnType<typeof generateDesign>>) {
  expect(result).toEqual({ kind: "empty", message: EMPTY_GENERATE_TURN });
}

function expectNothingHappened() {
  expect(briefMock).not.toHaveBeenCalled();
  expect(afterQueue.callbacks).toHaveLength(0);
}

beforeEach(async () => {
  testDb = await createTestDb();
  await makeUser(testDb, "u1");
  afterQueue.callbacks.length = 0;
  vi.clearAllMocks();
});

describe("generateDesign — a turn with no words", () => {
  it.each([
    ["undefined", undefined],
    ["an empty string", ""],
    ["whitespace", "   \n\t"],
  ])("refuses %s on a new designId without creating anything", async (_name, text) => {
    const result = await generateDesign(crypto.randomUUID(), text);

    expectEmpty(result);
    expect(await counts()).toEqual({ designs: 0, messages: 0, jobs: 0, usage: 0 });
    expectNothingHappened();
  });

  it("refuses an empty turn on a conversation that already has words and an image", async () => {
    const designId = (await makeDesign(testDb, "u1")).id;
    await testDb
      .insert(schema.chatMessage)
      .values({ designId, role: "user", content: "a dog on a skateboard" });
    await makeSourceImage(testDb, {
      designId,
      ownerId: "u1",
      imageUrl: "https://r2/a.png",
    });
    const before = await counts();

    const result = await generateDesign(designId, "");

    expectEmpty(result);
    expect(await counts()).toEqual(before);
    expectNothingHappened();
  });

  it("refuses an empty turn that names an explicit anchor", async () => {
    const designId = (await makeDesign(testDb, "u1")).id;
    await testDb
      .insert(schema.chatMessage)
      .values({ designId, role: "user", content: "a dog on a skateboard" });
    const anchorId = await makeSourceImage(testDb, {
      designId,
      ownerId: "u1",
      imageUrl: "https://r2/a.png",
    });
    const before = await counts();

    const result = await generateDesign(designId, "", { anchorImageId: anchorId });

    expectEmpty(result);
    expect(await counts()).toEqual(before);
    expectNothingHappened();
  });

  it("answers a user at the daily cap with empty, not limit", async () => {
    await testDb.insert(schema.generationUsage).values({
      bucket: "user:u1",
      day: dayKeyUTC(new Date()),
      count: USER_GEN_DAILY_CAP,
    });
    const before = await testDb.select().from(schema.generationUsage);

    const result = await generateDesign(crypto.randomUUID(), "");

    expectEmpty(result);
    // The capped bucket was neither bumped nor refunded, and no IP bucket
    // appeared.
    expect(await testDb.select().from(schema.generationUsage)).toEqual(before);
    expect(
      (await testDb.select().from(schema.generationUsage)).some(
        (r) => r.bucket === `ip:${IP}`
      )
    ).toBe(false);
    expectNothingHappened();
  });

  it("still validates the job id format first", async () => {
    await expect(
      generateDesign(crypto.randomUUID(), "", { jobId: "not-a-uuid" })
    ).rejects.toThrow("Invalid job id");
  });

  it("still renders a turn with words (the guard does not over-refuse)", async () => {
    const result = await generateDesign(crypto.randomUUID(), "  a happy cat  ");

    expect(result.kind).toBe("queued");
    expect(await testDb.select().from(schema.imageGeneration)).toHaveLength(1);
  });
});
