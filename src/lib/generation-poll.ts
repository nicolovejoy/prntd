/**
 * Timing and capacity arithmetic for the Studio's generation poller.
 *
 * Pure and framework-free so the schedule is unit-testable without mounting a
 * component — the Studio holds no timing logic of its own, it just asks this
 * module how long to wait and whether Generate is still allowed.
 */

/**
 * Most concurrent running jobs one user may hold, mirrored from
 * `GENERATION_CONCURRENCY_CAP` in `src/lib/generation-job.ts`.
 *
 * Deliberately re-declared rather than imported: this module is pulled into
 * the client bundle, and generation-job.ts imports drizzle and the quota layer
 * at module scope. A unit test asserts the two constants agree, so the copy
 * cannot drift silently.
 */
export const GENERATION_CAP = 3;

/**
 * How long the client keeps an optimistic pending cell (#187) that server
 * lanes have never accounted for. A job the server knows about settles inside
 * `STALE_JOB_MS` (5 min) — the server's own sweep cutoff, re-declared here
 * with margin rather than imported because generation-job.ts pulls drizzle
 * into the client bundle, the same reason GENERATION_CAP is duplicated. Past
 * this the entry is the client's own ghost: it would hold a cap slot and keep
 * the poll loop alive forever, so it is dropped.
 */
export const STALE_OPTIMISTIC_MS = 6 * 60 * 1000;

/** Poll cadence while a generation is in flight. */
export interface PollSchedule {
  /** Delay used while inside `fastWindowMs` of the first poll. */
  fastMs: number;
  /** Delay used after that — the cap; the schedule never slows further. */
  slowMs: number;
  fastWindowMs: number;
}

/**
 * 2s for the first 30s, then 5s. A typical render lands inside the fast
 * window, so the common case feels immediate; a slow one settles into a
 * cadence cheap enough to leave running while the phone is in someone's
 * pocket.
 */
export const DEFAULT_POLL_SCHEDULE: PollSchedule = {
  fastMs: 2_000,
  slowMs: 5_000,
  fastWindowMs: 30_000,
};

/**
 * Delay before the next poll, given how long this polling run has been going.
 * Monotonic and bounded: it only ever steps from fast to slow, and slow is the
 * cap.
 */
export function nextPollDelayMs(
  elapsedMs: number,
  schedule: PollSchedule = DEFAULT_POLL_SCHEDULE
): number {
  return elapsedMs < schedule.fastWindowMs ? schedule.fastMs : schedule.slowMs;
}

/**
 * Generate is refused only at the concurrency cap — never merely because
 * something is already running. Three at once is the point.
 *
 * `pendingCount` is the client's own in-flight `generateDesign` calls: the job
 * row does not exist until the action returns, so without counting them a fast
 * triple-tap would send four requests and let the server reject the last.
 */
export function isAtGenerationCap(
  runningCount: number,
  pendingCount: number,
  cap: number = GENERATION_CAP
): boolean {
  return runningCount + pendingCount >= cap;
}

/**
 * Consecutive failed polls tolerated before the loop goes dormant.
 *
 * Four is roughly 14 seconds of failure (2s, 2s, 5s, 5s): long enough to ride
 * out the things that routinely outlast a single interval — a redeploy, a
 * tunnel, a phone switching networks — and short enough that a tab whose
 * design was deleted underneath it stops within seconds of losing the user's
 * attention. Three (~9s) risks giving up during a deploy; more than four just
 * spends battery to reach the same conclusion.
 *
 * Going dormant is not terminal: the visibilitychange/focus refetch resets the
 * count and resumes, so a tab is only ever silent while nobody is looking at it.
 */
export const MAX_CONSECUTIVE_POLL_ERRORS = 4;

/** Error budget spent — stop the timer loop until a wake event resets it. */
export function isPollHalted(
  consecutiveErrors: number,
  max: number = MAX_CONSECUTIVE_POLL_ERRORS
): boolean {
  return consecutiveErrors >= max;
}
