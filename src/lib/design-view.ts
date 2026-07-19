/**
 * The /design page opens as a centered composer (empty state) and only
 * reveals the two-column working layout once there is content. The split is
 * a pure function of data already loaded on the page — no persisted flag.
 */
export function isDesignEmpty(messageCount: number, imageCount: number): boolean {
  return messageCount === 0 && imageCount === 0;
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
