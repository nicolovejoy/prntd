/**
 * DB-path coverage for the generation quota (#40 item c). The pure decision
 * (quotaDecision) and day bucketing are unit-tested in generation-quota.test.ts;
 * this exercises the real upsert increment, the identity+IP double-bump, the
 * anon-vs-signed-in caps, the flag short-circuit, and the WP2 refund helper —
 * all against a real in-memory libSQL (the #28 pattern).
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

describe("consumeGenerationQuota — DB path", () => {
  beforeEach(async () => {
    testDb = await createTestDb();
    process.env.GUEST_FUNNEL_ENABLED = "true";
  });
  afterEach(() => {
    delete process.env.GUEST_FUNNEL_ENABLED;
  });

  it("no-ops (always allowed, writes nothing) when the funnel flag is off", async () => {
    delete process.env.GUEST_FUNNEL_ENABLED;
    const res = await consumeGenerationQuota({
      userId: "u1",
      isAnonymous: true,
      ip: "1.2.3.4",
      now: NOW,
      db: testDb,
    });
    expect(res).toEqual({ allowed: true });
    expect(await countFor(testDb, "user:u1")).toBeNull();
    expect(await countFor(testDb, "ip:1.2.3.4")).toBeNull();
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

  it("no-ops when the funnel flag is off", async () => {
    delete process.env.GUEST_FUNNEL_ENABLED;
    // Nothing to refund and no throw — a signed-in path never wants side effects.
    await refundGenerationQuota({ userId: "u1", ip: "1.2.3.4", now: NOW, db: testDb });
    expect(await countFor(testDb, "user:u1")).toBeNull();
  });
});
