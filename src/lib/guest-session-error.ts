import { GUEST_SESSION_RATE_LIMITED } from "./action-copy";

/**
 * Why a guest-session mint failed (#188 slice 2b review). Better-Auth's
 * client returns `{ data, error }` instead of throwing, and the HTTP status
 * is what tells a retryable refusal from a dead end: its default rate limit
 * allows 3 requests per 10 s per IP on /sign-in*, so a fourth anonymous
 * sign-in from one address inside the window gets a 429 with an
 * `X-Retry-After` header (seconds).
 */
export type GuestSessionStage = "lookup" | "mint";

export class GuestSessionError extends Error {
  readonly status: number | null;
  /** Whole seconds from `X-Retry-After`, when the response carried one. */
  readonly retryAfterSeconds: number | null;
  /**
   * Which request failed. A refused "mint" (the anonymous sign-in) means the
   * visitor has no session for sure. A failed "lookup" (get-session) says
   * nothing about whether a cookie exists: a signed-in user or a returning
   * guest whose lookup was rate-limited still holds one.
   */
  readonly stage: GuestSessionStage;

  constructor(
    message: string,
    status: number | null,
    retryAfterSeconds: number | null = null,
    stage: GuestSessionStage = "mint"
  ) {
    super(message);
    this.name = "GuestSessionError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
    this.stage = stage;
  }
}

/** The rate limiter's window, and so the wait when it names none. */
export const RATE_LIMIT_DEFAULT_WAIT_MS = 10_000;
/** The longest a visitor is made to wait before one automatic retry. */
export const RATE_LIMIT_MAX_WAIT_MS = 15_000;
/** Added to a stated Retry-After: the limiter reopens strictly after its
 * window, so waiting exactly the stated seconds can still be refused. */
const RETRY_SLACK_MS = 500;

/** Reads `X-Retry-After` (seconds) off a response's headers; null when it is
 * absent or not a positive number. */
export function parseRetryAfterSeconds(
  value: string | null | undefined
): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : null;
}

/**
 * How long to wait before retrying after `err`, or null when it is not a
 * rate-limit refusal (anything but a 429). The stated Retry-After when there
 * is one, else the limiter's 10 s window; never more than 15 s. Duck-typed on
 * `status` so a caller that mocks the mint module still gets the real rule.
 */
export function rateLimitRetryDelayMs(err: unknown): number | null {
  if (typeof err !== "object" || err === null) return null;
  const { status, retryAfterSeconds } = err as {
    status?: unknown;
    retryAfterSeconds?: unknown;
  };
  if (status !== 429) return null;
  const stated =
    typeof retryAfterSeconds === "number" && retryAfterSeconds > 0
      ? retryAfterSeconds * 1000 + RETRY_SLACK_MS
      : RATE_LIMIT_DEFAULT_WAIT_MS;
  return Math.min(stated, RATE_LIMIT_MAX_WAIT_MS);
}

/**
 * True for a rate-limited session lookup (429 on get-session). That says
 * nothing about whether a session cookie exists, so a caller that has a
 * server action to run should run it anyway: the server reads the cookie
 * itself, and the limiter only counts HTTP requests. Duck-typed, like
 * rateLimitRetryDelayMs.
 */
export function isLookupRateLimited(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const { status, stage } = err as { status?: unknown; stage?: unknown };
  return status === 429 && stage === "lookup";
}

/**
 * The line to show when starting a session, or the action that needed one,
 * failed with `err`. It is the rate-limited line for a 429 (from the lookup or
 * the mint), and also when the lookup was rate-limited earlier in the same
 * attempt (`lookupLimited`, see isLookupRateLimited) and the action then
 * failed for any reason; otherwise the caller's own `fallback`.
 */
export function guestSessionFailureMessage(
  err: unknown,
  fallback: string,
  lookupLimited = false
): string {
  const status =
    typeof err === "object" && err !== null
      ? (err as { status?: unknown }).status
      : undefined;
  return status === 429 || lookupLimited ? GUEST_SESSION_RATE_LIMITED : fallback;
}
