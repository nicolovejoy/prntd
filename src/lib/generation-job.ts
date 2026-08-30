/**
 * Lifecycle layer for the `image_generation` job row. Every state transition
 * lives here so the hardening contract is enforced in one testable place —
 * `actions.ts` and the cron never write the table directly.
 *
 * Two invariants this module exists to hold:
 *
 * 1. A transition and its quota refund happen together. `failGenerationJob`
 *    refunds only when its conditional UPDATE reports exactly one row, so a
 *    sweeper racing a live failure can't double-refund.
 * 2. The refund credits the day the generation was *started*, read off the
 *    row's `day_key`, not whatever day it is when the failure is noticed.
 */
import { sql, and, eq, lt, asc, count } from "drizzle-orm";
import type { db as appDb } from "./db";
import { imageGeneration } from "./db/schema";
import { refundGenerationQuota } from "./generation-quota";

// Imported for its TYPE only, so callers can inject a test db without this
// module constructing the libSQL client at import time.
type AppDb = typeof appDb;

/**
 * Most concurrent running jobs one user may hold. Enforced by the INSERT
 * itself (see insertGenerationJob) rather than a count-then-insert, which
 * races across two browser tabs.
 */
export const GENERATION_CONCURRENCY_CAP = 3;

/**
 * A running job older than this is presumed dead — the serverless instance
 * that owned it was recycled or redeployed mid-flight, so nothing will ever
 * complete it. Swept lazily on read.
 */
export const STALE_JOB_MS = 5 * 60 * 1000;

export type GenerationJob = typeof imageGeneration.$inferSelect;

/** Drizzle stores `{ mode: "timestamp" }` as epoch SECONDS. */
function toEpochSeconds(d: Date): number {
  return Math.floor(d.getTime() / 1000);
}

async function resolveDb(db?: AppDb): Promise<AppDb> {
  return db ?? (await import("./db")).db;
}

/**
 * Start a job, refusing when the user already holds
 * GENERATION_CONCURRENCY_CAP running ones.
 *
 * The cap predicate is part of the INSERT because libSQL over serverless HTTP
 * has no interactive transaction (db.transaction is unsupported — hence
 * db.batch everywhere in this codebase), so a separate count read followed by
 * an insert lets two tabs both observe 2 and both write a third and fourth.
 * `INSERT … SELECT … WHERE (subquery) < cap` evaluates the predicate inside
 * the one statement; a loser affects zero rows.
 */
export async function insertGenerationJob(params: {
  designId: string;
  userId: string;
  operation: "generate" | "edit";
  imageId: string;
  r2Key: string;
  anchorImageId: string | null;
  generationNumber: number;
  dayKey: string;
  ip: string | null;
  cost: number;
  now?: Date;
  db?: AppDb;
}): Promise<{ ok: true; job: GenerationJob } | { ok: false; reason: "at_capacity" }> {
  const db = await resolveDb(params.db);
  const now = params.now ?? new Date();
  const id = crypto.randomUUID();
  const ts = toEpochSeconds(now);

  // Values are bound parameters (drizzle's sql`` template parameterises every
  // interpolation) — never string-interpolated into the statement text.
  const result = await db.run(sql`
    insert into image_generation (
      id, design_id, user_id, status, operation, image_id, r2_key,
      anchor_image_id, generation_number, day_key, ip, cost,
      started_at, created_at
    )
    select
      ${id}, ${params.designId}, ${params.userId}, 'running', ${params.operation},
      ${params.imageId}, ${params.r2Key}, ${params.anchorImageId},
      ${params.generationNumber}, ${params.dayKey}, ${params.ip}, ${params.cost},
      ${ts}, ${ts}
    where (
      select count(*) from image_generation
      where user_id = ${params.userId} and status = 'running'
    ) < ${GENERATION_CONCURRENCY_CAP}
  `);

  if (result.rowsAffected !== 1) return { ok: false, reason: "at_capacity" };

  const [job] = await db
    .select()
    .from(imageGeneration)
    .where(eq(imageGeneration.id, id))
    .limit(1);
  return { ok: true, job };
}

/**
 * running -> failed, plus the quota refund, as one operation. The refund is
 * deliberately not a separate exported step: the caller could then forget it,
 * or a sweeper and a live failure could both perform it. The conditional
 * UPDATE decides — exactly one caller sees the row transition, and only that
 * caller refunds.
 *
 * The refund is best-effort; a refund failure must not mask the generation
 * error that got us here.
 */
