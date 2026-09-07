/**
 * User-visible copy for action failures and results, split out of the call
 * sites the way #200 split the confirm copy. Persona C (docs/design-system.md
 * Part 1): plain statement of what happened, then what to do. No apologies,
 * no exclamation marks.
 *
 * Customer-facing constants never interpolate a thrown error's message: in
 * production Next.js masks server-action throws behind a digest, so
 * `err.message` is not the sentence the server wrote. Structured refusals
 * that come back as `{ error }` are shown verbatim by their call site —
 * those cross the wire as data and are already written for the reader.
 * Admin constants pair with a raw-error `hint`, because the admin surface has
 * exactly one operator and he wants the diagnostic.
 */

// --- /design thread (NoticeSheet: title + body) ---

export const DELETE_IMAGE_ERROR = {
  title: "Image not deleted",
  body: "It may be on an order or used by another design. Refresh the page and try again.",
} as const;

export const CLOSE_CONVERSATION_ERROR = {
  title: "Conversation not closed",
  body: "Try again.",
} as const;

export const REOPEN_CONVERSATION_ERROR = {
  title: "Conversation not reopened",
  body: "Try again.",
} as const;

export const START_FROM_IMAGE_ERROR = {
  title: "New design not started",
  body: "The image is still here. Try again.",
} as const;

// --- image detail page (InlineNotice: one line) ---

export const OPEN_CONVERSATION_FAILED = "Couldn't open this conversation. Try again.";
export const DELETE_CONVERSATION_FAILED = "Couldn't delete this conversation. Try again.";
export const START_FROM_IMAGE_FAILED = "Couldn't start a new design from this image. Try again.";
export const SET_PRIMARY_IMAGE_FAILED = "Couldn't make this the design's image. Try again.";

// --- admin (InlineNotice: one line, plus the raw error as a hint) ---

export const ADMIN_RETRY_FAILED = "Retry failed.";
export const ADMIN_RECOVER_FAILED = "Recover failed.";
export const ADMIN_REFUND_FAILED = "Refund failed.";
export const ADMIN_REFUND_ISSUED = "Refund issued.";
export const ADMIN_ALREADY_REFUNDED = "Already refunded — no action taken.";
export const ADMIN_RECOVER_ARCHIVE_HINT =
  "If the Stripe session was never paid, archive the order instead.";

export const adminRecovered = (action: string) => `Recovered: ${action}`;
export const adminCannotRecover = (reason: string) => `Cannot recover: ${reason}`;
export const adminCannotRefund = (reason: string) => `Cannot refund: ${reason}`;
