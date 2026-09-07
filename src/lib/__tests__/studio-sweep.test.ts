/**
 * sweepStudioForUser's never-reject contract (#204). It runs inside
 * `after()` on both the /studio page and the poll action, so a DB hiccup in
 * either sweep must be caught + logged, never allowed to become an unhandled
 * rejection on the shared Fluid instance.
 *
 * The two cases below discriminate which sweep failed — a db-stub whose
 * `select()` throws unconditionally would make BOTH sweeps throw (they both
 * call `db.select()` first), which can't tell a two-independent-catches
 * implementation apart from a single `try { stale; idle } catch`. Instead,
 * `sweepStaleJobs`/`sweepIdleConversations` are individually spied via
 * `vi.mock(..., importOriginal)` so exactly one rejects per test, against a
 * real in-memory db, and each test asserts the OTHER sweep's real effect
 * still landed despite the rejection.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb } from "@/lib/__tests__/test-db";
import { makeUser } from "@/lib/__tests__/factories";
import * as schema from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { insertGenerationJob } from "@/lib/generation-job";
import { dayKeyUTC } from "@/lib/generation-quota";

vi.mock("@/lib/generation-job", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/generation-job")>();
  return { ...actual, sweepStaleJobs: vi.fn(actual.sweepStaleJobs) };
});
vi.mock("@/lib/archive-conversations", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/archive-conversations")>();
  return { ...actual, sweepIdleConversations: vi.fn(actual.sweepIdleConversations) };
});

import { sweepStaleJobs } from "@/lib/generation-job";
import { sweepIdleConversations } from "@/lib/archive-conversations";
import { sweepStudioForUser } from "@/lib/studio";

type Db = Awaited<ReturnType<typeof createTestDb>>;
let db: Db;

const NOW = new Date(Math.floor(Date.now() / 1000) * 1000);
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60 * 1000);
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000);

beforeEach(async () => {
  db = await createTestDb();
  await makeUser(db, "owner");
  // mockReset, not mockClear: also drains any mockRejectedValueOnce queued
  // by a prior test. It does NOT touch the `actual` implementation each
  // mock was constructed with (vi.fn(actual) keeps that as tinyspy's
  // "original", separate from mockReset's own implementation slot), so the
  // real sweep still runs by default in every test that doesn't override it.
  vi.mocked(sweepStaleJobs).mockReset();
  vi.mocked(sweepIdleConversations).mockReset();
});

describe("sweepStudioForUser", () => {
  it("resolves and logs once when the idle sweep rejects — the stale sweep's effect still lands", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const [design] = await db
      .insert(schema.design)
      .values({ userId: "owner", updatedAt: NOW })
      .returning();
    const job = await insertGenerationJob({
      designId: design.id,
      userId: "owner",
      operation: "generate",
      imageId: crypto.randomUUID(),
      r2Key: `images/${crypto.randomUUID()}.png`,
      anchorImageId: null,
      generationNumber: 1,
      dayKey: dayKeyUTC(NOW),
      ip: null,
      cost: 0.03,
      now: minutesAgo(10), // past STALE_JOB_MS (5 min)
      db,
    });
    if (!job.ok) throw new Error("expected insert to succeed");

    vi.mocked(sweepIdleConversations).mockRejectedValueOnce(
      new Error("idle sweep down")
    );

    await expect(sweepStudioForUser("owner", db)).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("sweepIdleConversations"),
      "idle sweep down"
    );

    // The stale-job sweep ran to completion despite the idle sweep's
    // rejection — its own try/catch, not a shared one that would have
    // stopped after sweepStaleJobs.
    const [row] = await db
      .select()
      .from(schema.imageGeneration)
      .where(eq(schema.imageGeneration.id, job.job.id));
    expect(row.status).toBe("failed");

    consoleSpy.mockRestore();
  });

  it("resolves and logs once when the stale sweep rejects — the idle sweep's effect still lands", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const [idle] = await db
      .insert(schema.design)
      .values({ userId: "owner", updatedAt: daysAgo(4) }) // past ARCHIVE_AFTER_MS (3 days)
      .returning();

    vi.mocked(sweepStaleJobs).mockRejectedValueOnce(
      new Error("stale sweep down")
    );

    await expect(sweepStudioForUser("owner", db)).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("sweepStaleJobs"),
      "stale sweep down"
    );

    // The idle-conversation sweep still ran and archived the idle design,
    // despite the stale-job sweep's rejection.
    const [row] = await db
      .select()
      .from(schema.design)
      .where(eq(schema.design.id, idle.id));
    expect(row.closedAt).not.toBeNull();

    consoleSpy.mockRestore();
  });
});
