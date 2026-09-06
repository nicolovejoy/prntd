/**
 * Client-safe display helpers for the Studio. Kept apart from studio.ts,
 * which imports drizzle + schema and must never reach the client bundle
 * (the generation-poll.ts precedent). The StudioLane/StudioPendingCell
 * import below is type-only, so it doesn't pull studio.ts's drizzle import
 * into this module's runtime — same pattern studio-client.tsx already uses.
 */
import type { StudioLane, StudioPendingCell } from "./studio";

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

  const newLanes: StudioLane[] = [...byDesign.entries()].map(
    ([designId, group]) => ({
      designId,
      title: null,
      lastActiveAt: group[0].startedAt,
      cells: [],
      pending: group.map(optimisticCell),
    })
  );

  return [...newLanes, ...merged];
}

/**
 * Which optimistic entries still need to be kept in local state after a
 * fresh set of server lanes lands. Plan's resolution rule (Design section):
 *
 * - `jobId: null` (the generateDesign call hasn't returned yet) — always
 *   kept; the server has nothing to say about it yet.
 * - a known `jobId` found in some lane's `pending` — dropped; the server
 *   is now rendering the real cell, so the overlay would duplicate it.
 * - a known `jobId` not found in any lane's `pending`, but its design's
 *   lane exists server-side — dropped; the job already finished or was
 *   cancelled (server truth), so there's nothing left to overlay.
 * - a known `jobId` not found anywhere, and its design's lane doesn't
 *   exist server-side yet — kept; the row isn't visible yet (a poll raced
 *   ahead of the write, or the design itself hasn't been created yet).
 */
export function settleOptimistic(
  lanes: StudioLane[],
  entries: OptimisticEntry[]
): OptimisticEntry[] {
  return entries.filter((entry) => {
    if (entry.jobId === null) return true;
    const visiblyPending = lanes.some((lane) =>
      lane.pending.some((job) => job.jobId === entry.jobId)
    );
    if (visiblyPending) return false;
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
