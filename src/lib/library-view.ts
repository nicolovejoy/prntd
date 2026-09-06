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
  | "not-found"
  | "failed";

/**
 * One short phrase per reason, Clean Label voice: states the fact, offers no
 * apology and no instruction. `not-owned` and `not-found` say the same thing
 * on purpose — the action reports both for ids it will not touch, and the
 * distinction is only meaningful to a caller probing for someone else's
 * image. `failed` is the write that threw: the image is still there and the
 * user can try again, which is a different thing to say than "kept".
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
    case "failed":
      return "Couldn't delete";
  }
}

/** The confirm sheet's question. */
export function bulkImageDeleteTitle(count: number): string {
  return count === 1 ? "Delete this image?" : `Delete ${count} images?`;
}

/**
 * The one line of consequence under it. The order rule is the only one worth
 * saying up front — the others (an image another conversation or a cart still
 * points at) are rare and reported after the fact by the notice below.
 *
 * Takes the count (mirroring bulkDeleteConsequence in studio-view) though the
 * line reads the same for one image or twenty — the caller shouldn't have to
 * know which helpers happen to vary.
 */
export function bulkImageDeleteConsequence(count: number): string {
  void count;
  return "Images used in an order are kept.";
}

/**
 * One plain sentence about what a bulk delete left behind, or null when
 * nothing was skipped. Groups by reason (in the order below, so the notice
 * reads the same way every time) and counts each group; `not-owned` and
 * `not-found` collapse into one group because imageDeleteSkipCopy already
 * says the same thing for both.
 *
 * "wasn't deleted" rather than "kept": it is true of the reasons where the
 * image was deliberately kept AND of `failed`, where the write threw.
 */
export function bulkImageDeleteNotice(
  skipped: { imageId: string; reason: ImageDeleteSkipReason }[]
): string | null {
  if (skipped.length === 0) return null;
  const order: ImageDeleteSkipReason[] = [
    "order",
    "in-use",
    "not-owned",
    "not-found",
    "failed",
  ];
  const counts = new Map<string, number>();
  for (const reason of order) {
    const n = skipped.filter((s) => s.reason === reason).length;
    if (n === 0) continue;
    const phrase = imageDeleteSkipCopy(reason);
    counts.set(phrase, (counts.get(phrase) ?? 0) + n);
  }
  const parts = [...counts].map(([phrase, n]) =>
    skipped.length === 1 ? phrase : `${phrase} (${n})`
  );
  const lead =
    skipped.length === 1
      ? "1 image wasn't deleted"
      : `${skipped.length} images weren't deleted`;
  return `${lead} — ${parts.join(", ")}.`;
}
