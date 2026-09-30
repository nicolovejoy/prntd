/**
 * DB-path coverage for the generation quota (#40 item c, #263). Day bucketing
 * is unit-tested in generation-quota.test.ts; this exercises the real upsert
 * increment, the identity-then-IP bumping order, the guest vs signed-in caps on
 * both buckets, enforcement with the guest-funnel flag unset, and the refund
 * helper, all against a real in-memory libSQL (the #28 pattern).
 *
 * consumeGenerationQuota / refundGenerationQuota accept an explicit `db`, so no
 * module mocking is needed here.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb } from "./test-db";
import * as schema from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import {
  consumeGenerationQuota,
  refundGenerationQuota,
  GUEST_GEN_DAILY_CAP,
  IP_GEN_DAILY_CAP,
  USER_IP_GEN_DAILY_CAP,
} from "@/lib/generation-quota";

type Db = Awaited<ReturnType<typeof createTestDb>>;
let testDb: Db;

const NOW = new Date("2026-07-18T12:00:00Z");
const DAY = "2026-07-18";

async function countFor(db: Db, bucket: string): Promise<number | null> {
  const [row] = await db
    .select({ c: schema.generationUsage.count })
    .from(schema.generationUsage)
    .where(
      and(
        eq(schema.generationUsage.bucket, bucket),
        eq(schema.generationUsage.day, DAY)
      )
    );
  return row?.c ?? null;
}

async function seedIp(ip: string, count: number) {
  await testDb.insert(schema.generationUsage).values({ bucket: `ip:${ip}`, day: DAY, count });
}

describe("consumeGenerationQuota — DB path", () => {
  beforeEach(async () => {
    testDb = await createTestDb();
    process.env.GUEST_FUNNEL_ENABLED = "true";
  });
  afterEach(() => {
    delete process.env.GUEST_FUNNEL_ENABLED;
  });

  it("is enforced with the funnel flag unset", async () => {
    delete process.env.GUEST_FUNNEL_ENABLED;
    let last;
    for (let i = 0; i < GUEST_GEN_DAILY_CAP + 1; i++) {
      last = await consumeGenerationQuota({
        userId: "u1",
        isAnonymous: true,
        ip: "1.2.3.4",
        now: NOW,
        db: testDb,
      });
    }
    expect(last).toEqual({ allowed: false, reason: "identity" });
    expect(await countFor(testDb, "user:u1")).toBe(GUEST_GEN_DAILY_CAP + 1);
  });

  it("upsert-increments the identity and IP buckets on each call", async () => {
    await consumeGenerationQuota({
      userId: "u1",
      isAnonymous: false,
      ip: "1.2.3.4",
      now: NOW,
      db: testDb,
    });
    await consumeGenerationQuota({
      userId: "u1",
      isAnonymous: false,
      ip: "1.2.3.4",
      now: NOW,
      db: testDb,
    });
    expect(await countFor(testDb, "user:u1")).toBe(2);
    expect(await countFor(testDb, "ip:1.2.3.4")).toBe(2);
  });

  it("only bumps identity when no IP is available", async () => {
    await consumeGenerationQuota({
      userId: "u1",
      isAnonymous: false,
      ip: null,
      now: NOW,
      db: testDb,
    });
    expect(await countFor(testDb, "user:u1")).toBe(1);
  });

  it("blocks a guest past the anon cap but a signed-in user sails through it", async () => {
    // Push a guest one over the cap; the call that crosses is blocked.
    let last;
    for (let i = 0; i < GUEST_GEN_DAILY_CAP + 1; i++) {
      last = await consumeGenerationQuota({
        userId: "guest",
        isAnonymous: true,
        ip: null,
        now: NOW,
        db: testDb,
      });
    }
    expect(last).toEqual({ allowed: false, reason: "identity" });

    // A signed-in user at the same count is still under the larger cap.
    let signedIn;
    for (let i = 0; i < GUEST_GEN_DAILY_CAP + 1; i++) {
      signedIn = await consumeGenerationQuota({
        userId: "real",
        isAnonymous: false,
        ip: null,
        now: NOW,
        db: testDb,
      });
    }
    expect(signedIn).toEqual({ allowed: true });
  });

  it("lets a signed-in user through an IP bucket already past IP_GEN_DAILY_CAP", async () => {
    await seedIp("5.5.5.1", IP_GEN_DAILY_CAP + 5);
    const res = await consumeGenerationQuota({
      userId: "real-1",
      isAnonymous: false,
      ip: "5.5.5.1",
      now: NOW,
      db: testDb,
    });
    expect(res).toEqual({ allowed: true });
    expect(await countFor(testDb, "ip:5.5.5.1")).toBe(IP_GEN_DAILY_CAP + 6);
  });

  it("refuses a signed-in user with reason ip once the bucket passes USER_IP_GEN_DAILY_CAP", async () => {
    await seedIp("5.5.5.2", USER_IP_GEN_DAILY_CAP);
    const res = await consumeGenerationQuota({
      userId: "real-2",
      isAnonymous: false,
      ip: "5.5.5.2",
      now: NOW,
      db: testDb,
    });
    expect(res).toEqual({ allowed: false, reason: "ip" });
    // The identity bucket was bumped before the IP check refused.
    expect(await countFor(testDb, "user:real-2")).toBe(1);
  });

  it("still refuses a guest on that address at IP_GEN_DAILY_CAP + 1", async () => {
    await seedIp("5.5.5.3", IP_GEN_DAILY_CAP);
    const res = await consumeGenerationQuota({
      userId: "guest-1",
      isAnonymous: true,
      ip: "5.5.5.3",
      now: NOW,
      db: testDb,
    });
    expect(res).toEqual({ allowed: false, reason: "ip" });
  });

  it("does not bump the ip: bucket when the identity bucket refuses", async () => {
    await seedIp("5.5.5.4", 3);
    for (let i = 0; i < GUEST_GEN_DAILY_CAP; i++) {
      await consumeGenerationQuota({
        userId: "guest-cap",
        isAnonymous: true,
        ip: "5.5.5.4",
        now: NOW,
        db: testDb,
      });
    }
    const before = await countFor(testDb, "ip:5.5.5.4");
    expect(before).toBe(3 + GUEST_GEN_DAILY_CAP);
    const res = await consumeGenerationQuota({
      userId: "guest-cap",
      isAnonymous: true,
      ip: "5.5.5.4",
      now: NOW,
      db: testDb,
    });
    expect(res).toEqual({ allowed: false, reason: "identity" });
    expect(await countFor(testDb, "ip:5.5.5.4")).toBe(before);
  });

  it("admits exactly one of two concurrent signed-in calls at the signed-in IP cap - 1", async () => {
    await seedIp("5.5.5.5", USER_IP_GEN_DAILY_CAP - 1);
    const [a, b] = await Promise.all([
      consumeGenerationQuota({ userId: "race-a", isAnonymous: false, ip: "5.5.5.5", now: NOW, db: testDb }),
      consumeGenerationQuota({ userId: "race-b", isAnonymous: false, ip: "5.5.5.5", now: NOW, db: testDb }),
    ]);
    expect([a, b].filter((r) => r.allowed)).toHaveLength(1);
  });
});

describe("refundGenerationQuota — DB path (#40 WP2)", () => {
  beforeEach(async () => {
    testDb = await createTestDb();
    process.env.GUEST_FUNNEL_ENABLED = "true";
  });
  afterEach(() => {
    delete process.env.GUEST_FUNNEL_ENABLED;
  });

  it("decrements the identity and IP buckets a failed generation consumed", async () => {
    for (let i = 0; i < 3; i++) {
      await consumeGenerationQuota({
        userId: "u1",
        isAnonymous: true,
        ip: "1.2.3.4",
        now: NOW,
        db: testDb,
      });
    }
    await refundGenerationQuota({ userId: "u1", ip: "1.2.3.4", now: NOW, db: testDb });
    expect(await countFor(testDb, "user:u1")).toBe(2);
    expect(await countFor(testDb, "ip:1.2.3.4")).toBe(2);
  });

  it("restores both buckets after an admitted generation", async () => {
    const res = await consumeGenerationQuota({
      userId: "u9",
      isAnonymous: false,
      ip: "1.2.3.9",
      now: NOW,
      db: testDb,
    });
    expect(res).toEqual({ allowed: true });
    await refundGenerationQuota({ userId: "u9", ip: "1.2.3.9", now: NOW, db: testDb });
    expect(await countFor(testDb, "user:u9")).toBe(0);
    expect(await countFor(testDb, "ip:1.2.3.9")).toBe(0);
  });

  it("floors at 0 and never goes negative", async () => {
    await consumeGenerationQuota({
      userId: "u1",
      isAnonymous: true,
      ip: null,
      now: NOW,
      db: testDb,
    });
    await refundGenerationQuota({ userId: "u1", ip: null, now: NOW, db: testDb });
    await refundGenerationQuota({ userId: "u1", ip: null, now: NOW, db: testDb });
    expect(await countFor(testDb, "user:u1")).toBe(0);
  });

  it("refunds with the funnel flag unset", async () => {
    delete process.env.GUEST_FUNNEL_ENABLED;
    await consumeGenerationQuota({ userId: "u1", isAnonymous: true, ip: "1.2.3.4", now: NOW, db: testDb });
    await refundGenerationQuota({ userId: "u1", ip: "1.2.3.4", now: NOW, db: testDb });
    expect(await countFor(testDb, "user:u1")).toBe(0);
    expect(await countFor(testDb, "ip:1.2.3.4")).toBe(0);
  });
});
