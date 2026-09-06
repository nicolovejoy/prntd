/**
 * Client-safe display helpers for the Studio. Kept apart from studio.ts,
 * which imports drizzle + schema and must never reach the client bundle
 * (the generation-poll.ts precedent).
 */

/** Elapsed time on a pending cell: "0:07", "1:23". Clock skew clamps to 0. */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Lane-header recency, same scale /designs cards use. */
export function timeAgo(date: Date, nowMs: number = Date.now()): string {
  const seconds = Math.floor((nowMs - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString();
}

/**
 * The date an archived conversation left the Studio, e.g. "Sep 4" — or
 * "Sep 4, 2025" once it is not this year.
 *
 * Formatted in America/Los_Angeles rather than the server's zone: timestamps
 * are stored UTC, and a calendar day shown to a person is Nico's day. A bare
 * toLocaleDateString() on a Vercel function renders the UTC day, which is
 * tomorrow for anything after 5pm Pacific.
 */
export function formatClosedDate(date: Date, now: Date = new Date()): string {
  const zone = "America/Los_Angeles";
  const yearOf = (d: Date) =>
    new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric" }).format(d);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    month: "short",
    day: "numeric",
    ...(yearOf(date) === yearOf(now) ? {} : { year: "numeric" }),
  }).format(date);
}

/** Why deleteConversations left a conversation alone (studio/actions.ts). */
export type BulkDeleteSkipReason = "ordered" | "not_found" | "failed";

export interface BulkDeleteResult {
  deleted: string[];
  skipped: { id: string; reason: BulkDeleteSkipReason }[];
}

/**
 * The one confirm before a bulk delete. Same voice as
 * DELETE_CONVERSATION_CONFIRM: says what is kept, because the action keeps
 * it. Differs from the single Delete in one respect it states plainly — a
 * conversation with an order is skipped, not archived.
 */
export function bulkDeleteConfirm(count: number): string {
  const noun = count === 1 ? "conversation" : "conversations";
  const poss = count === 1 ? "its" : "their";
  return `Delete ${count} ${noun} and ${poss} images? Images used in an order, another design, or a cart are kept. Conversations with an order are kept.`;
}

/**
 * One plain line about what a bulk delete left behind, or null when nothing
 * was skipped. Counts by reason; `not_found` (an id that was gone or never
 * the caller's) says nothing — there was no lane of theirs to lose.
 */
export function bulkDeleteSkipNotice(
  skipped: BulkDeleteResult["skipped"]
): string | null {
  const by = (reason: BulkDeleteSkipReason) =>
    skipped.filter((s) => s.reason === reason).length;
  const ordered = by("ordered");
  const failed = by("failed");
  const parts: string[] = [];
  if (ordered > 0) {
    parts.push(
      ordered === 1
        ? "1 kept — it has an order."
        : `${ordered} kept — they have orders.`
    );
  }
  if (failed > 0) {
    parts.push(`${failed} couldn't be deleted. Try again.`);
  }
  return parts.length > 0 ? parts.join(" ") : null;
}
