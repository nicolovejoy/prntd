import type { DesignImage, SourceImage } from "@/lib/design-images";

/**
 * The /design page opens as a centered composer (empty state) and only
 * reveals the two-column working layout once there is content. The split is
 * a pure function of data already loaded on the page — no persisted flag.
 */
export function isDesignEmpty(messageCount: number, imageCount: number): boolean {
  return messageCount === 0 && imageCount === 0;
}

/**
 * A pasted prompt shouldn't set the page height (#147). Past this length a
 * user message renders clamped with a "Show more" toggle. Assistant turns are
 * never clamped — they're the reply you came back for.
 */
export const MESSAGE_CLAMP_CHARS = 280;

export function shouldClampMessage(content: string): boolean {
  return content.length > MESSAGE_CLAMP_CHARS;
}

/**
 * The one confirm copy every Delete uses (My Designs' card carried its own,
 * and it was wrong). `deleteDesign` does not always delete: an order anywhere
 * on the conversation archives it instead, and an image another design, a
 * cart or an order still references is detached rather than removed. The
 * consequence line says so, because the alternative is a promise the action
 * does not keep.
 *
 * Split into a title (the sheet's question) and a consequence (the sheet's
 * body) so neither repeats the other — a single combined string used to open
 * with the same question the sheet's title already asks.
 */
export const DELETE_CONVERSATION_TITLE = "Delete this conversation?";
export const DELETE_CONVERSATION_CONSEQUENCE =
  "Images used in an order, another design, or a cart are kept. A conversation with an order is archived instead.";

/** Error message the closed-conversation guard throws; the /design UI keys
 * its closed state off the server row, so this is just the action backstop. */
export const CONVERSATION_CLOSED_MESSAGE = "This design is closed.";

/**
 * Shared guard for the three thread-write actions (chat, generate, upload):
 * a closed conversation (design.closed_at set) is read-only. Pure — the
 * actions already hold the design row, so no extra query. Model B slice 3.
 */
export function assertConversationOpen(design: { closedAt: Date | null }): void {
  if (design.closedAt !== null) throw new Error(CONVERSATION_CLOSED_MESSAGE);
}

/**
 * Drop any item whose id has already been seen, preserving order. A guard so
 * a duplicate design_image row can never surface twice in the gallery (and so
 * the gallery count the header and mobile badge both read stays correct).
 * Today the source query returns each row once; this keeps it that way if a
 * future join ever fans out.
 */
export function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

/**
 * Map thread source images to the gallery's numbered view model. Shared by
 * the /design page's gallery refresh and the thread-snapshot hydration paths
 * so every consumer numbers and shapes images identically.
 */
export function sourcesToGalleryImages(
  sources: Pick<SourceImage, "id" | "imageUrl" | "publishedAt" | "role">[]
): DesignImage[] {
  return sources.map((s, i) => ({
    id: s.id,
    number: i + 1,
    url: s.imageUrl,
    prompt: "",
    publishedAt: s.publishedAt,
    role: s.role,
  }));
}
