/**
 * Timing and capacity arithmetic for the /design job poller.
 *
 * Pure and framework-free so the schedule is unit-testable without mounting a
 * component — the page holds no timing logic of its own, it just asks this
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
 * Whether the poller should be running at all. Jobs still tracked but not yet
 * running count: a job settles by leaving the running list, and its outcome
 * (the image, the assistant turn, an error) is read on the poll that notices.
 * Stopping the moment `running` empties would drop exactly that poll.
 */
export function shouldPoll(runningCount: number, trackedCount: number): boolean {
  return runningCount > 0 || trackedCount > 0;
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
