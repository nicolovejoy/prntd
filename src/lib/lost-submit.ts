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
   * "error" keeps waiting past `deadlineMs` and only fails at this later
   * backstop. It is set to `Date.now()` at submit plus `STALE_OPTIMISTIC_MS`
   * (src/lib/generation-poll.ts): past that point `settleOptimistic` would
   * drop the overlay entry on its own age-out rule regardless of this
   * verdict, so the reconcile loop must stop actively here rather than poll
   * forever into the void chasing an entry nothing will show any more.
   */
  hardDeadlineMs: number;
}): "landed" | "failed" | "cancelled" | "wait" {
  const { status, calledAtMs, deadlineMs, hardDeadlineMs } = params;
  if (status === "running" || status === "succeeded") return "landed";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  // "none" is server truth (no such row) and is judged against the ordinary
  // deadline, same as before.
  if (status === "none") return calledAtMs >= deadlineMs ? "failed" : "wait";
  // "error": the lookup itself failed to answer — see hardDeadlineMs above.
  return calledAtMs >= hardDeadlineMs ? "failed" : "wait";
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
