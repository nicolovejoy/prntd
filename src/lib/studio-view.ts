/**
 * Client-safe display helpers for the Studio. Kept apart from studio.ts,
 * which imports drizzle + schema and must never reach the client bundle
 * (the generation-poll.ts precedent). The StudioLane/StudioPendingCell
 * import below is type-only, so it doesn't pull studio.ts's drizzle import
 * into this module's runtime — same pattern studio-client.tsx already uses.
 */
import type { StudioLane, StudioPendingCell } from "./studio";
import { STALE_OPTIMISTIC_MS } from "./generation-poll";
import { DISPLAY_TIME_ZONE } from "./display-time-zone";

/** Elapsed time on a pending cell: "0:07", "1:23". Clock skew clamps to 0. */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Lane-header recency: "just now", "14m ago", "2h ago", "1d ago", then a
 * Pacific calendar date after 30 days. The date pins its locale and zone so
 * the server render and the browser's hydration print the same string
 * (display-time-zone.ts).
 */
export function timeAgo(date: Date, nowMs: number = Date.now()): string {
  const seconds = Math.floor((nowMs - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString("en-US", { timeZone: DISPLAY_TIME_ZONE });
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
   * The trimmed composer text this submit fired with (#203). Every submit
   * has one, so the field is required. It stands in for the lane's title
   * until the server lane carries the first user chat turn — a synthetic
   * lane, or an existing lane the server hasn't titled yet, shows this
   * instead of "Untitled".
   */
  prompt: string;
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
 * The prompt to show as a lane's provisional title (#203): the EARLIEST
 * entry in the group by `startedAt` — the first words typed into that
 * conversation, matching what the server will eventually carry as its
 * first user chat turn. Null when that prompt is empty after trim, so
 * render sites fall back to "Untitled" rather than showing blank text.
 */
function earliestPrompt(group: OptimisticEntry[]): string | null {
  const earliest = group.reduce((a, b) =>
    b.startedAt.getTime() < a.startedAt.getTime() ? b : a
  );
  const trimmed = earliest.prompt.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Overlays optimistic entries onto server lanes for rendering. Pure, and
 * called on every render (not folded into lane state) so a poll's
 * `setLanes(fresh)` can never wipe a cell mid-flight — see the plan's
 * Design section.
 *
 * An entry whose designId matches a server lane is appended to that lane's
 * `pending`. A lane the server hasn't titled yet (`title: null`) takes the
 * group's earliest prompt as a provisional title (#203); a lane that
 * already has a title keeps it. An entry with no matching lane (a fresh,
 * unanchored conversation the server hasn't created yet) gets a synthetic
 * lane at index 0, titled the same way, so it's the first thing below the
 * composer on a phone-width bench. Callers are expected to pass only
 * entries `settleOptimistic` has not dropped — this function does not
 * re-check jobId visibility itself.
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
    return {
      ...lane,
      title: lane.title ?? earliestPrompt(group),
      pending: [...lane.pending, ...group.map(optimisticCell)],
    };
  });

  // Two unanchored submits in a row are two synthetic lanes, and they follow
  // the bench's own activity-desc order: the newest submit leads. A lane's
  // date is the newest of its entries, so a second submit into the same
  // not-yet-server-visible design moves it up rather than pinning it to the
  // first one's start.
  const newLanes: StudioLane[] = [...byDesign.entries()]
    .map(([designId, group]) => ({
      designId,
      title: earliestPrompt(group),
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

/** What one lane held when a submit fired (#245). */
export type LaneBaseline = {
  jobIds: string[];
  imageIds: string[];
  /** Whether the tab's server lanes had a lane for the design at all. */
  laneExisted: boolean;
};

/**
 * The pending job ids and cell image ids `designId`'s lane holds right now,
 * read from the tab's server lanes (never `applyOptimistic` output). Captured
 * when a submit fires so `judgeLostSubmit` can tell work this submit started
 * from work the lane already had. `laneExisted` separates an anchored submit,
 * whose lane is already on the bench, from an unanchored one, whose fresh
 * design id has no lane yet.
 */
export function laneBaseline(
  lanes: StudioLane[],
  designId: string
): LaneBaseline {
  const found = lanes.find((l) => l.designId === designId);
  return {
    jobIds: found ? found.pending.map((p) => p.jobId) : [],
    imageIds: found ? found.cells.map((c) => c.imageId) : [],
    laneExisted: found !== undefined,
  };
}

/**
 * Work in a lane that some other submit of this tab owns. A submit whose
 * response arrived claims both ids (`{jobId, imageId}`). Work the tab could
 * not attribute when a lost submit gave up is disowned by one id only: a
 * pending job by its `jobId`, a cell by its `imageId`.
 */
export type LaneClaim = { jobId: string | null; imageId: string | null };

export type LostSubmitVerdict =
  | { kind: "landed"; accounted: LaneClaim[] }
  | { kind: "wait" }
  | { kind: "failed"; unexplained: LaneClaim[] };

/**
 * Decides what became of a submit whose response never arrived (#245), from
 * one snapshot of the surface. Pure; the caller supplies the clock verdict as
 * `pastDeadline` and passes server lanes only, so an optimistic cell can't
 * vouch for itself.
 *
 * Evidence that the request got past the server's checks is work in the
 * submit's lane that nobody else accounts for:
 * - known jobs are the baseline's plus every claim's `jobId`; known images are
 *   the baseline's plus every claim's `imageId`;
 * - `newPending` are pending jobs not known, `newCells` are cells not known;
 * - a job that was pending when the submit fired (baseline), or that a
 *   job-only claim names, and is no longer pending may have finished into a
 *   cell whose image id nobody knows. Each such `departed` job explains one new
 *   cell. A claim that carries an `imageId` is not counted: its cell is already
 *   known, so it has nothing to explain;
 * - evidence = newPending + max(0, newCells - departed).
 *
 * "The lane exists" is not evidence. For an unanchored submit the server writes
 * the design row after quota and capacity pass but before the job row, so a
 * failure in between (the brief call throwing) leaves an empty lane. That is a
 * real failure and must read as one.
 *
 * Verdicts:
 * - The lane is absent. Anchored (`baseline.laneExisted`): `failed` now, since
 *   the lane closed or was deleted (#204) and nothing ran. Unanchored: `wait`,
 *   because the snapshot may have raced the design-row write; `failed` once
 *   past the deadline.
 * - evidence > `unresolvedOthers`: `landed`. `unresolvedOthers` counts other
 *   same-lane submits that could own that many of the new jobs or cells.
 *   `accounted` names the new pending jobs and new cells the verdict rests on
 *   (same shape as `unexplained`); the caller records them as claims, so a
 *   later lost submit in the lane can't land on the same work.
 * - Past the deadline otherwise: `failed`, with the new pending jobs and cells
 *   as `unexplained` so the caller can disown them for later decisions.
 * - Else `wait`.
 *
 * Ambiguity is biased toward `failed`: another submit's work can absorb the
 * evidence, and an unexplained new job or cell only counts once. A baseline job
 * that failed (no cell) is not a silent-loss case: it counts as departed and
 * can hide this submit's own single new cell, which reads as `wait` and then
 * `failed`, so the words come back with the failure line. Known exceptions,
 * where words can be dropped without a notice:
 * - another tab starts a job in the same lane during the window, and it reads
 *   as this submit's work (`landed`); a tab can't see another tab's submits;
 * - the accepted `after()` trade: the server's background work fails right
 *   after the job row is written, so the submit reads as landed and the sweep
 *   fails the job later.
 */
export function judgeLostSubmit(input: {
  fresh: StudioLane[];
  designId: string;
  baseline: LaneBaseline;
  claims?: Iterable<LaneClaim>;
  unresolvedOthers?: number;
  pastDeadline: boolean;
}): LostSubmitVerdict {
  const { fresh, designId, baseline, pastDeadline } = input;
  const unresolvedOthers = input.unresolvedOthers ?? 0;
  const found = fresh.find((l) => l.designId === designId);
  if (!found) {
    if (baseline.laneExisted || pastDeadline) {
      return { kind: "failed", unexplained: [] };
    }
    return { kind: "wait" };
  }

  const claims = [...(input.claims ?? [])];
  const knownJobs = new Set(baseline.jobIds);
  const knownImages = new Set(baseline.imageIds);
  const jobsWithCell = new Set<string>();
  const jobOnlyClaims: string[] = [];
  for (const c of claims) {
    if (c.jobId !== null) {
      knownJobs.add(c.jobId);
      if (c.imageId !== null) jobsWithCell.add(c.jobId);
      else jobOnlyClaims.push(c.jobId);
    }
    if (c.imageId !== null) knownImages.add(c.imageId);
  }

  const pendingIds = new Set(found.pending.map((p) => p.jobId));
  const newPending = found.pending.filter((p) => !knownJobs.has(p.jobId));
  const newCells = found.cells.filter((c) => !knownImages.has(c.imageId));
  const departedJobs = new Set(
    [...baseline.jobIds, ...jobOnlyClaims].filter(
      (id) => !jobsWithCell.has(id) && !pendingIds.has(id)
    )
  );
  const evidence =
    newPending.length + Math.max(0, newCells.length - departedJobs.size);

  const newPendingClaims = newPending.map(
    (p): LaneClaim => ({ jobId: p.jobId, imageId: null })
  );
  const newCellClaims = newCells.map(
    (c): LaneClaim => ({ jobId: null, imageId: c.imageId })
  );
  if (evidence > unresolvedOthers) {
    return {
      kind: "landed",
      accounted: [...newPendingClaims, ...newCellClaims],
    };
  }
  if (!pastDeadline) return { kind: "wait" };
  return {
    kind: "failed",
    unexplained: [...newPendingClaims, ...newCellClaims],
  };
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

/**
 * Whether a caught Server Function error was thrown by the function itself.
 * React's Flight client sets a string `digest` on the errors it rebuilds from
 * a server-side throw. A response that never arrived (a `TypeError` from
 * fetch, a cut stream, a 504) has none. `generateDesign` throws only before
 * its job row exists, so a digest means nothing was started (#245).
 */
export function isServerActionError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    typeof (err as { digest?: unknown }).digest === "string"
  );
}
