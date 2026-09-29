import { sql, and, eq } from "drizzle-orm";
import type { db as appDb } from "./db";
import { generationUsage } from "./db/schema";

// db is imported for its TYPE only (above) so the pure helpers in this module
// (dayKeyUTC) stay importable in tests without constructing the libSQL client.
// The runtime db is pulled in lazily inside the consume/refund functions.
type AppDb = typeof appDb;

// Two independent cap families share this module and the generation_usage
// table, distinguished only by bucket prefix: generation functions read and
// write `user:<id>` / `ip:<addr>` buckets, chat functions read and write
// `chat:user:<id>` / `chat:ip:<addr>` buckets. Neither family touches the
// other's buckets.

/**
 * Parse a daily-cap env value. Unset, empty or whitespace-only, non-finite and
 * negative values fall back to the default: `Number("abc")` is NaN, and
 * `count > NaN` is always false, which would silently turn the cap off. A
 * finite value >= 0 is used as given; 0 is a deliberate kill switch that
 * refuses every call.
 */
export function parseDailyCap(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// Daily caps, env-tunable. Guests get a small allowance to try the loop; signed-
// in users a larger one. Every generation also counts against its IP: guests
// against IP_GEN_DAILY_CAP, signed-in users against the looser
// USER_IP_GEN_DAILY_CAP (a shared office or campus address needs headroom, but
// a script rotating signed-in accounts on one IP still hits a ceiling). All
// apply per UTC day.
export const GUEST_GEN_DAILY_CAP = parseDailyCap(process.env.GUEST_GEN_DAILY_CAP, 8);
export const USER_GEN_DAILY_CAP = parseDailyCap(process.env.USER_GEN_DAILY_CAP, 50);
export const IP_GEN_DAILY_CAP = parseDailyCap(process.env.IP_GEN_DAILY_CAP, 20);
export const USER_IP_GEN_DAILY_CAP = parseDailyCap(process.env.USER_IP_GEN_DAILY_CAP, 100);

// Chat daily caps, same shape as the generation caps above. Chat turns (Claude
// calls) are counted separately from generation, in their own buckets. Every
// turn also counts against its IP: guests against IP_CHAT_DAILY_CAP, signed-in
// users against the looser USER_IP_CHAT_DAILY_CAP (a shared office or campus
// address needs headroom, but a script rotating signed-in accounts on one IP
// still hits a ceiling).
export const GUEST_CHAT_DAILY_CAP = parseDailyCap(process.env.GUEST_CHAT_DAILY_CAP, 24);
export const USER_CHAT_DAILY_CAP = parseDailyCap(process.env.USER_CHAT_DAILY_CAP, 150);
export const IP_CHAT_DAILY_CAP = parseDailyCap(process.env.IP_CHAT_DAILY_CAP, 60);
export const USER_IP_CHAT_DAILY_CAP = parseDailyCap(process.env.USER_IP_CHAT_DAILY_CAP, 300);

/** Longest chat message accepted, in characters; longer is refused before any quota spend. */
export const CHAT_MESSAGE_MAX_CHARS = 4000;

/** Most recent stored chat messages sent to the model as history. */
export const CHAT_HISTORY_MAX_MESSAGES = 40;

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
 * Shared by the generation and chat families. Bumps the identity bucket first
 * and refuses on `identity` without touching the IP bucket, so one caller
 * spamming refused attempts doesn't spend other callers' IP allowance. Every
 * attempt that passes the identity check bumps the IP bucket when an IP is
 * present; one refused on the IP bucket has already bumped its identity bucket.
 * A count equal to the cap is allowed; the first past it is refused. Each bump
 * is a single-statement upsert, so concurrent calls at cap - 1 admit exactly one.
 */
async function consumeBuckets(opts: {
  identityBucket: string;
  ipBucket: string | null;
  identityCap: number;
  ipCap: number;
  day: string;
  db: AppDb;
}): Promise<QuotaResult> {
  const identityCount = await bump(opts.identityBucket, opts.day, opts.db);
  if (identityCount > opts.identityCap) {
    return { allowed: false, reason: "identity" };
  }

  // No IP available (rare on Vercel) → skip the IP dimension rather than block.
  if (!opts.ipBucket) return { allowed: true };

  const ipCount = await bump(opts.ipBucket, opts.day, opts.db);
  if (ipCount > opts.ipCap) {
    return { allowed: false, reason: "ip" };
  }
  return { allowed: true };
}

/**
 * Count this generation against the daily caps and decide whether it's
 * allowed. Enforced whether or not the guest funnel is on. The identity bucket
 * is checked first; when it's already over cap the IP bucket is not bumped.
 * Every generation that passes the identity check bumps `ip:` when an IP is
 * present: guests are checked against IP_GEN_DAILY_CAP, signed-in users against
 * USER_IP_GEN_DAILY_CAP. A generation refused on the IP bucket has already
 * bumped its identity bucket, so that refusal also spends identity allowance
 * (blocked calls cost no API money).
 */
export async function consumeGenerationQuota(opts: {
  userId: string;
  isAnonymous: boolean;
  ip: string | null;
  now?: Date;
  db?: AppDb;
}): Promise<QuotaResult> {
  const db = opts.db ?? (await import("./db")).db;
  return consumeBuckets({
    identityBucket: `user:${opts.userId}`,
    ipBucket: opts.ip ? `ip:${opts.ip}` : null,
    identityCap: opts.isAnonymous ? GUEST_GEN_DAILY_CAP : USER_GEN_DAILY_CAP,
    ipCap: opts.isAnonymous ? IP_GEN_DAILY_CAP : USER_IP_GEN_DAILY_CAP,
    day: dayKeyUTC(opts.now ?? new Date()),
    db,
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
 * Pass `ip: null` when the IP bucket was not bumped (an identity refusal), or
 * the refund would decrement another caller's count.
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
  const db = opts.db ?? (await import("./db")).db;
  const day = opts.day ?? dayKeyUTC(opts.now ?? new Date());
  await unbump(`user:${opts.userId}`, day, db);
  if (opts.ip) await unbump(`ip:${opts.ip}`, day, db);
}

/**
 * Count this chat turn against the daily caps and decide whether it's
 * allowed. Enforced whether or not the guest funnel is on (the Anthropic cost
 * exists for any session). The identity bucket is checked first; when it's
 * already over cap the IP bucket is not bumped, so one guest spamming refused
 * turns doesn't spend other guests' IP allowance. Every turn that passes the
 * identity check bumps `chat:ip:` when an IP is present: guests are checked
 * against IP_CHAT_DAILY_CAP, signed-in users against USER_IP_CHAT_DAILY_CAP. A
 * turn refused on the IP bucket has already bumped its identity bucket, so
 * that refused turn also spends identity allowance (same as generation;
 * blocked calls cost no API money).
 */
export async function consumeChatQuota(opts: {
  userId: string;
  isAnonymous: boolean;
  ip: string | null;
  now?: Date;
  db?: AppDb;
}): Promise<QuotaResult> {
  const db = opts.db ?? (await import("./db")).db;
  return consumeBuckets({
    identityBucket: chatUserBucket(opts.userId),
    ipBucket: opts.ip ? chatIpBucket(opts.ip) : null,
    identityCap: opts.isAnonymous ? GUEST_CHAT_DAILY_CAP : USER_CHAT_DAILY_CAP,
    ipCap: opts.isAnonymous ? IP_CHAT_DAILY_CAP : USER_IP_CHAT_DAILY_CAP,
    day: dayKeyUTC(opts.now ?? new Date()),
    db,
  });
}

/**
 * Give back the quota unit a chat turn consumed when the turn then failed
 * before Claude answered. Mirrors consumeChatQuota's identity + IP buckets
 * (the IP bucket for any caller, when an IP is present) and floors at 0.
 * Best-effort: caller should not let a refund failure mask the original
 * error. `day` is required: pass the YYYY-MM-DD UTC day the unit was spent on
 * (from dayKeyUTC), since a refund after midnight would otherwise credit the
 * wrong bucket.
 */
export async function refundChatQuota(opts: {
  userId: string;
  ip: string | null;
  day: string;
  db?: AppDb;
}): Promise<void> {
  const db = opts.db ?? (await import("./db")).db;
  const day = opts.day;
  await unbump(chatUserBucket(opts.userId), day, db);
  if (opts.ip) await unbump(chatIpBucket(opts.ip), day, db);
}
