/**
 * DB-path coverage for the reference-image upload cap (#188 slice 2a), against
 * a real in-memory libSQL. Mirrors checkout-quota.integration.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "./test-db";
import * as schema from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import {
  consumeUploadQuota,
  consumeCheckoutQuota,
  USER_UPLOAD_DAILY_CAP,
  USER_IP_UPLOAD_DAILY_CAP,
} from "@/lib/generation-quota";

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

describe("consumeUploadQuota - DB path", () => {
  beforeEach(async () => {
    testDb = await createTestDb();
  });

  it("allows up to the user cap and refuses the next with reason identity", async () => {
    expect(USER_UPLOAD_DAILY_CAP).toBe(40);
    for (let i = 0; i < USER_UPLOAD_DAILY_CAP; i++) {
      const r = await consumeUploadQuota({ userId: "u1", ip: null, now: NOW, db: testDb });
      expect(r.allowed).toBe(true);
    }
    const r = await consumeUploadQuota({ userId: "u1", ip: null, now: NOW, db: testDb });
    expect(r).toEqual({ allowed: false, reason: "identity" });
  });

  it("counts per IP and refuses with reason ip when the identity bucket still has room", async () => {
    expect(USER_IP_UPLOAD_DAILY_CAP).toBe(100);
    // Three users, 34 / 33 / 33 each, fill the IP to 100 while staying under 40 apiece.
    const plan: Array<[string, number]> = [["a", 34], ["b", 33], ["c", 33]];
    for (const [u, n] of plan) {
      for (let i = 0; i < n; i++) {
        const r = await consumeUploadQuota({ userId: u, ip: "9.9.9.9", now: NOW, db: testDb });
        expect(r.allowed).toBe(true);
      }
    }
    expect(await countFor(testDb, "upload:ip:9.9.9.9")).toBe(100);
    const r = await consumeUploadQuota({ userId: "d", ip: "9.9.9.9", now: NOW, db: testDb });
    expect(r).toEqual({ allowed: false, reason: "ip" });
  });

  it("a null IP skips the IP bucket", async () => {
    await consumeUploadQuota({ userId: "u1", ip: null, now: NOW, db: testDb });
    expect(await countFor(testDb, "upload:user:u1")).toBe(1);
    const rows = await testDb.select().from(schema.generationUsage);
    expect(rows.filter((r) => r.bucket.startsWith("upload:ip:"))).toHaveLength(0);
  });

  it("a new UTC day starts at zero", async () => {
    for (let i = 0; i < USER_UPLOAD_DAILY_CAP; i++) {
      await consumeUploadQuota({ userId: "u1", ip: null, now: NOW, db: testDb });
    }
    const next = new Date("2026-07-19T00:00:01Z");
    const r = await consumeUploadQuota({ userId: "u1", ip: null, now: next, db: testDb });
    expect(r.allowed).toBe(true);
    expect(await countFor(testDb, "upload:user:u1", "2026-07-19")).toBe(1);
  });

  it("upload buckets do not touch generation, chat or checkout counts", async () => {
    await consumeUploadQuota({ userId: "u1", ip: "1.2.3.4", now: NOW, db: testDb });
    const rows = await testDb.select().from(schema.generationUsage);
    expect(rows.map((r) => r.bucket).sort()).toEqual(["upload:ip:1.2.3.4", "upload:user:u1"]);
    // And the reverse: a checkout attempt leaves the upload count alone.
    await consumeCheckoutQuota({ userId: "u1", ip: "1.2.3.4", now: NOW, db: testDb });
    expect(await countFor(testDb, "upload:user:u1")).toBe(1);
  });
});

describe("upload caps are env-overridable", () => {
  it("USER_UPLOAD_DAILY_CAP and USER_IP_UPLOAD_DAILY_CAP read the environment", async () => {
    vi.stubEnv("USER_UPLOAD_DAILY_CAP", "2");
    vi.stubEnv("USER_IP_UPLOAD_DAILY_CAP", "7");
    vi.resetModules();
    const mod = await import("@/lib/generation-quota");
    expect(mod.USER_UPLOAD_DAILY_CAP).toBe(2);
    expect(mod.USER_IP_UPLOAD_DAILY_CAP).toBe(7);
    vi.unstubAllEnvs();
    vi.resetModules();
  });
});
