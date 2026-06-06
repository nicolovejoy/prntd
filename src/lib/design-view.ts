/**
 * The /design page opens as a centered composer (empty state) and only
 * reveals the two-column working layout once there is content. The split is
 * a pure function of data already loaded on the page — no persisted flag.
 */
export function isDesignEmpty(messageCount: number, imageCount: number): boolean {
  return messageCount === 0 && imageCount === 0;
}