export async function failGenerationJob(params: {
  jobId: string;
  error: string;
  now?: Date;
  db?: AppDb;
}): Promise<{ failed: boolean; refunded: boolean }> {
  const db = await resolveDb(params.db);
  const now = params.now ?? new Date();

  const rows = await db
    .update(imageGeneration)
    .set({ status: "failed", error: params.error, finishedAt: now })
    .where(and(eq(imageGeneration.id, params.jobId), eq(imageGeneration.status, "running")))
    .returning();

  const job = rows[0];
  if (!job) return { failed: false, refunded: false };

  try {
    // day comes off the ROW, so a failure noticed after midnight UTC (or by a
    // sweeper hours later) still credits the bucket the generation consumed.
    await refundGenerationQuota({ userId: job.userId, ip: job.ip, day: job.dayKey, db });
    return { failed: true, refunded: true };
  } catch (err) {
    console.error("[generation-job] refund failed", {
      jobId: params.jobId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { failed: true, refunded: false };
  }
}

/**
 * The running -> succeeded half, as a statement rather than an awaited call,
 * so the completion path can compose it into the same db.batch as the image
 * insert and the design counters.
 *
 * Conditional on `running`, and that is load-bearing in one direction people
 * get backwards: it stops a job a sweeper already FAILED from resurrecting as
 * succeeded. The sweeper refunded that job's quota unit; letting a late
 * completion flip it to succeeded would leave a refunded row marked as a
 * success. The statement matching zero rows is the correct outcome there, not
 * an error.
 *
 * No refund counterpart exists here — success keeps the quota unit.
 *
 * REQUIRED OF THE COMPLETION PATH (Task 3): run this whether or not the job was
 * cancelled. Cancellation deliberately leaves `status = 'running'`, so this is
 * the only thing that releases a cancelled job's concurrency slot. Skipping it
 * for cancelled jobs would pin the slot until the stale sweep at
 * STALE_JOB_MS — the accepted cost of cancelled jobs holding a slot is the
 * render's real duration, and only this call keeps it that way.
 */
export function succeedJobStatement(db: AppDb, jobId: string, now: Date) {
  return db
    .update(imageGeneration)
    .set({ status: "succeeded", finishedAt: now })
    .where(and(eq(imageGeneration.id, jobId), eq(imageGeneration.status, "running")));
}

/**
 * Owner-gated cancel. Sets `cancelled_at` and leaves `status = 'running'` —
 * the provider call is still in flight and will still land, and keeping the
 * status untouched means every transition predicate in this file stays
 * `status = 'running'`. Consumers treat a cancelled job as "may append its
 * image, may never clobber newer state" (src/lib/turn-tracker.ts).
 *
 * No refund: the render runs and is billed regardless.
 */
export async function cancelGenerationJob(params: {
  jobId: string;
  userId: string;
  db?: AppDb;
}): Promise<boolean> {
  const db = await resolveDb(params.db);
  const rows = await db
    .update(imageGeneration)
    .set({ cancelledAt: new Date() })
    .where(
      and(
        eq(imageGeneration.id, params.jobId),
        eq(imageGeneration.userId, params.userId),
        eq(imageGeneration.status, "running")
      )
    )
    .returning({ id: imageGeneration.id });
  return rows.length === 1;
}

/**
 * Every job for this design that has not reached a terminal status.
 *
 * INCLUDES CANCELLED JOBS, and that is intentional — cancel does not stop the
 * render, so a cancelled job is genuinely still running and still holding its
 * concurrency slot. Consumers MUST consult `cancelledAt` on each row rather
 * than treating the whole list as in-flight work: rendering a cancelled
 * generation as an active spinner is the bug this note exists to prevent. Use
 * the list for slot/lifecycle accounting; filter on `cancelledAt === null`
 * for anything the user is meant to read as "still working".
 */
export async function getRunningJobsForDesign(
  designId: string,
  db?: AppDb
): Promise<GenerationJob[]> {
  const database = await resolveDb(db);
  return database
    .select()
    .from(imageGeneration)
    .where(
      and(eq(imageGeneration.designId, designId), eq(imageGeneration.status, "running"))
    )
    .orderBy(asc(imageGeneration.generationNumber));
}

export async function countRunningJobsForUser(userId: string, db?: AppDb): Promise<number> {
  const database = await resolveDb(db);
  const [row] = await database
    .select({ n: count() })
    .from(imageGeneration)
    .where(and(eq(imageGeneration.userId, userId), eq(imageGeneration.status, "running")));
  return row?.n ?? 0;
}

/**
 * Fail + refund every overdue running job in scope. Called lazily on read
 * (thread load) rather than from a daily cron, so a stuck row clears the next
 * time anyone looks at it.
 *
 * The scope is a discriminated union rather than optional designId/userId
 * fields on purpose: with optionals, a caller that forgot to pass one would
 * type-check as `{}` and silently sweep every user's jobs. `{ scope: "all" }`
 * has to be said out loud, and only the cron says it.
 *
 * Cancelled jobs are deliberately NOT excluded, though sweeping one refunds a
 * unit for a generation the user chose to walk away from. Cancel means "I
 * stopped watching", not "the render failed" — the render keeps going and
 * normally succeeds well inside STALE_JOB_MS, so the sweep never sees it. A
 * cancelled job still running at the cutoff genuinely produced nothing, and a
 * unit that bought nothing is refundable whether or not the user was still
 * watching. Reading this as free quota requires the render to actually die,
 * which the user cannot cause. Do not add a `cancelled_at is null` filter.
 */
export async function sweepStaleJobs(
  params: (
    | { scope: "design"; designId: string }
    | { scope: "user"; userId: string }
    | { scope: "all" }
  ) & { now?: Date; db?: AppDb }
): Promise<{ swept: number }> {
  const db = await resolveDb(params.db);
  const now = params.now ?? new Date();
  const cutoff = new Date(now.getTime() - STALE_JOB_MS);

  const scopeFilter =
    params.scope === "design"
      ? eq(imageGeneration.designId, params.designId)
      : params.scope === "user"
        ? eq(imageGeneration.userId, params.userId)
        : undefined;

  const stale = await db
    .select({ id: imageGeneration.id })
    .from(imageGeneration)
    .where(
      and(
        eq(imageGeneration.status, "running"),
        lt(imageGeneration.startedAt, cutoff),
        ...(scopeFilter ? [scopeFilter] : [])
      )
    );

  let swept = 0;
  for (const row of stale) {
    // Conditional inside, so a job that completed between the select and here
    // is left alone — which is also what makes a second sweep report 0.
    const { failed } = await failGenerationJob({
      jobId: row.id,
      error: "Generation timed out",
      now,
      db,
    });
    if (failed) swept += 1;
  }
  return { swept };
}
