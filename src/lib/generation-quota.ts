import { sql, and, eq } from "drizzle-orm";
import type { db as appDb } from "./db";
import { generationUsage } from "./db/schema";
import { guestFunnelEnabled } from "./flags";

// db is imported for its TYPE only (above) so the pure helpers in this module
// (quotaDecision, dayKeyUTC) stay importable in tests without constructing the
// libSQL client. The runtime db is pulled in lazily inside consumeGenerationQuota.
type AppDb = typeof appDb;

// Two independent cap families share this module and the generation_usage
// table, distinguished only by bucket prefix: generation functions read and
// write `user:<id>` / `ip:<addr>` buckets, chat functions read and write
// `chat:user:<id>` / `chat:ip:<addr>` buckets. Neither family touches the
// other's buckets.

// Daily caps, env-tunable. Guests get a small allowance to try the loop; signed-
// in users a larger one; the per-IP cap backstops a single network spinning up
// many guest sessions. All apply per UTC day.
export const GUEST_GEN_DAILY_CAP = Number(process.env.GUEST_GEN_DAILY_CAP ?? 8);
export const USER_GEN_DAILY_CAP = Number(process.env.USER_GEN_DAILY_CAP ?? 50);
export const IP_GEN_DAILY_CAP = Number(process.env.IP_GEN_DAILY_CAP ?? 20);

// Chat daily caps, same shape as the generation caps above. Chat turns (Claude
// calls) are counted separately from generation, in their own buckets.
export const GUEST_CHAT_DAILY_CAP = Number(process.env.GUEST_CHAT_DAILY_CAP ?? 24);
export const USER_CHAT_DAILY_CAP = Number(process.env.USER_CHAT_DAILY_CAP ?? 150);
export const IP_CHAT_DAILY_CAP = Number(process.env.IP_CHAT_DAILY_CAP ?? 60);

function chatUserBucket(userId: string): string {
  return `chat:user:${userId}`;
}

function chatIpBucket(ip: string): string {
  return `chat:ip:${ip}`;
}

export type QuotaResult = { allowed: boolean; reason?: "identity" | "ip" };

