/**
 * Pure, client-safe helpers for the Studio's lost-submit reconcile (#245): no
 * db import, no server-only module, safe to bundle into studio-client.tsx.
 */

/**
 * Hard bound on `constructDesignBrief`'s Anthropic call (src/lib/ai.ts). The
 * brief is the only slow step before the job row is written, and the SDK's
 * own default (10 min, 3 retries) has no bound at all — without one, a lost
 * submit's fate would be unknowable for far longer than a phone screen should
 * sit on a stuck cell.
 */
export const DESIGN_BRIEF_TIMEOUT_MS = 45_000;

/**
 * How long a lost submit's reconcile loop waits before giving up as failed.
 * Set above DESIGN_BRIEF_TIMEOUT_MS with margin for cold start and the DB
 * work around the brief call: the server started the request no later than
 * the client's catch, so in practice its job row exists by this deadline or
 * never will. Residual case: a Turso stall of more than ~15 s across
 * generateDesign's pre-insert round trips could still write the row after
 * the deadline. The client then shows the old failure (notice, words back)
 * and the cell appears on the next poll — today's behaviour, not a new
 * failure.
 */
export const LOST_SUBMIT_WINDOW_MS = 60_000;

/** Poll cadence while reconciling a lost submit. */
export const LOST_SUBMIT_LOOKUP_INTERVAL_MS = 3_000;

/**
 * Bounds a single reconcile lookup call (second independent review, item 3).
 * `getGenerationJobStatus` is a plain Server Function call with no timeout of
 * its own; a request that never resolves (a genuinely hung connection, not
 * just a fast network error) would otherwise stall the reconcile loop
 * forever — no further attempts, no notice, ever, until
 * `settleOptimistic`'s unrelated STALE_OPTIMISTIC_MS age-out silently drops
 * the cell. Comfortably longer than `LOST_SUBMIT_LOOKUP_INTERVAL_MS` (3s) so
 * an ordinary round trip is never cut off, short enough that a hung request
 * costs only a few poll cycles rather than an unbounded wait. A timeout is
 * treated exactly like a lookup that threw — see `judgeLostSubmit`'s
 * "error" handling. Abandoning the promise client-side does not free up
 * anything server-side: Next's action queue (`runRemainingActions`) runs one
 * Server Function at a time, so a lookup that is genuinely still working on
 * the server keeps that queue occupied for however long it actually takes,
 * delaying every action queued behind it (including this loop's own next
 * lookup) regardless of this timeout. The loop stays bounded anyway, because
 * each timed-out lookup is simply counted as an "error" attempt toward
 * `LOST_SUBMIT_ERROR_ATTEMPTS` like any other — it does not need the queue to
 * drain to make progress.
 */
export const LOST_SUBMIT_LOOKUP_TIMEOUT_MS = 10_000;

/**
 * How many CONSECUTIVE "error" lookups (see `judgeLostSubmit`'s
 * `errorStreakCount`) a lost submit's reconcile loop must see, past
 * `hardDeadlineMs`, before an "error" verdict may fail the submit. Measured
 * in ATTEMPTS rather than wall-clock time (third review, 2026-09-27; see
 * `errorStreakCount`'s docs for why) — roughly `LOST_SUBMIT_WINDOW_MS` worth
 * of tries at the ordinary cadence, so an actively-retrying device gets
 * about the same grace a fresh submit gets from `deadlineMs` itself.
 */
export const LOST_SUBMIT_ERROR_ATTEMPTS = Math.ceil(
  LOST_SUBMIT_WINDOW_MS / LOST_SUBMIT_LOOKUP_INTERVAL_MS
);

/**
 * The pure status union `getGenerationJobStatusForUser` (src/lib/generation-job.ts)
 * resolves to. Defined here, not there, so a client component can import the
 * type without pulling in that module's db import.
 */
export type GenerationJobStatus = {
  status: "running" | "succeeded" | "failed" | "cancelled" | "none";
};

/** One reconcile lookup's outcome: a real status, or the lookup itself threw. */
export type LostSubmitLookup = GenerationJobStatus["status"] | "error";

/**
 * Decides one round of the lost-submit reconcile loop.
 *
 * `calledAtMs` is when THIS lookup was called (the Server Function invoked),
 * not when it resolved. The Next client runs Server Functions strictly one at
 * a time (`runRemainingActions`): a call made at time T is dispatched, and so
 * runs on the server, at or after T. That makes T a safe lower bound, and a
 * lookup called BEFORE the deadline can never fail the submit, however
 * late it actually resolves — it may have queued behind another in-flight
 * action and been answered from a moment when the row was still being
 * written. Only a lookup called AFTER the deadline can trust "none" (or an
 * error) as the server's last word.
 */
