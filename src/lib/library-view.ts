/**
 * Pure view helpers for My Designs (the image library). Kept out of the
 * server action so the copy is testable and the client can render a skip
 * without re-deriving why.
 */

/**
 * Why a bulk image delete kept an image. Narrower than the conversation-level
 * BulkDeleteSkipReason (studio-view.ts) because the rules differ one object
 * down: an image is kept for an order, or because something else still points
 * at it (another conversation, a shop product, a cart line — all one reason to
 * the user, who cannot act on the distinction from this screen).
 */
export type ImageDeleteSkipReason =
  | "order"
  | "in-use"
  | "not-owned"
  | "not-found";

/**
 * One short phrase per reason, Clean Label voice: states the fact, offers no
 * apology and no instruction. `not-owned` and `not-found` say the same thing
 * on purpose — the action reports both for ids it will not touch, and the
 * distinction is only meaningful to a caller probing for someone else's
 * image.
 */
export function imageDeleteSkipCopy(reason: ImageDeleteSkipReason): string {
  switch (reason) {
    case "order":
      return "Used in an order";
    case "in-use":
      return "Used elsewhere";
    case "not-owned":
    case "not-found":
      return "No longer available";
  }
}
