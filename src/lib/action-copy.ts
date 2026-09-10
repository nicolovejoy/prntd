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
  body: "It may be on an order or linked to another design, which keeps it from being deleted.",
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

// --- /design thread (ConfirmSheet: title + body) ---

export const DELETE_IMAGE_TITLE = "Delete this image?";

/**
 * The image-lightbox confirm's consequence line (#242 review finding 4).
 * `deleteDesignImage` isn't always a delete of just the image: the rules in
 * delete-image.ts can downgrade it to a link-detach (an order, another
 * design, a shop product, or a cart line still needs it), and either way —
 * delete or detach — removing THIS conversation's link can leave the
 * conversation with zero images left, in which case `removeDesignIfNowEmpty`
 * removes the conversation too, chat included (owner ruling, 2026-09-09).
 * The caller passes `isLastImage` (the thread had exactly one image before
 * this delete) so the sheet says so up front rather than surprising the user
 * after the fact — true of a "Delete" as much as a seed's "Remove", since a
 * fresh-start thread whose only image is its seed empties exactly the same
 * way once that link is detached.
 */
export function deleteImageConsequence(isLastImage: boolean): string {
  const kept = "Used in an order, another design, or a cart, it's kept instead.";
  if (!isLastImage) return kept;
  return `This is the conversation's last image, so the conversation and its chat go too. ${kept}`;
}

// --- image detail page (InlineNotice: one line) ---

export const OPEN_CONVERSATION_FAILED = "Couldn't open this conversation. Try again.";
export const DELETE_CONVERSATION_FAILED = "Couldn't delete this conversation. Try again.";
export const START_FROM_IMAGE_FAILED = "Couldn't start a new design from this image. Try again.";
export const SET_PRIMARY_IMAGE_FAILED = "Couldn't make this the design's image. Try again.";
export const EMPTY_TITLE_REJECTED = "A title can't be blank. Type a title or cancel.";
export const TITLE_TOO_LONG = "A title can't be longer than 80 characters.";
export const SAVE_TITLE_FAILED = "Couldn't save this title. Try again.";

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

// --- Error boundaries (src/app/error.tsx, global-error.tsx) ---

export const ERROR_BOUNDARY_TITLE = "Something went wrong loading this page.";
export const ERROR_BOUNDARY_RETRY = "Try again";
export const ERROR_BOUNDARY_HOME = "Go to the home page";
