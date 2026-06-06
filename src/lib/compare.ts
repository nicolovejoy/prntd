/**
 * Pure helpers for the multi-generator Compare flow on /design.
 *
 * Compare runs the same prompt through every registered generator. Some may
 * fail (rate limit, model error) while others succeed, so the chat summary
 * has to count honestly and read grammatically — "Compared 1 generators" was
 * the bug (#19). Kept pure and separate from the server action so the wording
 * and the gallery de-dup are unit-testable without API keys.
 */

/** "A" | "A and B" | "A, B, and C" */
function formatList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/**
 * Build the chat summary for a Compare run from the generator labels that
 * succeeded and those that failed. Reports partial failure plainly and names
 * which styles didn't come back. Wording uses "styles" to match the
 * "Compare styles" button label.
 *
 * `succeeded` and `failed` are display labels (e.g. "Ideogram", "Recraft").
 */
export function compareSummary(succeeded: string[], failed: string[]): string {
  const total = succeeded.length + failed.length;

  // The caller throws before summarizing when nothing succeeds; this branch
  // keeps the helper total in case it's reused elsewhere.
  if (succeeded.length === 0) {
    return "No styles came back — try again?";
  }

  const drew =
    succeeded.length === 1 ? "Drew 1 style" : `Drew ${succeeded.length} styles`;
  // Lowercase form follows the em-dash; capitalized form starts a new
  // sentence after the partial-failure note.
  const tap =
    succeeded.length === 1
      ? "tap it to keep working with it."
      : "tap one to keep working with it.";

  if (failed.length === 0) {
    return `${drew} — ${tap}`;
  }

  const verb = failed.length === 1 ? "didn't return an image" : "didn't return images";
  const Tap = tap.charAt(0).toUpperCase() + tap.slice(1);
  return `Drew ${succeeded.length} of ${total} styles — ${formatList(failed)} ${verb}. ${Tap}`;
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
