/**
 * Client-safe display helpers for the Studio. Kept apart from studio.ts,
 * which imports drizzle + schema and must never reach the client bundle
 * (the generation-poll.ts precedent). The StudioLane/StudioPendingCell
 * import below is type-only, so it doesn't pull studio.ts's drizzle import
 * into this module's runtime — same pattern studio-client.tsx already uses.
 */
import type { StudioLane, StudioPendingCell } from "./studio";
import { STALE_OPTIMISTIC_MS } from "./generation-poll";

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
export type BulkDeleteSkipReason =
  | "ordered"
  | "product"
  | "not_found"
  | "failed";

export interface BulkDeleteResult {
  deleted: string[];
  skipped: { id: string; reason: BulkDeleteSkipReason }[];
}

/**
 * The one confirm before a bulk delete. Same voice as
 * DELETE_CONVERSATION_TITLE/CONSEQUENCE (design-view.ts): says what is kept,
 * because the action keeps it. Differs from the single Delete in one respect
 * it states plainly — a conversation with an order is skipped, not archived.
 *
 * Split into a title (the sheet's question) and a consequence (the sheet's
 * body) so neither repeats the other.
 */
export function bulkDeleteTitle(count: number): string {
  const noun = count === 1 ? "conversation" : "conversations";
  return `Delete ${count} ${noun}?`;
}

