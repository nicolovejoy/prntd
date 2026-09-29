/**
 * #263: `generateDesign` daily cap at the action level. The IP bucket is
 * checked against IP_GEN_DAILY_CAP for guests and USER_IP_GEN_DAILY_CAP for
 * signed-in users; refusal copy differs by caller; and the refund a concurrent
 * replay issues from the refused branch credits only what was bumped (an
 * identity refusal never bumped the IP bucket).
 *
 * Real in-memory libSQL; auth, headers, AI, R2 and the generator are mocked
 * (same harness as chat-quota.integration.test.ts).
 */
import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { createTestDb } from "@/lib/__tests__/test-db";
import { makeUser } from "@/lib/__tests__/factories";
import * as schema from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  dayKeyUTC,
  GUEST_GEN_DAILY_CAP,
  IP_GEN_DAILY_CAP,
  USER_IP_GEN_DAILY_CAP,
} from "@/lib/generation-quota";

type Db = Awaited<ReturnType<typeof createTestDb>>;
let testDb: Db;

const h = vi.hoisted(() => ({
  userId: "u1",
  isAnonymous: false,
  ip: null as string | null,
}));

vi.mock("@/lib/db", () => ({
  get db() {
    return testDb;
  },
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => {
    const hdrs = new Headers();
    if (h.ip) hdrs.set("x-forwarded-for", h.ip);
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
      getSession: vi.fn(async () => ({
        user: { id: h.userId, isAnonymous: h.isAnonymous },
      })),
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
  chatAboutDesign: vi.fn(async () => ({
    message: "Sure",
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

// Wrapped, not replaced: real quota math, except where a test uses
// `mockImplementationOnce` to land a rival job row from inside the call (the
// only way to place it between the pre-quota replay check and the refusal).
const quotaModuleState = vi.hoisted(() => ({
  actual: undefined as unknown as typeof import("@/lib/generation-quota"),
}));
vi.mock("@/lib/generation-quota", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/generation-quota")>();
  quotaModuleState.actual = actual;
  return { ...actual, consumeGenerationQuota: vi.fn(actual.consumeGenerationQuota) };
});

const { generateDesign } = await import("@/app/design/actions");
const quotaModule = await import("@/lib/generation-quota");
const consumeQuotaMock = quotaModule.consumeGenerationQuota as Mock;

const IP = "203.0.113.9";

const GUEST_IP_COPY =
  "This network has hit today's free design limit. Sign in to keep designing.";
const GUEST_IDENTITY_COPY =
  "You've reached today's free design limit. Sign in to keep designing.";
const USER_IP_COPY = "This network has hit today's design limit. Try again later.";
const USER_IDENTITY_COPY = "You've reached today's design limit. Try again later.";

const today = () => dayKeyUTC(new Date());

async function seedUsage(bucket: string, count: number) {
  await testDb.insert(schema.generationUsage).values({ bucket, day: today(), count });
}

async function usageCount(bucket: string): Promise<number | null> {
  const rows = await testDb
    .select()
    .from(schema.generationUsage)
    .where(eq(schema.generationUsage.bucket, bucket));
  return rows.find((r) => r.day === today())?.count ?? null;
}

async function insertRivalJob(designId: string, jobId: string, userId: string) {
  await testDb.insert(schema.imageGeneration).values({
    id: jobId,
    designId,
    userId,
    status: "running",
    operation: "generate",
    imageId: crypto.randomUUID(),
    r2Key: "images/rival.png",
    generationNumber: 1,
    dayKey: today(),
    cost: 0.03,
    startedAt: new Date(),
  });
}

function actAs(id: string, opts: { anonymous?: boolean; ip?: string | null } = {}) {
  h.userId = id;
  h.isAnonymous = opts.anonymous ?? false;
  h.ip = opts.ip ?? null;
}

beforeEach(async () => {
  testDb = await createTestDb();
  actAs("u1");
  afterQueue.callbacks.length = 0;
  vi.stubEnv("GUEST_FUNNEL_ENABLED", "true");
});

describe("generateDesign — refusal copy by caller (#263)", () => {
  it("a signed-in user refused on the IP bucket is not told to sign in", async () => {
    await makeUser(testDb, "u1");
    actAs("u1", { ip: IP });
    await seedUsage(`ip:${IP}`, USER_IP_GEN_DAILY_CAP);

    const res = await generateDesign(crypto.randomUUID(), "a red dragon");

    expect(res).toEqual({ kind: "limit", message: USER_IP_COPY });
    expect(afterQueue.callbacks).toHaveLength(0);
  });

  it("a signed-in user is not refused by the guest IP cap", async () => {
    await makeUser(testDb, "u1");
    actAs("u1", { ip: IP });
    await seedUsage(`ip:${IP}`, IP_GEN_DAILY_CAP + 5);

    const res = await generateDesign(crypto.randomUUID(), "a red dragon");

    expect(res.kind).toBe("queued");
  });

  it("a signed-in user refused on identity gets the try-again-tomorrow copy", async () => {
    await makeUser(testDb, "u1");
    actAs("u1", { ip: IP });
    const { USER_GEN_DAILY_CAP } = quotaModuleState.actual;
    await seedUsage("user:u1", USER_GEN_DAILY_CAP);

    const res = await generateDesign(crypto.randomUUID(), "a red dragon");

    expect(res).toEqual({ kind: "limit", message: USER_IDENTITY_COPY });
  });

  it("a guest refused on the IP bucket still gets the guest copy", async () => {
    await makeUser(testDb, "g1");
    actAs("g1", { anonymous: true, ip: IP });
    await seedUsage(`ip:${IP}`, IP_GEN_DAILY_CAP);

    const res = await generateDesign(crypto.randomUUID(), "a red dragon");

    expect(res).toEqual({ kind: "limit", message: GUEST_IP_COPY });
  });

  it("a guest refused on identity still gets the guest copy", async () => {
    await makeUser(testDb, "g1");
    actAs("g1", { anonymous: true, ip: IP });
    await seedUsage("user:g1", GUEST_GEN_DAILY_CAP);

    const res = await generateDesign(crypto.randomUUID(), "a red dragon");

    expect(res).toEqual({ kind: "limit", message: GUEST_IDENTITY_COPY });
    expect(await usageCount(`ip:${IP}`)).toBeNull();
  });
});

describe("generateDesign — replay refund after a refusal (#263)", () => {
  it("an identity-refused concurrent replay leaves the ip: bucket unchanged", async () => {
    await makeUser(testDb, "g1");
    actAs("g1", { anonymous: true, ip: IP });
    const designId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    await testDb.insert(schema.design).values({ id: designId, userId: "g1" });
    await seedUsage("user:g1", GUEST_GEN_DAILY_CAP);
    await seedUsage(`ip:${IP}`, 5);

    consumeQuotaMock.mockImplementationOnce(async (opts) => {
      await insertRivalJob(designId, jobId, opts.userId);
      return quotaModuleState.actual.consumeGenerationQuota(opts);
    });

    const res = await generateDesign(designId, "a red dragon", { jobId });

    expect(res.kind).toBe("queued");
    expect(res.kind === "queued" && res.jobId).toBe(jobId);
    // The refused call bumped identity only, and the refund credits identity only.
    expect(await usageCount("user:g1")).toBe(GUEST_GEN_DAILY_CAP);
    expect(await usageCount(`ip:${IP}`)).toBe(5);
  });

  it("an ip-refused concurrent replay refunds both buckets it bumped", async () => {
    await makeUser(testDb, "u1");
    actAs("u1", { ip: IP });
    const designId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    await testDb.insert(schema.design).values({ id: designId, userId: "u1" });
    await seedUsage(`ip:${IP}`, USER_IP_GEN_DAILY_CAP);

    consumeQuotaMock.mockImplementationOnce(async (opts) => {
      await insertRivalJob(designId, jobId, opts.userId);
      return quotaModuleState.actual.consumeGenerationQuota(opts);
    });

    const res = await generateDesign(designId, "a red dragon", { jobId });

    expect(res.kind).toBe("queued");
    expect(await usageCount("user:u1")).toBe(0);
    expect(await usageCount(`ip:${IP}`)).toBe(USER_IP_GEN_DAILY_CAP);
  });
});
