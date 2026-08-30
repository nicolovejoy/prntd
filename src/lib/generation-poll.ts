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

/**
 * Why a generation stopped, as a closed set. The job row's raw `error` is a
 * provider or internal string — it can echo prompt text or vendor moderation
 * wording, and the image detail and design pages are guest-reachable — so it
 * is classified server-side and never crosses the wire. /admin/errors and the
 * job row keep the diagnostic detail.
 */
export type GenerationFailure = "timeout" | "failed";

/** The exact string sweepStaleJobs writes for an overdue job. */
const TIMEOUT_ERROR = "Generation timed out";

export function classifyGenerationFailure(error: string | null): GenerationFailure {
  return error === TIMEOUT_ERROR ? "timeout" : "failed";
}

/**
 * Authored copy, Clean Label voice (docs/design-system.md): plain, no apology
 * theatre, says what to do next. Never interpolates anything from the server.
 */
export const GENERATION_FAILURE_COPY: Record<GenerationFailure, string> = {
  timeout: "That one took too long and stopped. Try again.",
  failed: "Something went wrong generating that. Try again.",
};

/** One live generation, as the thread view renders it. */
export interface RunningJob {
  jobId: string;
  generationNumber: number;
}

/** The shape `getDesignJobs` reports back. */
export interface JobPollResult {
  running: RunningJob[];
  settled: {
    jobId: string;
    status: "succeeded" | "failed";
    imageId: string | null;
    failure: GenerationFailure | null;
  }[];
}

/**
 * What the page should do with one poll response.
 *
 * `settling` is the set of tracked ids whose outcome is being applied on THIS
 * tick. It is not "ids to untrack now": untracking happens only after the
 * outcome has actually landed, which is what keeps the revisit-cache write-back
 * gated across the whole settle (see the page's pollOnce).
 */
export interface JobPollStep {
  running: RunningJob[];
  settling: string[];
  /** A generation succeeded — the thread (chat AND gallery) must be re-read. */
  refreshThread: boolean;
  /** Authored line to surface, or null. */
  errorCopy: string | null;
}

/**
 * Pure state math for one poll. Extracted from the component so the two
 * load-bearing branches — deferral while a chat turn is in flight, and the
 * decision to re-read the thread — are testable without mounting anything.
 *
 * `chatTurnInFlight` defers the whole settle rather than dropping it:
 * `sendChatMessage` persists both its rows only when it returns, so a
 * whole-thread read taken meanwhile would render the user's own words back out
 * of the thread. Deferring reports no settling ids, which leaves them tracked,
 * which keeps the poll loop alive to try again.
 */
export function reduceJobPoll(input: {
  trackedJobIds: string[];
  result: JobPollResult;
  chatTurnInFlight: boolean;
}): JobPollStep {
  const { running, settled } = input.result;

  if (input.chatTurnInFlight) {
    return { running, settling: [], refreshThread: false, errorCopy: null };
  }

  // Only ids we are actually tracking: a settled row for anything else (a job
  // the user cancelled, say) is not this page's to react to.
  const settling = settled
    .filter((job) => input.trackedJobIds.includes(job.jobId))
    .map((job) => job.jobId);

  const failure = settled.find(
    (job) => settling.includes(job.jobId) && job.status === "failed"
  );

  return {
    running,
    settling,
    refreshThread: settled.some(
      (job) => settling.includes(job.jobId) && job.status === "succeeded"
    ),
    errorCopy: failure
      ? GENERATION_FAILURE_COPY[failure.failure ?? "failed"]
      : null,
  };
}
