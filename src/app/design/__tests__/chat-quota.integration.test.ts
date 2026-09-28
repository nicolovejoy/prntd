/**
 * #253: `sendChatMessage` counts each turn against a daily chat cap (per
 * identity, plus per IP for everyone) before the Claude call. A refused turn
 * makes no Anthropic call and writes no chat row, no design row and no
 * `updated_at`; a turn whose Anthropic call throws gives its unit back.
 *
 * Real in-memory libSQL; auth, headers, AI, R2 and the generator are mocked
 * (same harness as conversation-close.integration.test.ts).
 */
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import { createTestDb } from "@/lib/__tests__/test-db";
import { makeUser, makeDesign } from "@/lib/__tests__/factories";
import * as schema from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { CONVERSATION_CLOSED_MESSAGE } from "@/lib/design-view";
import {
  dayKeyUTC,
  GUEST_CHAT_DAILY_CAP,
  USER_CHAT_DAILY_CAP,
  IP_CHAT_DAILY_CAP,
  USER_IP_CHAT_DAILY_CAP,
  CHAT_MESSAGE_MAX_CHARS,
  CHAT_HISTORY_MAX_MESSAGES,
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

// generateDesign hands the render to `after()`; the cross-family tests only
// need the queued result, so the continuations are collected and dropped.
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

const { sendChatMessage, generateDesign } = await import("@/app/design/actions");
const ai = await import("@/lib/ai");
const chatMock = ai.chatAboutDesign as Mock;
const getSessionMock = (await import("@/lib/auth")).auth.api
  .getSession as unknown as Mock;

const GUEST_COPY = "Daily chat limit reached. Sign in to continue.";
const USER_COPY = "Daily chat limit reached. Try again later.";
const TOO_LONG_COPY = "Message too long. Limit is 4,000 characters.";
const IP = "203.0.113.7";

// Literal prefixes on purpose: the test pins the stored bucket format.
const chatUserBucket = (id: string) => `chat:user:${id}`;
const chatIpBucket = (addr: string) => `chat:ip:${addr}`;

/** The UTC day the action will spend on (the real clock, as in production). */
const today = () => dayKeyUTC(new Date());

async function seedUsage(bucket: string, count: number) {
  await testDb
    .insert(schema.generationUsage)
    .values({ bucket, day: today(), count });
}

async function usageCount(bucket: string): Promise<number | null> {
  const rows = await testDb
    .select()
    .from(schema.generationUsage)
    .where(eq(schema.generationUsage.bucket, bucket));
  return rows.find((r) => r.day === today())?.count ?? null;
}

async function chatBucketRows() {
  const rows = await testDb.select().from(schema.generationUsage);
  return rows.filter((r) => r.bucket.startsWith("chat:"));
}

async function chatRows(designId: string) {
  return testDb
    .select()
    .from(schema.chatMessage)
    .where(eq(schema.chatMessage.designId, designId));
}

async function designRows(designId: string) {
  return testDb.select().from(schema.design).where(eq(schema.design.id, designId));
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
  chatMock.mockReset();
  chatMock.mockResolvedValue({ message: "Sure", readyToGenerate: true, options: [] });
  vi.stubEnv("GUEST_FUNNEL_ENABLED", "true");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("guest at the identity cap", () => {
  it("is refused with the guest copy, no Anthropic call, no rows", async () => {
    await makeUser(testDb, "g1");
    actAs("g1", { anonymous: true, ip: IP });
    await seedUsage(chatUserBucket("g1"), GUEST_CHAT_DAILY_CAP);
    const newDesignId = crypto.randomUUID();

    const result = await sendChatMessage(newDesignId, "hello");

    expect(result).toEqual({ kind: "limit", message: GUEST_COPY });
    expect(chatMock).not.toHaveBeenCalled();
    expect(await chatRows(newDesignId)).toHaveLength(0);
    expect(await designRows(newDesignId)).toHaveLength(0);
  });

  it("leaves an existing design's updated_at and chat rows untouched", async () => {
    await makeUser(testDb, "g1");
    const design = await makeDesign(testDb, "g1");
    const stamp = new Date("2026-01-01T00:00:00Z");
    await testDb
      .update(schema.design)
      .set({ updatedAt: stamp })
      .where(eq(schema.design.id, design.id));
    actAs("g1", { anonymous: true, ip: IP });
    await seedUsage(chatUserBucket("g1"), GUEST_CHAT_DAILY_CAP);

    const result = await sendChatMessage(design.id, "hello");

    expect(result.kind).toBe("limit");
    expect(chatMock).not.toHaveBeenCalled();
    expect(await chatRows(design.id)).toHaveLength(0);
    const [row] = await designRows(design.id);
    expect(row.updatedAt.getTime()).toBe(stamp.getTime());
  });
});

describe("guest funnel flag off", () => {
  it("still enforces the chat cap", async () => {
    vi.stubEnv("GUEST_FUNNEL_ENABLED", "false");
    await makeUser(testDb, "g1");
    const design = await makeDesign(testDb, "g1");
    actAs("g1", { anonymous: true, ip: IP });
    await seedUsage(chatUserBucket("g1"), GUEST_CHAT_DAILY_CAP);

    const result = await sendChatMessage(design.id, "hello");

    expect(result).toEqual({ kind: "limit", message: GUEST_COPY });
    expect(chatMock).not.toHaveBeenCalled();
  });
});

describe("signed-in user at the identity cap", () => {
  it("is refused with the signed-in copy", async () => {
    await makeUser(testDb, "u1");
    const design = await makeDesign(testDb, "u1");
    await seedUsage(chatUserBucket("u1"), USER_CHAT_DAILY_CAP);

    const result = await sendChatMessage(design.id, "hello");

    expect(result).toEqual({ kind: "limit", message: USER_COPY });
    expect(chatMock).not.toHaveBeenCalled();
    expect(await chatRows(design.id)).toHaveLength(0);
  });
});

describe("IP cap", () => {
  it("refuses a guest on an IP at cap; a signed-in user on that IP is allowed", async () => {
    await makeUser(testDb, "g1");
    await makeUser(testDb, "u1");
    await seedUsage(chatIpBucket(IP), IP_CHAT_DAILY_CAP);

    actAs("g1", { anonymous: true, ip: IP });
    const guestDesign = await makeDesign(testDb, "g1");
    const refused = await sendChatMessage(guestDesign.id, "hello");
    expect(refused).toEqual({ kind: "limit", message: GUEST_COPY });
    expect(chatMock).not.toHaveBeenCalled();
    expect(await chatRows(guestDesign.id)).toHaveLength(0);

    // A refused guest on a never-seen id leaves no design row either.
    const newDesignId = crypto.randomUUID();
    const refusedNew = await sendChatMessage(newDesignId, "hello");
    expect(refusedNew.kind).toBe("limit");
    expect(await chatRows(newDesignId)).toHaveLength(0);
    expect(await designRows(newDesignId)).toHaveLength(0);

    actAs("u1", { ip: IP });
    const userDesign = await makeDesign(testDb, "u1");
    const allowed = await sendChatMessage(userDesign.id, "hello");
    expect(allowed.kind).toBe("reply");
    expect(chatMock).toHaveBeenCalledTimes(1);
    // Two refused guest turns and the signed-in turn each bumped the IP bucket.
    expect(await usageCount(chatIpBucket(IP))).toBe(IP_CHAT_DAILY_CAP + 3);
  });

  it("refuses a signed-in user over the signed-in IP cap with the signed-in copy", async () => {
    await makeUser(testDb, "u1");
    const design = await makeDesign(testDb, "u1");
    await seedUsage(chatIpBucket(IP), USER_IP_CHAT_DAILY_CAP);
    actAs("u1", { ip: IP });

    const result = await sendChatMessage(design.id, "hello");

    expect(result).toEqual({ kind: "limit", message: USER_COPY });
    expect(chatMock).not.toHaveBeenCalled();
    expect(await chatRows(design.id)).toHaveLength(0);

    // A guest on the same IP is refused too (over the lower guest IP cap).
    await makeUser(testDb, "g1");
    const guestDesign = await makeDesign(testDb, "g1");
    actAs("g1", { anonymous: true, ip: IP });
    const guest = await sendChatMessage(guestDesign.id, "hello");
    expect(guest).toEqual({ kind: "limit", message: GUEST_COPY });
    expect(chatMock).not.toHaveBeenCalled();
  });
});

describe("message validation", () => {
  it("rejects a message over the limit before any quota spend or row write", async () => {
    await makeUser(testDb, "u1");
    actAs("u1", { ip: IP });
    const newDesignId = crypto.randomUUID();

    const result = await sendChatMessage(
      newDesignId,
      "x".repeat(CHAT_MESSAGE_MAX_CHARS + 1)
    );

    expect(result).toEqual({ kind: "too_long", message: TOO_LONG_COPY });
    expect(chatMock).not.toHaveBeenCalled();
    expect(await chatBucketRows()).toHaveLength(0);
    expect(await chatRows(newDesignId)).toHaveLength(0);
    expect(await designRows(newDesignId)).toHaveLength(0);
  });

  it("accepts a message of exactly the limit", async () => {
    await makeUser(testDb, "u1");
    const design = await makeDesign(testDb, "u1");

    const result = await sendChatMessage(design.id, "x".repeat(CHAT_MESSAGE_MAX_CHARS));

    expect(result.kind).toBe("reply");
    expect(chatMock).toHaveBeenCalledTimes(1);
  });

  it("throws on a non-string message", async () => {
    await makeUser(testDb, "u1");
    const design = await makeDesign(testDb, "u1");

    await expect(
      sendChatMessage(design.id, 42 as unknown as string)
    ).rejects.toThrow("Invalid message");
    expect(chatMock).not.toHaveBeenCalled();
    expect(await chatBucketRows()).toHaveLength(0);
  });
});

describe("history window", () => {
  it("sends the latest 40 messages, in order, starting on a user turn", async () => {
    await makeUser(testDb, "u1");
    const design = await makeDesign(testDb, "u1");
    const base = Date.UTC(2026, 0, 1);
    // Index 0 is an assistant row, so index 10 (the first of the latest 40) is
    // an assistant row too and gets dropped; odd indexes are user rows.
    await testDb.insert(schema.chatMessage).values(
      Array.from({ length: 50 }, (_, i) => ({
        designId: design.id,
        role: (i % 2 === 0 ? "assistant" : "user") as "assistant" | "user",
        content: `m${i}`,
        createdAt: new Date(base + i * 1000),
      }))
    );

    await sendChatMessage(design.id, "hello");

    const history = chatMock.mock.calls[0][1] as Array<{ role: string; content: string }>;
    expect(history).toHaveLength(CHAT_HISTORY_MAX_MESSAGES - 1);
    expect(history[0].role).toBe("user");
    expect(history.map((m) => m.content)).toEqual(
      Array.from({ length: 39 }, (_, i) => `m${i + 11}`)
    );
  });

  it("keeps all 40 when the window already starts on a user turn", async () => {
    await makeUser(testDb, "u1");
    const design = await makeDesign(testDb, "u1");
    const base = Date.UTC(2026, 0, 1);
    await testDb.insert(schema.chatMessage).values(
      Array.from({ length: 50 }, (_, i) => ({
        designId: design.id,
        role: (i % 2 === 0 ? "user" : "assistant") as "assistant" | "user",
        content: `m${i}`,
        createdAt: new Date(base + i * 1000),
      }))
    );

    await sendChatMessage(design.id, "hello");

    const history = chatMock.mock.calls[0][1] as Array<{ role: string; content: string }>;
    expect(history).toHaveLength(CHAT_HISTORY_MAX_MESSAGES);
    expect(history[0].content).toBe("m10");
    expect(history[0].role).toBe("user");
  });
});

describe("under the cap", () => {
  it("returns the reply, writes both chat rows and counts one unit", async () => {
    await makeUser(testDb, "u1");
    const design = await makeDesign(testDb, "u1");

    const result = await sendChatMessage(design.id, "hello");

    expect(result).toEqual({
      kind: "reply",
      message: "Sure",
      readyToGenerate: true,
      options: [],
    });
    const rows = await chatRows(design.id);
    expect(rows.map((r) => r.role).sort()).toEqual(["assistant", "user"]);
    expect(await usageCount(chatUserBucket("u1"))).toBe(1);
  });

  it("creates the design row for a new id once the quota admits the turn", async () => {
    await makeUser(testDb, "u1");
    const newDesignId = crypto.randomUUID();

    const result = await sendChatMessage(newDesignId, "hello");

    expect(result.kind).toBe("reply");
    expect(await designRows(newDesignId)).toHaveLength(1);
  });
});

describe("Anthropic throws", () => {
  it("rejects, refunds the unit and writes no chat rows", async () => {
    await makeUser(testDb, "u1");
    const design = await makeDesign(testDb, "u1");
    chatMock.mockRejectedValueOnce(new Error("upstream down"));

    await expect(sendChatMessage(design.id, "hello")).rejects.toThrow("upstream down");

    expect(await usageCount(chatUserBucket("u1"))).toBe(0);
    expect(await chatRows(design.id)).toHaveLength(0);
  });

  it("refunds a guest's identity and IP units", async () => {
    await makeUser(testDb, "g1");
    const design = await makeDesign(testDb, "g1");
    actAs("g1", { anonymous: true, ip: IP });
    chatMock.mockRejectedValueOnce(new Error("upstream down"));

    await expect(sendChatMessage(design.id, "hello")).rejects.toThrow("upstream down");

    expect(await usageCount(chatUserBucket("g1"))).toBe(0);
    expect(await usageCount(chatIpBucket(IP))).toBe(0);
  });

  it("refunds a signed-in user's identity and IP units", async () => {
    await makeUser(testDb, "u1");
    const design = await makeDesign(testDb, "u1");
    actAs("u1", { ip: IP });
    chatMock.mockRejectedValueOnce(new Error("upstream down"));

    await expect(sendChatMessage(design.id, "hello")).rejects.toThrow("upstream down");

    expect(await usageCount(chatUserBucket("u1"))).toBe(0);
    expect(await usageCount(chatIpBucket(IP))).toBe(0);
  });

  it("refunds when the throw comes on a brand-new design id", async () => {
    // Stands in for a getOrCreateDesign race loss: any throw on the new-id
    // path, before Claude answers, gives the unit back. getOrCreateDesign has
    // already inserted the design row by the time Claude is called, so the
    // (empty) row remains; only the bucket is restored.
    await makeUser(testDb, "u1");
    const newDesignId = crypto.randomUUID();
    chatMock.mockRejectedValueOnce(new Error("upstream down"));

    await expect(sendChatMessage(newDesignId, "hello")).rejects.toThrow("upstream down");

    expect(await usageCount(chatUserBucket("u1"))).toBe(0);
    expect(await chatRows(newDesignId)).toHaveLength(0);
    expect(await designRows(newDesignId)).toHaveLength(1);
  });
});

describe("persistence fails after Claude answered", () => {
  it("rejects and keeps the unit spent (the call was billed)", async () => {
    await makeUser(testDb, "u1");
    const design = await makeDesign(testDb, "u1");
    // The reads before the call succeed; the table is gone by the time the
    // action goes to write the turn.
    chatMock.mockImplementationOnce(async () => {
      await testDb.run(sql`DROP TABLE chat_message`);
      return { message: "Sure", readyToGenerate: true, options: [] };
    });

    await expect(sendChatMessage(design.id, "hello")).rejects.toThrow();

    expect(chatMock).toHaveBeenCalledTimes(1);
    expect(await usageCount(chatUserBucket("u1"))).toBe(1);
  });
});

describe("refused before the quota spend", () => {
  it("a closed conversation throws and bumps no chat bucket", async () => {
    await makeUser(testDb, "u1");
    const design = await makeDesign(testDb, "u1");
    await testDb
      .update(schema.design)
      .set({ closedAt: new Date() })
      .where(eq(schema.design.id, design.id));

    await expect(sendChatMessage(design.id, "hello")).rejects.toThrow(
      CONVERSATION_CLOSED_MESSAGE
    );

    expect(await chatBucketRows()).toHaveLength(0);
    expect(chatMock).not.toHaveBeenCalled();
  });

  it("a foreign design throws Unauthorized and bumps no chat bucket", async () => {
    await makeUser(testDb, "u1");
    await makeUser(testDb, "u2");
    const theirs = await makeDesign(testDb, "u2");

    await expect(sendChatMessage(theirs.id, "hello")).rejects.toThrow("Unauthorized");

    expect(await chatBucketRows()).toHaveLength(0);
    expect(chatMock).not.toHaveBeenCalled();
  });
});

describe("concurrency", () => {
  it("two concurrent turns at cap - 1 give one reply and one limit", async () => {
    await makeUser(testDb, "u1");
    const design = await makeDesign(testDb, "u1");
    await seedUsage(chatUserBucket("u1"), USER_CHAT_DAILY_CAP - 1);

    const results = await Promise.all([
      sendChatMessage(design.id, "one"),
      sendChatMessage(design.id, "two"),
    ]);

    expect(results.map((r) => r.kind).sort()).toEqual(["limit", "reply"]);
    expect(chatMock).toHaveBeenCalledTimes(1);
    expect(await chatRows(design.id)).toHaveLength(2);
  });

  it("two guest turns on one IP at the IP cap - 1 give one reply and one limit", async () => {
    await makeUser(testDb, "g1");
    await makeUser(testDb, "g2");
    const d1 = await makeDesign(testDb, "g1");
    const d2 = await makeDesign(testDb, "g2");
    await seedUsage(chatIpBucket(IP), IP_CHAT_DAILY_CAP - 1);

    // Each call gets its own session; the guests share only the IP bucket.
    h.ip = IP;
    for (const id of ["g1", "g2"]) {
      getSessionMock.mockImplementationOnce(async () => ({
        user: { id, isAnonymous: true },
      }));
    }

    const results = await Promise.all([
      sendChatMessage(d1.id, "one"),
      sendChatMessage(d2.id, "two"),
    ]);

    expect(results.map((r) => r.kind).sort()).toEqual(["limit", "reply"]);
    expect(chatMock).toHaveBeenCalledTimes(1);
  });

  it("two signed-in turns on one IP at the signed-in IP cap - 1 give one reply and one limit", async () => {
    await makeUser(testDb, "u1");
    await makeUser(testDb, "u2");
    const d1 = await makeDesign(testDb, "u1");
    const d2 = await makeDesign(testDb, "u2");
    await seedUsage(chatIpBucket(IP), USER_IP_CHAT_DAILY_CAP - 1);

    h.ip = IP;
    for (const id of ["u1", "u2"]) {
      getSessionMock.mockImplementationOnce(async () => ({
        user: { id, isAnonymous: false },
      }));
    }

    const results = await Promise.all([
      sendChatMessage(d1.id, "one"),
      sendChatMessage(d2.id, "two"),
    ]);

    expect(results.map((r) => r.kind).sort()).toEqual(["limit", "reply"]);
    expect(chatMock).toHaveBeenCalledTimes(1);
  });
});

describe("chat and generation caps are independent", () => {
  it("chat at cap does not refuse generateDesign", async () => {
    await makeUser(testDb, "u1");
    await seedUsage(chatUserBucket("u1"), USER_CHAT_DAILY_CAP);

    const design = await makeDesign(testDb, "u1");
    const result = await generateDesign(design.id, "a red dragon");

    expect(result.kind).toBe("queued");
  });

  it("generation at cap does not refuse sendChatMessage", async () => {
    await makeUser(testDb, "u1");
    actAs("u1", { ip: IP });
    // Generation counters at the CHAT caps (above the generation caps), so a
    // chat path that read the generation buckets would refuse.
    await seedUsage("user:u1", USER_CHAT_DAILY_CAP);
    await seedUsage(`ip:${IP}`, USER_IP_CHAT_DAILY_CAP);
    const design = await makeDesign(testDb, "u1");

    // The seed really does block generation.
    const blocked = await generateDesign(design.id, "a red dragon");
    expect(blocked.kind).toBe("limit");

    const result = await sendChatMessage(design.id, "hello");
    expect(result.kind).toBe("reply");
    expect(await usageCount(chatUserBucket("u1"))).toBe(1);
    expect(await usageCount(chatIpBucket(IP))).toBe(1);
  });
});