/** UTC day key (YYYY-MM-DD) — the bucketing window for a counter row. */
export function dayKeyUTC(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Pure cap decision given the post-increment counts. Identity (the user/anon
 * bucket) is checked first, then the shared-IP backstop. A count equal to the
 * cap is still allowed; the first call that pushes it past the cap is blocked.
 */
export function quotaDecision(opts: {
  identityCount: number;
  ipCount: number;
  identityCap: number;
  ipCap: number;
}): QuotaResult {
  if (opts.identityCount > opts.identityCap) return { allowed: false, reason: "identity" };
  if (opts.ipCount > opts.ipCap) return { allowed: false, reason: "ip" };
  return { allowed: true };
}

/** Atomic increment of one (bucket, day) counter; returns the new count. */
async function bump(
  bucket: string,
  day: string,
  db: AppDb
): Promise<number> {
  const [row] = await db
    .insert(generationUsage)
    .values({ bucket, day, count: 1 })
    .onConflictDoUpdate({
      target: [generationUsage.bucket, generationUsage.day],
      set: { count: sql`${generationUsage.count} + 1` },
    })
    .returning({ count: generationUsage.count });
  return row.count;
}

/**
 * Count this generation against the daily caps and decide whether it's allowed.
 * No-op (always allowed) when the guest funnel is off — caps exist to protect
 * the ungated funnel, so behavior is unchanged when the flag is off. Increments
 * happen even on a blocked attempt (harmless; blocked calls cost no API money).
 */
export async function consumeGenerationQuota(opts: {
  userId: string;
  isAnonymous: boolean;
  ip: string | null;
  now?: Date;
  db?: AppDb;
}): Promise<QuotaResult> {
  if (!guestFunnelEnabled()) return { allowed: true };
  const db = opts.db ?? (await import("./db")).db;
  const day = dayKeyUTC(opts.now ?? new Date());
  const identityCap = opts.isAnonymous ? GUEST_GEN_DAILY_CAP : USER_GEN_DAILY_CAP;

  const identityCount = await bump(`user:${opts.userId}`, day, db);
  // No IP available (rare on Vercel) → skip the IP dimension rather than block.
  const ipCount = opts.ip ? await bump(`ip:${opts.ip}`, day, db) : 0;

  return quotaDecision({
    identityCount,
    ipCount,
    identityCap,
    ipCap: IP_GEN_DAILY_CAP,
  });
}

/** Decrement one (bucket, day) counter by 1, floored at 0. */
async function unbump(bucket: string, day: string, db: AppDb): Promise<void> {
  await db
    .update(generationUsage)
    .set({ count: sql`max(${generationUsage.count} - 1, 0)` })
    .where(and(eq(generationUsage.bucket, bucket), eq(generationUsage.day, day)));
}

/**
 * Give back the quota unit a generation consumed when that generation then
 * failed, so a user isn't charged a design for an image they never got.
 * Mirrors consumeGenerationQuota's identity + IP buckets and floors at 0. The
 * bucket day defaults to `now`, but callers that hold the day the unit was
 * actually spent (see generation-job.ts) should pass `day` explicitly.
 * No-op when the funnel flag is off (caps aren't enforced there anyway).
 * Caller should treat this as best-effort — refund failure must not mask the
 * original generation error.
 */
export async function refundGenerationQuota(opts: {
  userId: string;
  ip: string | null;
  /**
   * The bucket to credit, as a YYYY-MM-DD UTC day key. Pass it whenever the
   * refund is decoupled in time from the spend (a durable job failing after
   * midnight, or a sweeper clearing yesterday's stuck row) — recomputing the
   * day from the clock would credit the wrong bucket. Falls back to `now`.
   */
  day?: string;
  now?: Date;
  db?: AppDb;
}): Promise<void> {
  if (!guestFunnelEnabled()) return;
  const db = opts.db ?? (await import("./db")).db;
  const day = opts.day ?? dayKeyUTC(opts.now ?? new Date());
  await unbump(`user:${opts.userId}`, day, db);
  if (opts.ip) await unbump(`ip:${opts.ip}`, day, db);
}

/**
 * Count this chat turn against the daily caps and decide whether it's
 * allowed. Unlike generation, this is enforced regardless of the guest funnel
 * flag — the Anthropic cost exists for any session. The identity bucket is
 * checked first; when it's already over cap the IP bucket is not bumped, so
 * one guest spamming refused turns doesn't spend other guests' IP allowance.
 * The IP dimension only applies to guest turns: a signed-in user's turns bump
 * and check only their identity bucket, never `chat:ip:`. A guest refused on
 * the IP bucket has already bumped their identity bucket, so that refused turn
 * also spends identity allowance (same as generation; blocked calls cost no
 * API money).
 */
export async function consumeChatQuota(opts: {
  userId: string;
  isAnonymous: boolean;
  ip: string | null;
  now?: Date;
  db?: AppDb;
}): Promise<QuotaResult> {
  const db = opts.db ?? (await import("./db")).db;
  const day = dayKeyUTC(opts.now ?? new Date());
  const identityCap = opts.isAnonymous ? GUEST_CHAT_DAILY_CAP : USER_CHAT_DAILY_CAP;

  const identityCount = await bump(chatUserBucket(opts.userId), day, db);
  if (identityCount > identityCap) {
    return { allowed: false, reason: "identity" };
  }

  if (!opts.isAnonymous || !opts.ip) {
    return { allowed: true };
  }

  const ipCount = await bump(chatIpBucket(opts.ip), day, db);
  if (ipCount > IP_CHAT_DAILY_CAP) {
    return { allowed: false, reason: "ip" };
  }
  return { allowed: true };
}

/**
 * Give back the quota unit a chat turn consumed when the Anthropic call then
 * failed. Mirrors consumeChatQuota's identity + (guest-only) IP buckets and
 * floors at 0. Best-effort: caller should not let a refund failure mask the
 * original error. `day` is required: pass the YYYY-MM-DD UTC day the unit was
 * spent on (from dayKeyUTC), since a refund after midnight would otherwise
 * credit the wrong bucket.
 */
export async function refundChatQuota(opts: {
  userId: string;
  isAnonymous: boolean;
  ip: string | null;
  day: string;
  db?: AppDb;
}): Promise<void> {
  const db = opts.db ?? (await import("./db")).db;
  const day = opts.day;
  await unbump(chatUserBucket(opts.userId), day, db);
  if (opts.isAnonymous && opts.ip) await unbump(chatIpBucket(opts.ip), day, db);
}
