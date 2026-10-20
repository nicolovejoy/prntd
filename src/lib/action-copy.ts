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

// --- image detail page (InlineNotice: one line; CHECKOUT_FAILED is shared with the cart page) ---

export const OPEN_CONVERSATION_FAILED = "Couldn't open this conversation. Try again.";
export const DELETE_CONVERSATION_FAILED = "Couldn't delete this conversation. Try again.";
export const START_FROM_IMAGE_FAILED = "Couldn't start a new design from this image. Try again.";
export const SET_PRIMARY_IMAGE_FAILED = "Couldn't make this the design's image. Try again.";
export const EMPTY_TITLE_REJECTED = "A title can't be blank. Type a title or cancel.";
export const TITLE_TOO_LONG = "A title can't be longer than 80 characters.";
export const SAVE_TITLE_FAILED = "Couldn't save this title. Try again.";
// No "Try again" on these two: the same failure can be a refusal (a back on a
// garment with no back print area, a pick hidden since it was chosen) that
// fails identically on every retry, so a retry line would be a lie.
// CHECKOUT_FAILED is also what the cart page shows when `checkoutCart` throws.
// The line is true there too: no session reached the buyer, so nothing can
// have been charged.
export const CHECKOUT_FAILED = "Couldn't start checkout. Nothing was charged.";
export const ADD_TO_CART_FAILED = "Couldn't add this to your cart.";

/** consumeCheckoutQuota refused this account for the day (#316). Returned as
 * data (`{ error }`) by buyPublishedDesign and checkoutCart. Mirrors the
 * generation limit line in src/app/design/actions.ts. */
export const CHECKOUT_LIMIT_REACHED =
  "You've reached today's checkout limit. Try again later.";

/** The same refusal on the IP bucket. */
export const CHECKOUT_LIMIT_REACHED_IP =
  "This network has hit today's checkout limit. Try again later.";

/** addToCart refused: the cart already holds CART_MAX_LINES lines (#316).
 * Returned as data. */
export const CART_FULL = "Your cart is full. Remove a line to add another.";

/** checkoutCart refused: the cart holds more than CART_MAX_LINES lines (only
 * reachable when a guest cart is merged into the account's cart on sign-in,
 * which moves every row with no cap). Returned as data. */
export const CART_TOO_FULL_TO_CHECKOUT =
  "Your cart has too many lines to check out. Remove some to continue.";

/** The line a checkout-cap refusal shows, by the bucket that refused. */
export function checkoutLimitMessage(reason: "identity" | "ip" | undefined): string {
  return reason === "ip" ? CHECKOUT_LIMIT_REACHED_IP : CHECKOUT_LIMIT_REACHED;
}

// --- Studio composer ---

/** generateDesign refused a turn with no words, before any quota, write or
 * model call. Returned as data (`{ kind: "empty", message }`); the Studio shows
 * it as its notice. */
export const EMPTY_GENERATE_TURN = "Type what you'd like on the shirt first.";

// --- Studio reference-image attach (#188 slice 2a) ---
// Refusals cross the wire as data and the client shows `message` verbatim.

export const ATTACH_LABEL = "Attach image";
/** Replaces the label while an upload is in flight. */
export const ATTACH_BUSY = "Uploading…";
/** The device check and the server refusal for a file over the cap. */
export const ATTACH_TOO_LARGE = "That image is over 3 MB. Choose a smaller one.";
export const ATTACH_UNSUPPORTED = "That file isn't a supported image. Use a PNG, JPEG or WebP.";
export const ATTACH_FAILED = "Couldn't attach that image. Try again.";
export const ATTACH_LIMIT_REACHED = "You've reached today's upload limit. Try again later.";
export const ATTACH_LIMIT_REACHED_IP = "This network has hit today's upload limit. Try again later.";
/** A stage attach to a conversation that was closed in the meantime. */
export const ATTACH_CONVERSATION_CLOSED = "This conversation is closed.";

/** The line an upload-cap refusal shows, by the bucket that refused. */
export function attachLimitMessage(reason: "identity" | "ip" | undefined): string {
  return reason === "ip" ? ATTACH_LIMIT_REACHED_IP : ATTACH_LIMIT_REACHED;
}

/** publishImage refused an uploaded photo (#355): an upload is an input to a
 * design, not a design. The image detail page shows no Publish for one, so
 * this only reaches a direct call. */
export const UPLOAD_NOT_PUBLISHABLE =
  "Attached photos can't be published. Publish a design made from one instead.";

/** Un-publish confirm for an uploaded photo (#355 leftover). Only a photo
 * published before #357 can reach it. Un-publishing is final for a photo, so
 * the sheet drops the ordinary design's "You can re-publish it later." */
export const UNPUBLISH_UPLOAD_TITLE = "Take this photo down from the storefront?";
export const UNPUBLISH_UPLOAD_BODY =
  "An attached photo can't be published, so this can't be undone.";

// --- Studio delete (#352) ---
// Shown on the lane's More trigger and the bulk Delete button while the read
// that decides whether the confirm names the Shop is in flight.

export const STUDIO_DELETE_CHECKING = "Checking…";

// --- /design entry (#188 slice 2b) ---
// The sessionless hop through /design: a status line while the guest session
// is minted, and one failure line with a retry.

export const DESIGN_ENTRY_OPENING = "Opening the Studio…";
export const DESIGN_ENTRY_FAILED = "Couldn't start a session. Try again.";
export const DESIGN_ENTRY_RETRY = "Try again";

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

// --- cart ---

/** The cart's quantity stepper write failed (a thrown server action). The
 * stepper snaps back to the server's number. */
export const QUANTITY_UPDATE_FAILED = "Couldn't change the quantity.";

/** checkoutCart refused: a line's image is no longer something this buyer may
 * order or print. Returned as data (`{ error }`), so it survives production's
 * masking of thrown server-action errors. */
export const CART_LINE_UNAVAILABLE =
  "A design in your cart is no longer available. Remove it to continue.";

/** The label on the cart line that failed that check. */
export const CART_LINE_UNAVAILABLE_LABEL = "No longer available";

/** updateCartItem threw (a refusal such as a back on a garment with no back
 * print area, or a failure). No "Try again": the refusal fails identically on
 * every retry. */
export const UPDATE_CART_FAILED = "Couldn't save the changes to your cart.";

/** updateCartItem returned not-found: the line was removed (another tab,
 * or a paid checkout) while the panel was open on it. */
export const CART_LINE_GONE = "This line is no longer in your cart.";