export function judgeLostSubmit(params: {
  status: LostSubmitLookup;
  calledAtMs: number;
  deadlineMs: number;
  /**
   * A second, later backstop for a lookup that keeps ERRORING past
   * `deadlineMs` (independent review of the rebuild, item 1). An error proves
   * nothing about the job — the lookup itself may never have reached the
   * server, unlike a real "none" answer, which is server truth that no such
   * row exists. Treating the first post-deadline ERROR as proof of failure
   * loses a result that actually landed whenever the phone's network happens
   * to be down at exactly that moment (the prod scenario this fix is for: two
   * minutes backgrounded, the render finishes, the tab returns to
   * momentarily no network) — the render finishes regardless, the words come
   * back next to the finished image, and a re-tap duplicates it. So an
   * "error" keeps waiting past `deadlineMs` and only fails once
   * `errorStreakCount` (below) has itself reached `LOST_SUBMIT_ERROR_ATTEMPTS`
   * past this point. It is set to `Date.now()` at submit plus
   * `STALE_OPTIMISTIC_MS` (src/lib/generation-poll.ts): past that point
   * `settleOptimistic` may already have dropped the overlay entry on its own
   * age-out rule, on whatever poll happens to run next — independently of
   * this verdict and possibly before it. That is not a bug in this function:
   * a cell that vanished early is not the same as a submit that failed, and
   * `failSubmit` still restores the words and shows the notice whenever this
   * loop does eventually decide "failed", even if nothing on screen was
   * showing the cell any more by then.
   */
  hardDeadlineMs: number;
  /**
   * How many CONSECUTIVE "error" lookups have occurred so far, ending with
   * (and including) this call — 0 if the last lookup was not an error (no
   * streak in progress). Ignored for every status other than "error".
   *
   * Counted in ATTEMPTS, not wall-clock time (third review, 2026-09-27; this
   * replaces the original `errorStreakStartMs`, which measured the streak by
   * elapsed time from its first error). A device freeze inflates a
   * time-based streak for free: no attempts are made while the phone sleeps,
   * but the clock keeps running regardless, so a phone that freezes for 8
   * minutes and wakes up offline saw its very first post-wake lookup already
   * credited with a full `LOST_SUBMIT_WINDOW_MS` of "streak duration" it
   * never actually attempted — failing a submit that then lands anyway
   * (#245 again, one level up, or a lookup in flight when the freeze hit).
   * Counting attempts instead means sleep cannot consume any of the budget:
   * only lookups the device genuinely made and that genuinely errored do.
   * `LOST_SUBMIT_ERROR_ATTEMPTS` (≈ `LOST_SUBMIT_WINDOW_MS` worth of tries at
   * the ordinary cadence) is the threshold; any non-error answer resets this
   * to 0, and it is likewise irrelevant before `hardDeadlineMs` — a phone
   * that never went anywhere near sleep hits the ordinary `deadlineMs`/"none"
   * path long before this backstop matters.
   */
  errorStreakCount: number;
}): "landed" | "failed" | "cancelled" | "wait" {
  const { status, calledAtMs, deadlineMs, hardDeadlineMs, errorStreakCount } = params;
  if (status === "running" || status === "succeeded") return "landed";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  // "none" is server truth (no such row) and is judged against the ordinary
  // deadline, same as before.
  if (status === "none") return calledAtMs >= deadlineMs ? "failed" : "wait";
  // "error": the lookup itself failed to answer — see hardDeadlineMs above.
  // Failing requires BOTH the hard backstop to have passed AND the number of
  // CONSECUTIVE errors (attempts, not elapsed time — errorStreakCount's docs)
  // to have reached LOST_SUBMIT_ERROR_ATTEMPTS — a lone error right as the
  // hard deadline is crossed is not proof of anything by itself.
  if (calledAtMs < hardDeadlineMs) return "wait";
  return errorStreakCount >= LOST_SUBMIT_ERROR_ATTEMPTS ? "failed" : "wait";
}

/**
 * True iff `err` carries a string `digest` — how React's Flight client marks
 * an error that was rebuilt from an actual server-side throw
 * (`resolveErrorProd` / `resolveErrorDev`; the server attaches it in
 * `createReactServerErrorHandler`). A lost response (a fetch `TypeError`, a
 * cut stream, a 504) reaches the client with no digest at all.
 * `generateDesign` throws only while no job row exists (#245 design), except
 * one case: `insertGenerationJob`'s read-back after a successful insert
 * (src/lib/generation-job.ts) can itself throw, after the row is committed.
 * There, the outer catch refunds while the running row has no continuation,
 * so the stale sweep later fails it and refunds again (a double refund), and
 * it holds a cap slot until then. Pre-existing, out of scope for #245 (see
 * plan). A digest otherwise means this submit definitely never queued and the
 * reconcile window would be wasted time.
 */
export function isServerActionError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    typeof (err as { digest?: unknown }).digest === "string"
  );
}
