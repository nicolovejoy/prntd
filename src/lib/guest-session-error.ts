/**
 * Why a guest-session mint failed (#188 slice 2b review). Better-Auth's
 * client returns `{ data, error }` instead of throwing, and the HTTP status
 * is what tells a retryable refusal from a dead end: its default rate limit
 * allows 3 requests per 10 s per IP on /sign-in*, so a fourth anonymous
 * sign-in from one address inside the window gets a 429 with an
 * `X-Retry-After` header (seconds).
 */
export class GuestSessionError extends Error {
  readonly status: number | null;
  /** Whole seconds from `X-Retry-After`, when the response carried one. */
  readonly retryAfterSeconds: number | null;

  constructor(
    message: string,
    status: number | null,
    retryAfterSeconds: number | null = null
  ) {
    super(message);
    this.name = "GuestSessionError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
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