export function bulkDeleteConsequence(count: number): string {
  const poss = count === 1 ? "its" : "their";
  return `This deletes ${poss} images too. Images used in an order, another design, or a cart are kept. Conversations with an order are kept instead.`;
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
  const product = by("product");
  const failed = by("failed");
  const parts: string[] = [];
  if (ordered > 0) {
    parts.push(
      ordered === 1
        ? "1 kept — it has an order."
        : `${ordered} kept — they have orders.`
    );
  }
  if (product > 0) {
    parts.push(
      product === 1
        ? "1 kept — a shop product uses it."
        : `${product} kept — shop products use them.`
    );
  }
  if (failed > 0) {
    parts.push(`${failed} couldn't be deleted. Try again.`);
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * One generateDesign call the client has fired but that server lanes may
 * not reflect yet (issue #187): the pending cell needs to appear the
 * instant Generate is pressed, not after the next poll's round trip.
 *
 * `jobId` starts null (the action hasn't returned yet) and is set to the
 * real image_generation id once `generateDesign` resolves with
 * `{kind:"queued"}`. `anchorImageId` is carried for callers that need to
 * tell an anchored append apart from a fresh conversation, though
 * applyOptimistic itself derives that from server lanes rather than
 * trusting a snapshot flag, since a flag captured at submit time could go
 * stale (e.g. if the same design somehow already existed server-side).
 */
export type OptimisticEntry = {
  localId: string;
  designId: string;
  anchorImageId: string | null;
  startedAt: Date;
  jobId: string | null;
  /**
   * Client clock (ms) when `jobId` was learned. A poll's fetch can straddle
   * the job-row write — it goes out before the row exists and lands after the
   * action has resolved — and that snapshot's silence about the job means
   * nothing. settleOptimistic only trusts "lane exists, job absent" from a
   * snapshot whose fetch STARTED after this stamp. Undefined on an entry with
   * no jobId yet.
   */
  jobIdKnownAtMs?: number;
};

function optimisticCell(entry: OptimisticEntry): StudioPendingCell {
  return {
    // Real jobId once known; the localId stands in before that so the cell
    // has a stable key and Cancel (task 2) has something to disable on.
    jobId: entry.jobId ?? entry.localId,
    // Not known until the job resolves; nothing in the UI reads it today
    // (studio-client.tsx keys pending cells on jobId, not this).
    generationNumber: 0,
    startedAt: entry.startedAt,
    optimistic: true,
  };
}

/**
 * Overlays optimistic entries onto server lanes for rendering. Pure, and
 * called on every render (not folded into lane state) so a poll's
 * `setLanes(fresh)` can never wipe a cell mid-flight — see the plan's
 * Design section.
 *
 * An entry whose designId matches a server lane is appended to that lane's
 * `pending`. An entry with no matching lane (a fresh, unanchored
 * conversation the server hasn't created yet) gets a synthetic lane at
 * index 0, `title: null`, so it's the first thing above the composer on a
 * phone-width bench. Callers are expected to pass only entries
 * `settleOptimistic` has not dropped — this function does not re-check
 * jobId visibility itself.
 */
export function applyOptimistic(
  lanes: StudioLane[],
  entries: OptimisticEntry[]
): StudioLane[] {
  if (entries.length === 0) return lanes;

  const byDesign = new Map<string, OptimisticEntry[]>();
  for (const entry of entries) {
    const list = byDesign.get(entry.designId) ?? [];
    list.push(entry);
    byDesign.set(entry.designId, list);
  }

  const merged = lanes.map((lane) => {
    const group = byDesign.get(lane.designId);
    if (!group) return lane;
    byDesign.delete(lane.designId);
    return { ...lane, pending: [...lane.pending, ...group.map(optimisticCell)] };
  });

  // Two unanchored submits in a row are two synthetic lanes, and they follow
  // the bench's own activity-desc order: the newest submit leads. A lane's
  // date is the newest of its entries, so a second submit into the same
  // not-yet-server-visible design moves it up rather than pinning it to the
  // first one's start.
  const newLanes: StudioLane[] = [...byDesign.entries()]
    .map(([designId, group]) => ({
      designId,
      title: null,
      lastActiveAt: new Date(
        Math.max(...group.map((e) => e.startedAt.getTime()))
      ),
      cells: [],
      pending: group.map(optimisticCell),
    }))
    .sort((a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime());

  return [...newLanes, ...merged];
}

/**
 * Which optimistic entries still need to be kept in local state after a
 * fresh set of server lanes lands. Plan's resolution rule (Design section):
 *
 * - older than STALE_OPTIMISTIC_MS — dropped whatever else is true. Nothing
 *   the server ever accounts for lives that long, so what's left is the
 *   client's own ghost, and it would otherwise hold a cap slot and keep the
 *   poll loop alive forever.
 * - `jobId: null` (the generateDesign call hasn't returned yet) — kept; the
 *   server has nothing to say about it yet.
 * - a known `jobId` found in some lane's `pending` — dropped; the server
 *   is now rendering the real cell, so the overlay would duplicate it. True
 *   of any snapshot, however old: seeing the row is positive evidence.
 * - a known `jobId` not found in any lane's `pending`, but its design's
 *   lane exists server-side — dropped ONLY when this snapshot's fetch began
 *   after the jobId was known (`snapshotStartedAtMs` vs `jobIdKnownAtMs`).
 *   Then the absence is server truth: the job finished or was cancelled. A
 *   snapshot fetched before the row was written is simply blind to it, and
 *   acting on that silence deletes a live cell and stops the poll loop.
 * - anything else — kept; the row isn't visible yet.
 *
 * `snapshotStartedAtMs` defaults to now (a caller with no fetch timing gets
 * the old, stricter behaviour) and `nowMs` to Date.now().
 */
export function settleOptimistic(
  lanes: StudioLane[],
  entries: OptimisticEntry[],
  options: { snapshotStartedAtMs?: number; nowMs?: number } = {}
): OptimisticEntry[] {
  const nowMs = options.nowMs ?? Date.now();
  const snapshotStartedAtMs = options.snapshotStartedAtMs ?? nowMs;
  return entries.filter((entry) => {
    if (nowMs - entry.startedAt.getTime() >= STALE_OPTIMISTIC_MS) return false;
    if (entry.jobId === null) return true;
    const visiblyPending = lanes.some((lane) =>
      lane.pending.some((job) => job.jobId === entry.jobId)
    );
    if (visiblyPending) return false;
    // A snapshot that went out before the job row existed can't testify to
    // its absence.
    if (snapshotStartedAtMs < (entry.jobIdKnownAtMs ?? 0)) return true;
    const laneExists = lanes.some((lane) => lane.designId === entry.designId);
    return !laneExists;
  });
}

/**
 * How many optimistic entries are not yet visible in server lanes' pending
 * lists — the count to add to the server's own pending count for the
 * generation cap (`isAtGenerationCap`), so a cell that has already landed
 * in server lanes isn't counted twice. An entry with `jobId: null` is
 * always unseen (the server can't show it before the action returns).
 */
export function unseenOptimisticCount(
  lanes: StudioLane[],
  entries: OptimisticEntry[]
): number {
  return entries.filter((entry) => {
    if (entry.jobId === null) return true;
    return !lanes.some((lane) =>
      lane.pending.some((job) => job.jobId === entry.jobId)
    );
  }).length;
}
