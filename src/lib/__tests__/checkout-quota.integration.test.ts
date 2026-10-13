/**
 * DB-path coverage for the checkout attempt cap (#316), against a real
 * in-memory libSQL. Mirrors chat-quota.integration.test.ts.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "./test-db";
import * as schema from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import {
  consumeCheckoutQuota,
  USER_CHECKOUT_DAILY_CAP,
  USER_IP_CHECKOUT_DAILY_CAP,
} from "@/lib/generation-quota";
import {
  checkoutLimitMessage,
  CHECKOUT_LIMIT_REACHED,
  CHECKOUT_LIMIT_REACHED_IP,
} from "@/lib/action-copy";

type Db = Awaited<ReturnType<typeof createTestDb>>;
let testDb: Db;

const NOW = new Date("2026-07-18T12:00:00Z");
const DAY = "2026-07-18";

async function countFor(db: Db, bucket: string, day: string = DAY): Promise<number | null> {
  const [row] = await db
    .select({ c: schema.generationUsage.count })
    .from(schema.generationUsage)
    .where(and(eq(schema.generationUsage.bucket, bucket), eq(schema.generationUsage.day, day)));
  return row?.c ?? null;
}

describe("consumeCheckoutQuota — DB path", () => {
  beforeEach(async () => {
    testDb = await createTestDb();
  });

  it("allows the 30th call and refuses the 31st on the identity bucket", async () => {
    expect(USER_CHECKOUT_DAILY_CAP).toBe(30);
    for (let i = 0; i < USER_CHECKOUT_DAILY_CAP; i++) {
      const r = await consumeCheckoutQuota({ userId: "u1", ip: null, now: NOW, db: testDb });
      expect(r.allowed).toBe(true);
    }
    const r = await consumeCheckoutQuota({ userId: "u1", ip: null, now: NOW, db: testDb });
    expect(r).toEqual({ allowed: false, reason: "identity" });
  });

  it("does not bump the IP bucket on an identity refusal", async () => {
    for (let i = 0; i < USER_CHECKOUT_DAILY_CAP; i++) {
      await consumeCheckoutQuota({ userId: "u1", ip: "1.2.3.4", now: NOW, db: testDb });
    }
    expect(await countFor(testDb, "checkout:ip:1.2.3.4")).toBe(USER_CHECKOUT_DAILY_CAP);
    await consumeCheckoutQuota({ userId: "u1", ip: "1.2.3.4", now: NOW, db: testDb });
    expect(await countFor(testDb, "checkout:ip:1.2.3.4")).toBe(USER_CHECKOUT_DAILY_CAP);
  });

  it("bumps the IP bucket once per allowed attempt and refuses with reason ip past 100", async () => {
    expect(USER_IP_CHECKOUT_DAILY_CAP).toBe(100);
    // Four users, 25 each, fill the IP to 100 while staying under 30 apiece.
    for (const u of ["a", "b", "c", "d"]) {
      for (let i = 0; i < 25; i++) {
        const r = await consumeCheckoutQuota({ userId: u, ip: "9.9.9.9", now: NOW, db: testDb });
        expect(r.allowed).toBe(true);
      }
    }
    expect(await countFor(testDb, "checkout:ip:9.9.9.9")).toBe(100);
    const r = await consumeCheckoutQuota({ userId: "e", ip: "9.9.9.9", now: NOW, db: testDb });
    expect(r).toEqual({ allowed: false, reason: "ip" });
    expect(await countFor(testDb, "checkout:user:e")).toBe(1);
  });

  it("skips the IP bucket when ip is null", async () => {
    await consumeCheckoutQuota({ userId: "u1", ip: null, now: NOW, db: testDb });
    expect(await countFor(testDb, "checkout:user:u1")).toBe(1);
    const rows = await testDb.select().from(schema.generationUsage);
    expect(rows.filter((r) => r.bucket.startsWith("checkout:ip:"))).toHaveLength(0);
  });

  it("keeps separate identity buckets per user", async () => {
    for (let i = 0; i < USER_CHECKOUT_DAILY_CAP; i++) {
      await consumeCheckoutQuota({ userId: "u1", ip: null, now: NOW, db: testDb });
    }
    const r = await consumeCheckoutQuota({ userId: "u2", ip: null, now: NOW, db: testDb });
    expect(r.allowed).toBe(true);
  });

  it("separates days", async () => {
    for (let i = 0; i < USER_CHECKOUT_DAILY_CAP; i++) {
      await consumeCheckoutQuota({ userId: "u1", ip: null, now: NOW, db: testDb });
    }
    const next = new Date("2026-07-19T00:00:01Z");
    const r = await consumeCheckoutQuota({ userId: "u1", ip: null, now: next, db: testDb });
    expect(r.allowed).toBe(true);
    expect(await countFor(testDb, "checkout:user:u1", "2026-07-19")).toBe(1);
  });
});

describe("checkoutLimitMessage", () => {
  it("maps ip to the network line and everything else to the account line", () => {
    expect(checkoutLimitMessage("ip")).toBe(CHECKOUT_LIMIT_REACHED_IP);
    expect(checkoutLimitMessage("identity")).toBe(CHECKOUT_LIMIT_REACHED);
    expect(checkoutLimitMessage(undefined)).toBe(CHECKOUT_LIMIT_REACHED);
  });
});
