/**
 * The one confirm copy every conversation Delete uses (the Studio lane and
 * the image detail page's conversation actions). `deleteDesign` does not
 * always delete: an order anywhere on the conversation archives it instead,
 * and an image another design, a cart or an order still references is
 * detached rather than removed. The consequence line says so, because the
 * alternative is a promise the action does not keep.
 *
 * Split into a title (the sheet's question) and a consequence (the sheet's
 * body) so neither repeats the other — a single combined string used to open
 * with the same question the sheet's title already asks.
 */
export const DELETE_CONVERSATION_TITLE = "Delete this conversation?";
export const DELETE_CONVERSATION_CONSEQUENCE =
  "Images used in an order, another design, or a cart are kept. A conversation with an order is archived instead.";

/** Error message the closed-conversation guard throws; the Studio keys its
 * closed state off the server row, so this is just the action backstop. */
export const CONVERSATION_CLOSED_MESSAGE = "This design is closed.";

/**
 * Guard for `generateDesign`, its only caller (attach checks `closedAt`
 * itself): a closed conversation (design.closed_at set) is read-only. Pure — the actions
 * already hold the design row, so no extra query. Model B slice 3.
 */
export function assertConversationOpen(design: { closedAt: Date | null }): void {
  if (design.closedAt !== null) throw new Error(CONVERSATION_CLOSED_MESSAGE);
}
