/**
 * Cron backstop for the durable generation job (slice 6 of the durable
 * generation plan). The lazy stale sweep (`sweepStaleJobs`, called on every
 * design/thread read) already reclaims the job ROW — flips an overdue
 * `running` job to `failed` and refunds its quota unit — the moment anyone
 * looks at it. What it cannot reach is a design nobody ever reopens: the R2
 * OBJECT uploaded just before the process died between "upload succeeded"
 * and "DB batch committed" then sits in the bucket forever with no row
 * pointing at it, because the job row itself is what the lazy sweep needs to
 * find.
 *
 * This module is the only caller allowed to pass `{ scope: "all" }` to
 * `sweepStaleJobs` (see that function's docblock) — every other caller sweeps
 * one design or one user, which is small by construction. Sweeping every
 * user's overdue jobs is unbounded in principle, so `limit` below caps it.
 *
 * Explicitly NOT applying #39's 24h ceiling here: that ceiling exists so a
 * permanently-unfulfillable order stops being retried forever and falls to
 * admin. There is no admin-retry equivalent for a stuck generation job — the
 * lazy sweep already fires at STALE_JOB_MS (5 min), so anything this cron
 * still finds "running" past that has already been abandoned by every
 * ordinary path. A ceiling here would just leave old orphans `running`
 * forever, which is the opposite of a backstop.
 */
import { deleteImageObject } from "@/lib/r2";
import { sweepStaleJobs } from "@/lib/generation-job";

/**
 * Max stale jobs one cron invocation will process. Chosen against the
 * route's 60s `maxDuration` (see `route.ts`): each job costs a handful of
 * serial round trips to Turso (the stale select, the conditional fail
 * UPDATE, the quota refund) plus one R2 delete — call it ~150-300ms in the
 * worst case. 100 jobs bounds a run to roughly 15-30s, leaving comfortable
 * headroom under the timeout for cold starts and slow individual calls. In
 * practice a "running" row this stale represents an abandoned process (a
 * deploy killed it mid-flight), which is rare, so hitting this cap at all
 * would itself be a signal something upstream is broken.
 */
export const SWEEP_GENERATIONS_LIMIT = 100;

export type SweepGenerationsDeps = {
  sweep: typeof sweepStaleJobs;
  reclaimImageObject: (imageId: string) => Promise<void>;
};

export type SweepGenerationsResult = {
  /** Stale running rows found this run, before per-row processing. */
  scanned: number;
  /** Jobs this run actually transitioned to `failed` (quota refunded). */
  failed: number;
  /** Of those, how many had their stranded R2 object successfully deleted. */
  reclaimed: number;
  /** R2 deletes that threw — logged, never fails the run. */
  reclaimErrors: number;
};

export async function sweepOrphanedGenerations(
  deps: SweepGenerationsDeps,
  opts: { now?: Date; limit?: number } = {}
): Promise<SweepGenerationsResult> {
  const { scanned, jobs } = await deps.sweep({
    scope: "all",
    now: opts.now,
    limit: opts.limit ?? SWEEP_GENERATIONS_LIMIT,
  });

  let reclaimed = 0;
  let reclaimErrors = 0;
  for (const job of jobs) {
    try {
      await deps.reclaimImageObject(job.imageId);
      reclaimed += 1;
    } catch (err) {
      reclaimErrors += 1;
      console.error("[sweep-generations] R2 reclaim failed", {
        jobId: job.id,
        imageId: job.imageId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const result: SweepGenerationsResult = {
    scanned,
    failed: jobs.length,
    reclaimed,
    reclaimErrors,
  };

  // Top-level heartbeat: #39's route only logs per-order, so a zero-work run
  // is silent and indistinguishable from a cron that never fired at all.
  // This line fires every run, including a clean scanned:0 one.
  console.log("[sweep-generations] heartbeat", result);

  return result;
}

/** Production deps: the real lifecycle sweep + the real R2 delete. */
export const defaultSweepGenerationsDeps: SweepGenerationsDeps = {
  sweep: sweepStaleJobs,
  reclaimImageObject: deleteImageObject,
};
