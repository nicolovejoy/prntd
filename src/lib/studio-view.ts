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
