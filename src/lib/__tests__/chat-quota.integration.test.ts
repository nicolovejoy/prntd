/**
 * DB-path coverage for the chat quota (#253 Task 1). Mirrors
 * generation-quota.integration.test.ts's pattern against a real in-memory
 * libSQL, but exercises the chat: bucket family and its isolation from the
 * generation user:/ip: family.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb } from "./test-db";
import * as schema from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import {
  consumeChatQuota,
  refundChatQuota,
  consumeGenerationQuota,
  refundGenerationQuota,
  GUEST_CHAT_DAILY_CAP,
  USER_CHAT_DAILY_CAP,
  IP_CHAT_DAILY_CAP,
  GUEST_GEN_DAILY_CAP,
  IP_GEN_DAILY_CAP,
} from "@/lib/generation-quota";

type Db = Awaited<ReturnType<typeof createTestDb>>;
let testDb: Db;

const NOW = new Date("2026-07-18T12:00:00Z");
const DAY = "2026-07-18";

async function countFor(db: Db, bucket: string, day: string = DAY): Promise<number | null> {
  const [row] = await db
    .select({ c: schema.generationUsage.count })
    .from(schema.generationUsage)
    .where(
      and(
        eq(schema.generationUsage.bucket, bucket),
        eq(schema.generationUsage.day, day)
      )
    );
  return row?.c ?? null;
}

describe("consumeChatQuota — DB path", () => {
  beforeEach(async () => {
    testDb = await createTestDb();
    delete process.env.GUEST_FUNNEL_ENABLED;
  });
  afterEach(() => {
    delete process.env.GUEST_FUNNEL_ENABLED;
  });

  it("defaults to 24/150/60 when the env vars are unset", async () => {
    const keys = ["GUEST_CHAT_DAILY_CAP", "USER_CHAT_DAILY_CAP", "IP_CHAT_DAILY_CAP"] as const;
    const saved = keys.map((k) => process.env[k]);
    keys.forEach((k) => delete process.env[k]);
    try {
      vi.resetModules();
      const mod = await import("@/lib/generation-quota");
      expect(mod.GUEST_CHAT_DAILY_CAP).toBe(24);
      expect(mod.USER_CHAT_DAILY_CAP).toBe(150);
      expect(mod.IP_CHAT_DAILY_CAP).toBe(60);
    } finally {
      keys.forEach((k, i) => {
        const v = saved[i];
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      });
      vi.resetModules();
    }
  });

  it("allows a guest through the cap and refuses with reason identity past it", async () => {
    let last;
    for (let i = 0; i < GUEST_CHAT_DAILY_CAP; i++) {
      last = await consumeChatQuota({
        userId: "guest",
        isAnonymous: true,
        ip: "9.9.9.1",
        now: NOW,
        db: testDb,
      });
      expect(last).toEqual({ allowed: true });
    }
    last = await consumeChatQuota({
      userId: "guest",
      isAnonymous: true,
      ip: "9.9.9.1",
      now: NOW,
      db: testDb,
    });
    expect(last).toEqual({ allowed: false, reason: "identity" });
  });

  it("allows a signed-in user through the larger cap, refuses past it, and writes no chat:ip: row", async () => {
    let last;
    for (let i = 0; i < USER_CHAT_DAILY_CAP; i++) {
      last = await consumeChatQuota({
        userId: "real",
        isAnonymous: false,
        ip: "9.9.9.2",
        now: NOW,
        db: testDb,
      });
      expect(last).toEqual({ allowed: true });
    }
    last = await consumeChatQuota({
      userId: "real",
      isAnonymous: false,
      ip: "9.9.9.2",
      now: NOW,
      db: testDb,
    });
    expect(last).toEqual({ allowed: false, reason: "identity" });
    expect(await countFor(testDb, "chat:ip:9.9.9.2")).toBeNull();
  });

  it("caps the IP across multiple guest identities, and a signed-in user on that IP is unaffected", async () => {
    let last;
    for (let i = 0; i < IP_CHAT_DAILY_CAP; i++) {
      const guestId = `guest-${i % 3}`;
      last = await consumeChatQuota({
        userId: guestId,
        isAnonymous: true,
        ip: "9.9.9.3",
        now: NOW,
        db: testDb,
      });
      expect(last).toEqual({ allowed: true });
    }
    last = await consumeChatQuota({
      userId: "guest-overflow",
      isAnonymous: true,
      ip: "9.9.9.3",
      now: NOW,
      db: testDb,
    });
    expect(last).toEqual({ allowed: false, reason: "ip" });

    const signedIn = await consumeChatQuota({
      userId: "real-on-shared-ip",
      isAnonymous: false,
      ip: "9.9.9.3",
      now: NOW,
      db: testDb,
    });
    expect(signedIn).toEqual({ allowed: true });
  });

  it("does not bump chat:ip: when a guest is refused on identity", async () => {
    for (let i = 0; i < GUEST_CHAT_DAILY_CAP; i++) {
      await consumeChatQuota({
        userId: "guest-at-cap",
        isAnonymous: true,
        ip: "9.9.9.4",
        now: NOW,
        db: testDb,
      });
    }
    expect(await countFor(testDb, "chat:ip:9.9.9.4")).toBe(GUEST_CHAT_DAILY_CAP);

    const refused = await consumeChatQuota({
      userId: "guest-at-cap",
      isAnonymous: true,
      ip: "9.9.9.4",
      now: NOW,
      db: testDb,
    });
    expect(refused).toEqual({ allowed: false, reason: "identity" });
    expect(await countFor(testDb, "chat:ip:9.9.9.4")).toBe(GUEST_CHAT_DAILY_CAP);
  });

  it("bumps the identity bucket even when the IP bucket then refuses the guest", async () => {
    for (let i = 0; i < IP_CHAT_DAILY_CAP; i++) {
      await consumeChatQuota({
        userId: `guest-fill-${i}`,
        isAnonymous: true,
        ip: "9.9.9.14",
        now: NOW,
        db: testDb,
      });
    }
    const refused = await consumeChatQuota({
      userId: "guest-ip-refused",
      isAnonymous: true,
      ip: "9.9.9.14",
      now: NOW,
      db: testDb,
    });
    expect(refused).toEqual({ allowed: false, reason: "ip" });
    expect(await countFor(testDb, "chat:user:guest-ip-refused")).toBe(1);
  });

  it("is enforced even with GUEST_FUNNEL_ENABLED unset", async () => {
    expect(process.env.GUEST_FUNNEL_ENABLED).toBeUndefined();
    let last;
    for (let i = 0; i < GUEST_CHAT_DAILY_CAP + 1; i++) {
      last = await consumeChatQuota({
        userId: "guest-flagless",
        isAnonymous: true,
        ip: null,
        now: NOW,
        db: testDb,
      });
    }
    expect(last).toEqual({ allowed: false, reason: "identity" });
  });

  it("admits exactly one of two concurrent calls at the identity cap - 1", async () => {
    for (let i = 0; i < GUEST_CHAT_DAILY_CAP - 1; i++) {
      await consumeChatQuota({
        userId: "guest-race",
        isAnonymous: true,
        ip: null,
        now: NOW,
        db: testDb,
      });
    }
    const [a, b] = await Promise.all([
      consumeChatQuota({ userId: "guest-race", isAnonymous: true, ip: null, now: NOW, db: testDb }),
      consumeChatQuota({ userId: "guest-race", isAnonymous: true, ip: null, now: NOW, db: testDb }),
    ]);
    const allowedCount = [a, b].filter((r) => r.allowed).length;
    expect(allowedCount).toBe(1);
  });

  it("admits exactly one of two concurrent calls at the IP cap - 1", async () => {
    for (let i = 0; i < IP_CHAT_DAILY_CAP - 1; i++) {
      await consumeChatQuota({
        userId: `guest-ip-race-${i}`,
        isAnonymous: true,
        ip: "9.9.9.5",
        now: NOW,
        db: testDb,
      });
    }
    const [a, b] = await Promise.all([
      consumeChatQuota({ userId: "guest-ip-race-a", isAnonymous: true, ip: "9.9.9.5", now: NOW, db: testDb }),
      consumeChatQuota({ userId: "guest-ip-race-b", isAnonymous: true, ip: "9.9.9.5", now: NOW, db: testDb }),
    ]);
    const allowedCount = [a, b].filter((r) => r.allowed).length;
    expect(allowedCount).toBe(1);
  });
});

describe("chat vs generation bucket isolation", () => {
  beforeEach(async () => {
    testDb = await createTestDb();
    process.env.GUEST_FUNNEL_ENABLED = "true";
  });
  afterEach(() => {
    delete process.env.GUEST_FUNNEL_ENABLED;
  });

  it("a user at the generation identity cap is still allowed chat", async () => {
    let gen;
    for (let i = 0; i < GUEST_GEN_DAILY_CAP + 1; i++) {
      gen = await consumeGenerationQuota({
        userId: "u1",
        isAnonymous: true,
        ip: "9.9.9.6",
        now: NOW,
        db: testDb,
      });
    }
    expect(gen).toEqual({ allowed: false, reason: "identity" });
    const chatRes = await consumeChatQuota({
      userId: "u1",
      isAnonymous: true,
      ip: "9.9.9.6",
      now: NOW,
      db: testDb,
    });
    expect(chatRes).toEqual({ allowed: true });
  });

  it("a guest on an IP at the generation IP cap is still allowed chat", async () => {
    // Three guests on one IP, each under the identity cap, so the IP cap decides.
    let gen;
    for (let i = 0; i < IP_GEN_DAILY_CAP + 1; i++) {
      gen = await consumeGenerationQuota({
        userId: `ipg-${i % 3}`,
        isAnonymous: true,
        ip: "9.9.9.13",
        now: NOW,
        db: testDb,
      });
    }
    expect(gen).toEqual({ allowed: false, reason: "ip" });
    const chatRes = await consumeChatQuota({
      userId: "ipg-0",
      isAnonymous: true,
      ip: "9.9.9.13",
      now: NOW,
      db: testDb,
    });
    expect(chatRes).toEqual({ allowed: true });
  });

  it("a user at the chat cap is still allowed generation", async () => {
    let chat;
    for (let i = 0; i < GUEST_CHAT_DAILY_CAP; i++) {
      chat = await consumeChatQuota({
        userId: "u2",
        isAnonymous: true,
        ip: "9.9.9.7",
        now: NOW,
        db: testDb,
      });
    }
    expect(chat).toEqual({ allowed: true });
    const refused = await consumeChatQuota({
      userId: "u2",
      isAnonymous: true,
      ip: "9.9.9.7",
      now: NOW,
      db: testDb,
    });
    expect(refused).toEqual({ allowed: false, reason: "identity" });
    const genRes = await consumeGenerationQuota({
      userId: "u2",
      isAnonymous: true,
      ip: "9.9.9.7",
      now: NOW,
      db: testDb,
    });
    expect(genRes).toEqual({ allowed: true });
  });

  it("chat turns leave user:/ip: rows untouched; generation leaves chat: rows untouched", async () => {
    await consumeChatQuota({ userId: "u3", isAnonymous: true, ip: "9.9.9.8", now: NOW, db: testDb });
    expect(await countFor(testDb, "user:u3")).toBeNull();
    expect(await countFor(testDb, "ip:9.9.9.8")).toBeNull();

    await consumeGenerationQuota({ userId: "u3", isAnonymous: true, ip: "9.9.9.8", now: NOW, db: testDb });
    expect(await countFor(testDb, "chat:user:u3")).toBe(1);
    expect(await countFor(testDb, "chat:ip:9.9.9.8")).toBe(1);
  });

  it("refundGenerationQuota leaves chat: rows untouched and refundChatQuota leaves user:/ip: rows untouched", async () => {
    await consumeChatQuota({ userId: "u4", isAnonymous: true, ip: "9.9.9.9", now: NOW, db: testDb });
    await consumeGenerationQuota({ userId: "u4", isAnonymous: true, ip: "9.9.9.9", now: NOW, db: testDb });

    await refundGenerationQuota({ userId: "u4", ip: "9.9.9.9", now: NOW, db: testDb });
    expect(await countFor(testDb, "chat:user:u4")).toBe(1);
    expect(await countFor(testDb, "chat:ip:9.9.9.9")).toBe(1);

    await refundChatQuota({ userId: "u4", isAnonymous: true, ip: "9.9.9.9", day: DAY, db: testDb });
    expect(await countFor(testDb, "user:u4")).toBe(0);
    expect(await countFor(testDb, "ip:9.9.9.9")).toBe(0);
  });
});

describe("refundChatQuota — DB path", () => {
  beforeEach(async () => {
    testDb = await createTestDb();
  });

  it("decrements the identity and IP buckets a chat turn consumed, floored at 0", async () => {
    await consumeChatQuota({ userId: "u5", isAnonymous: true, ip: "9.9.9.10", now: NOW, db: testDb });
    await refundChatQuota({ userId: "u5", isAnonymous: true, ip: "9.9.9.10", day: DAY, db: testDb });
    expect(await countFor(testDb, "chat:user:u5")).toBe(0);
    expect(await countFor(testDb, "chat:ip:9.9.9.10")).toBe(0);

    await refundChatQuota({ userId: "u5", isAnonymous: true, ip: "9.9.9.10", day: DAY, db: testDb });
    expect(await countFor(testDb, "chat:user:u5")).toBe(0);
    expect(await countFor(testDb, "chat:ip:9.9.9.10")).toBe(0);
  });

  it("only touches the identity bucket for a signed-in user", async () => {
    await consumeChatQuota({ userId: "u6", isAnonymous: false, ip: "9.9.9.11", now: NOW, db: testDb });
    await refundChatQuota({ userId: "u6", isAnonymous: false, ip: "9.9.9.11", day: DAY, db: testDb });
    expect(await countFor(testDb, "chat:user:u6")).toBe(0);
    expect(await countFor(testDb, "chat:ip:9.9.9.11")).toBeNull();
  });

  it("targets the passed day, not now", async () => {
    const otherDay = "2026-07-17";
    const otherNow = new Date("2026-07-17T12:00:00Z");
    const base = { userId: "u7", isAnonymous: true, ip: "9.9.9.12", db: testDb };
    await consumeChatQuota({ ...base, now: NOW });
    await consumeChatQuota({ ...base, now: otherNow });
    await refundChatQuota({ ...base, day: otherDay });
    expect(await countFor(testDb, "chat:user:u7", otherDay)).toBe(0);
    expect(await countFor(testDb, "chat:ip:9.9.9.12", otherDay)).toBe(0);
    expect(await countFor(testDb, "chat:user:u7", DAY)).toBe(1);
    expect(await countFor(testDb, "chat:ip:9.9.9.12", DAY)).toBe(1);
  });
});
