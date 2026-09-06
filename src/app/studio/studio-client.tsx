"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import {
  cancelGeneration,
  closeConversation,
  generateDesign,
} from "@/app/design/actions";
import { deleteDesign } from "@/app/designs/actions";
import { DELETE_CONVERSATION_CONFIRM } from "@/lib/design-view";
import {
  GENERATION_CAP,
  isAtGenerationCap,
  isPollHalted,
  nextPollDelayMs,
} from "@/lib/generation-poll";
import {
  applyOptimistic,
  bulkDeleteConfirm,
  bulkDeleteSkipNotice,
  formatElapsed,
  settleOptimistic,
  timeAgo,
  unseenOptimisticCount,
} from "@/lib/studio-view";
import type { OptimisticEntry } from "@/lib/studio-view";
import type { StudioLane } from "@/lib/studio";
import { deleteConversations, getStudioLanes } from "./actions";

/**
 * /studio — the working surface (studio-plan slices 2+3): lanes render, a
 * running generation shows as a pending cell with elapsed time, and one
 * docked composer is the only submit control.
 *
 * Selection is the interaction model: tapping a cell anchors it, the composer
 * carries a chip with a crop of the anchored image, and Generate then edits
 * exactly that image. Dismissing the chip clears the anchor and the same box
 * starts a NEW conversation. Three decisions are settled (plan, slice 3): the
 * composer stays docked, the anchor never advances to a result on its own,
 * and a lane opens scrolled to its newest image.
 *
 * Polling: while any lane has a pending cell, the whole read model is
 * re-fetched on the generation-poll schedule (fast, then slow). One request
 * per tick covers every lane, catches generations started in another tab,
 * and lets the server's lazy sweep clear overdue rows — which is why the
 * poll target is the surface itself rather than per-design getDesignJobs
 * calls (a fan-out that couldn't discover new lanes at all).
 *
 * Optimistic cells (#187): a submit puts its pending cell (and, unanchored, a
 * lane at the top of the bench) on screen immediately, held in `optimistic`
 * beside the lanes and overlaid at render time by applyOptimistic. Keeping it
 * out of `lanes` is what makes a poll's wholesale setLanes safe; each refresh
 * then retires the entries server truth can account for (settleOptimistic).
 * The cap counts only the entries the server cannot see yet, and Cancel waits
 * for the real jobId.
 *
 * The anchor lives OUTSIDE the lane state on purpose: a poll refresh replaces
 * `lanes` wholesale with server truth, and the anchor (plus the draft text)
 * must survive that landing mid-typing. It's cleared only when its image
 * genuinely leaves the surface (the conversation closed or was deleted).
 *
 * Select mode (#189): "Select" in the title row turns each lane header into a
 * checkbox row and swaps the composer for a bar with the count, Select all,
 * Delete and Done. While selecting, a tap anywhere on a lane — header or
 * cell — toggles that lane; anchoring is off, so one gesture means one thing.
 * A lane with a running generation can't be selected (its per-lane Close and
 * Delete are hidden for the same reason). Escape leaves select mode. The
 * selection is a Set of design ids kept beside the lanes, so a poll landing
 * mid-selection keeps it; ids whose lane left the surface are dropped.
 */

type Anchor = {
  designId: string;
  imageId: string;
  imageUrl: string;
  title: string | null;
};

/** Clean Label: names the state, says what to do, stops. */
const AT_CAP_COPY = `${GENERATION_CAP} generating — wait for one to finish.`;
const GENERATE_FAILED_COPY = "Something went wrong. Try again.";

export function StudioClient({ initialLanes }: { initialLanes: StudioLane[] }) {
  const [lanes, setLanes] = useState<StudioLane[]>(initialLanes);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [text, setText] = useState("");
  // Submits this tab has fired that server lanes may not show yet (#187):
  // the pending cell has to appear the instant Generate is pressed, not a
  // round trip later. Kept BESIDE the lanes and overlaid at render time, so
  // a poll's setLanes(fresh) can never wipe a cell mid-flight.
  const [optimistic, setOptimistic] = useState<OptimisticEntry[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [pollErrors, setPollErrors] = useState(0);
  // Bumped after every completed poll so the timer effect re-arms.
  const [pollNonce, setPollNonce] = useState(0);
  // Ticks once a second while something is pending, for the elapsed labels.
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  // The synthetic lane an unanchored submit just created. It goes to the top
  // of the bench, which is off-screen if the user had scrolled down, so the
  // lane scrolls itself into view when it mounts (phone-first: the whole
  // point of #187 is seeing that the tap registered).
  const [revealDesignId, setRevealDesignId] = useState<string | null>(null);

  const polling = useRef(false);
  const pollStartedAt = useRef<number | null>(null);

  // What the bench renders: server truth plus this tab's own overlay.
  const renderedLanes = applyOptimistic(lanes, optimistic);
  // Server pending drives polling and the cap's first argument; the second is
  // only the overlay the server cannot see yet, so a cell that has landed in
  // server lanes is never counted twice.
  const serverPendingCount = lanes.reduce((n, l) => n + l.pending.length, 0);
  const renderedPendingCount = renderedLanes.reduce(
    (n, l) => n + l.pending.length,
    0
  );
  const atCap = isAtGenerationCap(
    serverPendingCount,
    unseenOptimisticCount(lanes, optimistic)
  );
  // Cancel needs a real job row; an entry whose action hasn't returned yet
  // renders its cell without the control (its cell is keyed on the localId).
  const unresolvedCellIds = new Set(
    optimistic.filter((e) => e.jobId === null).map((e) => e.localId)
  );

  const pollOnce = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    // When THIS fetch went out. A poll can straddle the job-row write, and a
    // snapshot taken before it can't testify that the job is gone.
    const snapshotStartedAtMs = Date.now();
    try {
      const fresh = await getStudioLanes();
      // Server truth replaces the lanes — and only the lanes. The anchor and
      // the draft are the local state this refresh must not clobber; both
      // live in their own useState and are untouched here.
      setLanes(fresh);
      // Drop the overlay entries this refresh has made redundant — server
      // truth wins for everything the server can now see.
      setOptimistic((entries) =>
        settleOptimistic(fresh, entries, { snapshotStartedAtMs })
      );
      setPollErrors(0);
    } catch {
      // Transient transport failure: keep what's rendered, spend budget.
      setPollErrors((n) => n + 1);
    } finally {
      polling.current = false;
      setPollNonce((n) => n + 1);
    }
  }, []);

  // Poll only while a generation is in flight; stop entirely otherwise.
  // Halted is a stop, not a give-up — the wake handler below clears the
  // budget, so the loop resumes when the user looks at the tab again.
  // An overlay entry keeps the loop alive too, so polling starts the instant
  // a cell appears — harmless if the job row isn't written yet.
  const active =
    (serverPendingCount > 0 || optimistic.length > 0) &&
    !isPollHalted(pollErrors);
  useEffect(() => {
    if (!active) {
      pollStartedAt.current = null;
      return;
    }
    if (pollStartedAt.current === null) pollStartedAt.current = Date.now();
    const delay = nextPollDelayMs(Date.now() - pollStartedAt.current);
    const timer = setTimeout(() => void pollOnce(), delay);
    return () => clearTimeout(timer);
  }, [active, pollNonce, pollOnce]);

  // Leave-and-return is the main phone journey, and a backgrounded tab's
  // timers are throttled or frozen — the wake itself fetches. Unconditional
  // (not gated on pendingCount): coming back should also pick up work that
  // was started elsewhere while this tab slept.
  useEffect(() => {
    function onWake() {
      if (document.visibilityState !== "visible") return;
      setPollErrors(0);
      void pollOnce();
    }
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    return () => {
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
    };
  }, [pollOnce]);

  // Elapsed labels tick locally between polls.
  useEffect(() => {
    if (renderedPendingCount === 0) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [renderedPendingCount]);

  // The anchor survives every refresh EXCEPT its image genuinely leaving the
  // surface (conversation closed in another tab, design deleted). Then the
  // chip clears rather than pointing at something no longer on screen — an
  // anchor nobody can see is exactly the ambiguity the model can't afford.
  useEffect(() => {
    setAnchor((a) =>
      a && !lanes.some((l) => l.cells.some((c) => c.imageId === a.imageId))
        ? null
        : a
    );
  }, [lanes]);

  // Selection follows the lanes: an id whose lane left (deleted elsewhere,
  // closed in another tab, or now generating) can't stay selected, or Delete
  // would act on something not on screen.
  const selectableIds = renderedLanes
    .filter((l) => l.pending.length === 0)
    .map((l) => l.designId);
  useEffect(() => {
    const live = new Set(selectableIds);
    setSelected((s) => {
      if ([...s].every((id) => live.has(id))) return s;
      return new Set([...s].filter((id) => live.has(id)));
    });
    // selectableIds is derived from lanes + the overlay; those are the real
    // dependencies (the array itself is rebuilt every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lanes, optimistic]);

  useEffect(() => {
    if (!selectMode) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") exitSelectMode();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selectMode]);

  // Put back entries an optimistic removal took out, without touching
  // anything that arrived meanwhile (a Generate fired during the round trip).
  function restoreOptimistic(removed: OptimisticEntry[]) {
    if (removed.length === 0) return;
    setOptimistic((es) => [
      ...es,
      ...removed.filter((r) => !es.some((e) => e.localId === r.localId)),
    ]);
  }

  function enterSelectMode() {
    setSelectMode(true);
    setSelected(new Set());
    setAnchor(null);
    setNotice(null);
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
  }

  function toggleSelected(designId: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(designId)) next.delete(designId);
      else next.add(designId);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(selectableIds));
  }

  // One confirm, then one action for the whole selection. Optimistic: the
  // selected lanes leave now; the ones the server kept come back, with a
  // plain line saying why. Then a refetch, so what's on screen is server
  // truth and not the client's guess about a partial failure.
  async function bulkDelete() {
    const ids = [...selected];
    if (ids.length === 0 || bulkDeleting) return;
    if (!window.confirm(bulkDeleteConfirm(ids.length))) return;
    const prev = lanes;
    // Read the entries this delete removes, but never write the array back
    // wholesale: a Generate fired during the round trip adds its own entry,
    // and restoring a snapshot would erase it.
    const chosen = new Set(ids);
    const removedOptimistic = optimistic.filter((e) => chosen.has(e.designId));
    setBulkDeleting(true);
    setLanes((ls) => ls.filter((l) => !chosen.has(l.designId)));
    setOptimistic((es) => es.filter((e) => !chosen.has(e.designId)));
    try {
      const result = await deleteConversations(ids);
      const gone = new Set(result.deleted);
      setLanes(prev.filter((l) => !gone.has(l.designId)));
      setNotice(bulkDeleteSkipNotice(result.skipped));
      exitSelectMode();
      await pollOnce();
    } catch {
      setLanes(prev);
      restoreOptimistic(removedOptimistic);
      setNotice("Couldn't delete those designs. Try again.");
    } finally {
      setBulkDeleting(false);
    }
  }

  function toggleAnchor(lane: StudioLane, cell: StudioLane["cells"][number]) {
    if (selectMode) {
      if (lane.pending.length === 0) toggleSelected(lane.designId);
      return;
    }
    setAnchor((a) =>
      a?.imageId === cell.imageId
        ? null
        : {
            designId: lane.designId,
            imageId: cell.imageId,
            imageUrl: cell.imageUrl,
            title: lane.title,
          }
    );
  }

  async function submit() {
    const trimmed = text.trim();
    // Only the cap blocks — an in-flight submit does not: firing the next
    // idea without waiting for the last one's round trip is the normal case,
    // so the box clears now and each submit runs concurrently up to the cap.
    if (!trimmed || atCap) return;
    const submitAnchor = anchor;
    setText("");
    setNotice(null);
    // No anchor → a fresh conversation: generateDesign creates the design row
    // for an unseen id, so the client mints one and the lane appears on the
    // refetch below.
    const targetDesignId = submitAnchor?.designId ?? crypto.randomUUID();
    // The cell goes up now (#187). An anchored submit appends to that lane; an
    // unanchored one synthesizes a lane at the top of the bench, which on a
    // phone is the first thing above the composer.
    const localId = crypto.randomUUID();
    if (!submitAnchor) setRevealDesignId(targetDesignId);
    setOptimistic((entries) => [
      ...entries,
      {
        localId,
        designId: targetDesignId,
        anchorImageId: submitAnchor?.imageId ?? null,
        startedAt: new Date(),
        jobId: null,
      },
    ]);
    try {
      const result = await generateDesign(
        targetDesignId,
        trimmed,
        submitAnchor ? { anchorImageId: submitAnchor.imageId } : {}
      );
      if (result.kind === "queued") {
        // Now the cell has a real job behind it: Cancel appears, and the next
        // poll that lists the job retires the overlay entry.
        setOptimistic((entries) =>
          entries.map((e) =>
            e.localId === localId
              ? { ...e, jobId: result.jobId, jobIdKnownAtMs: Date.now() }
              : e
          )
        );
        // The anchor deliberately stays put (plan, slice 3): successive
        // instructions fan out from the image the user chose; building on a
        // result means tapping it.
        await pollOnce();
      } else {
        // The turn didn't run, so the cell it promised has to go.
        setOptimistic((entries) => entries.filter((e) => e.localId !== localId));
        setNotice(result.message);
        // Give the words back if the box is still empty — the turn didn't run.
        setText((t) => t || trimmed);
      }
    } catch {
      setOptimistic((entries) => entries.filter((e) => e.localId !== localId));
      setNotice(GENERATE_FAILED_COPY);
      setText((t) => t || trimmed);
    }
  }

  // Clear a lane by hand — Nico's "dead design" case. Close is the existing
  // reversible verb (closed_at; Reopen lives on /designs and /design), so
  // this is a new caller of an existing state, same as slice 4's auto-archive
  // will be. Optimistic: the lane leaves now, comes back on error.
  async function closeLane(lane: StudioLane) {
    const prev = lanes;
    const removedOptimistic = optimistic.filter(
      (e) => e.designId === lane.designId
    );
    setLanes((ls) => ls.filter((l) => l.designId !== lane.designId));
    // A lane this tab removes takes its own overlay cells with it; otherwise
    // the closed conversation would come straight back as a synthetic lane.
    setOptimistic((es) => es.filter((e) => e.designId !== lane.designId));
    setAnchor((a) => (a?.designId === lane.designId ? null : a));
    try {
      await closeConversation(lane.designId);
    } catch {
      setLanes(prev);
      restoreOptimistic(removedOptimistic);
      setNotice("Couldn't close that design. Try again.");
    }
  }

  // Cancel one pending generation (#187): the result is discarded server-side
  // when the render comes back, so the cell can leave now. The next poll
  // agrees — a cancel-requested job is already out of the lane's `pending`.
  // The slot itself frees when the render returns, so a submit in the
  // meantime can still meet the server's cap; that refusal is shown as-is.
  async function cancelJob(lane: StudioLane, jobId: string) {
    // Cancel is offered only once the jobId is real, so an entry matching it
    // is one whose cell is still an overlay — it leaves with the server cell.
    setOptimistic((entries) => entries.filter((e) => e.jobId !== jobId));
    setLanes((ls) =>
      ls.map((l) =>
        l.designId === lane.designId
          ? { ...l, pending: l.pending.filter((job) => job.jobId !== jobId) }
          : l
      )
    );
    try {
      const ok = await cancelGeneration(jobId);
      // False = the image landed before the cancel (it stays). The cell we
      // just removed was the only thing keeping the poll loop alive, so fetch
      // once now rather than leaving the landed cell hidden until a focus.
      if (!ok) void pollOnce();
    } catch {
      // Nothing to recover: the row either settled first or was never ours.
    }
  }

  // Delete the conversation outright. Close parks a design; this is the only
  // route to removing one whose thread never produced an image — it has no
  // cell in My Designs, so the image detail page cannot offer it (slice 5
  // review, F1). Same action, same honest copy.
  async function deleteLane(lane: StudioLane) {
    if (!window.confirm(DELETE_CONVERSATION_CONFIRM)) return;
    const prev = lanes;
    const removedOptimistic = optimistic.filter(
      (e) => e.designId === lane.designId
    );
    setLanes((ls) => ls.filter((l) => l.designId !== lane.designId));
    setOptimistic((es) => es.filter((e) => e.designId !== lane.designId));
    setAnchor((a) => (a?.designId === lane.designId ? null : a));
    try {
      // Expected refusals come back as { error } — a thrown server-action
      // message is only a digest in prod.
      const result = await deleteDesign(lane.designId);
      if (result?.error) {
        setLanes(prev);
        restoreOptimistic(removedOptimistic);
        setNotice(result.error);
      }
    } catch {
      setLanes(prev);
      restoreOptimistic(removedOptimistic);
      setNotice("Couldn't delete that design. Try again.");
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 px-4 sm:px-6 py-8 pb-40 max-w-4xl mx-auto w-full">
        <div className="flex items-baseline justify-between gap-3 mb-6">
          <h1 className="text-xl sm:text-2xl font-bold">Studio</h1>
          <div className="flex items-baseline gap-4">
            {/* Only when there is something to select; in select mode the
                bottom bar's Done is the way out, so the control hides. */}
            {renderedLanes.length > 0 && !selectMode && (
              <button
                type="button"
                onClick={enterSelectMode}
                className="text-sm text-text-muted hover:text-foreground transition-colors"
                data-testid="select-mode"
              >
                Select
              </button>
            )}
            {/* Quiet by design: the archive is a retrieval door, not a
                destination. Lanes leave on their own after three days
                (studio-plan slice 4) and this is where they land. */}
            <Link
              href="/studio/archive"
              className="text-sm text-text-muted hover:text-foreground transition-colors"
            >
              Archive
            </Link>
          </div>
        </div>

        {renderedLanes.length === 0 ? (
          // Also the first thing a buy-only account sees, since / redirects
          // signed-in users here (nav re-map, 2026-09-01) — so the empty
          // state offers the Shop, not just the composer.
          <div className="text-center py-16 space-y-4">
            <p className="text-text-faint text-lg">No open designs.</p>
            <Link
              href="/prints"
              className="inline-block text-sm text-text-muted underline hover:text-foreground transition-colors"
            >
              Browse the Shop
            </Link>
          </div>
        ) : (
          renderedLanes.map((lane) => (
            <Lane
              key={lane.designId}
              lane={lane}
              nowMs={nowMs}
              anchoredImageId={anchor?.imageId ?? null}
              selectMode={selectMode}
              selected={selected.has(lane.designId)}
              onTapCell={toggleAnchor}
              onToggleSelect={toggleSelected}
              onClose={closeLane}
              onDelete={deleteLane}
              onCancel={cancelJob}
              unresolvedCellIds={unresolvedCellIds}
              reveal={lane.designId === revealDesignId}
            />
          ))
        )}
      </main>

      {selectMode ? (
        <div
          className="fixed bottom-0 inset-x-0 border-t border-border bg-surface px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
          data-testid="select-bar"
        >
          <div className="max-w-4xl mx-auto space-y-2">
            {notice && <p className="text-xs text-text-muted">{notice}</p>}
            <div className="flex items-center gap-3">
              <span
                className="text-sm tabular-nums min-w-0 flex-1 truncate"
                data-testid="selected-count"
              >
                {selected.size} selected
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={selectAll}
                disabled={
                  selectableIds.length === 0 ||
                  selected.size === selectableIds.length
                }
                className="min-h-11"
                data-testid="select-all"
              >
                Select all
              </Button>
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={() => void bulkDelete()}
                disabled={selected.size === 0 || bulkDeleting}
                className="min-h-11"
                data-testid="bulk-delete"
              >
                Delete
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={exitSelectMode}
                disabled={bulkDeleting}
                className="min-h-11"
                data-testid="select-done"
              >
                Done
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="fixed bottom-0 inset-x-0 border-t border-border bg-surface px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <div className="max-w-4xl mx-auto space-y-2">
            {anchor && (
              <div
                className="flex items-center gap-2 min-w-0"
                data-testid="anchor-chip"
              >
                <div className="relative w-8 h-8 rounded overflow-hidden bg-checkerboard shrink-0 border border-border">
                  <Image
                    src={anchor.imageUrl}
                    alt=""
                    fill
                    sizes="32px"
                    className="object-cover"
                  />
                </div>
                <span className="text-xs text-text-muted truncate">
                  Editing · {anchor.title ?? "Untitled"}
                </span>
                <button
                  type="button"
                  aria-label="Clear anchor"
                  onClick={() => setAnchor(null)}
                  className="shrink-0 px-1 text-text-muted hover:text-foreground"
                >
                  ✕
                </button>
              </div>
            )}
            {atCap && (
              <p className="text-xs text-text-muted" data-testid="cap-notice">
                {AT_CAP_COPY}
              </p>
            )}
            {notice && <p className="text-xs text-text-muted">{notice}</p>}
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <input
                type="text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={
                  anchor ? "Describe the change" : "Describe a design"
                }
                className="flex-1 px-3 py-2 bg-surface border border-border rounded-md text-white placeholder:text-text-faint focus:border-border-hover focus:outline-none"
                data-testid="studio-composer"
              />
              <Button
                type="submit"
                disabled={!text.trim() || atCap}
                data-testid="studio-generate"
              >
                Generate
              </Button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function Lane({
  lane,
  nowMs,
  anchoredImageId,
  selectMode,
  selected,
  onTapCell,
  onToggleSelect,
  onClose,
  onDelete,
  onCancel,
  unresolvedCellIds,
  reveal,
}: {
  lane: StudioLane;
  nowMs: number;
  anchoredImageId: string | null;
  selectMode: boolean;
  selected: boolean;
  onTapCell: (lane: StudioLane, cell: StudioLane["cells"][number]) => void;
  onToggleSelect: (designId: string) => void;
  onClose: (lane: StudioLane) => void;
  onDelete: (lane: StudioLane) => void;
  onCancel: (lane: StudioLane, jobId: string) => void;
  /** Overlay cells whose generateDesign call hasn't returned a jobId yet. */
  unresolvedCellIds: Set<string>;
  /** Newly synthesized by an unanchored submit — scroll it into view. */
  reveal: boolean;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const cellCount = lane.cells.length + lane.pending.length;
  const generating = lane.pending.length > 0;
  // Selectable = nothing running. Deleting under a render would land the
  // image in a thread that just left the bench; the checkbox says why.
  const selectable = selectMode && !generating;

  // Land on the newest work: cells run oldest → newest, so a lane wider than
  // the phone opens (and stays) scrolled to its right edge as results arrive.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [cellCount]);

  // A lane that appears at the top of the bench on submit is above the
  // viewport whenever the user had scrolled down; bring it to them.
  useEffect(() => {
    if (reveal) sectionRef.current?.scrollIntoView({ block: "start" });
  }, [reveal]);

  return (
    <section
      ref={sectionRef}
      className="mb-8"
      data-testid="studio-lane"
      data-selected={selectMode ? selected : undefined}
    >
      <div
        className={`flex items-center justify-between gap-3 mb-2 ${
          selectable ? "cursor-pointer" : ""
        }`}
        onClick={selectable ? () => onToggleSelect(lane.designId) : undefined}
      >
        {selectMode && (
          // A real checkbox for the a11y tree, sized to a 44px target. The
          // header row toggles too, so the box is the marker, not the only
          // place to tap.
          <label
            className={`flex items-center justify-center shrink-0 w-11 h-11 -ml-2 ${
              generating ? "opacity-30" : "cursor-pointer"
            }`}
            onClick={(e) => e.stopPropagation()}
            title={generating ? "Generating" : undefined}
          >
            <input
              type="checkbox"
              checked={selected}
              disabled={generating}
              onChange={() => onToggleSelect(lane.designId)}
              aria-label={`Select ${lane.title ?? "Untitled"}`}
              className="w-5 h-5 accent-accent"
              data-testid="lane-checkbox"
            />
          </label>
        )}
        {selectMode ? (
          <h2 className="min-w-0 flex-1 text-sm font-medium truncate">
            {lane.title ?? "Untitled"}
          </h2>
        ) : (
          <Link
            href={`/design?id=${lane.designId}`}
            className="min-w-0 flex-1 hover:underline"
          >
            <h2 className="text-sm font-medium truncate">
              {lane.title ?? "Untitled"}
            </h2>
          </Link>
        )}
        <span className="text-xs text-text-faint shrink-0">
          {selectMode && generating
            ? "Generating"
            : timeAgo(lane.lastActiveAt, nowMs)}
        </span>
        {/* Both absent while generating: closing or deleting mid-render would
            land the image in a thread that just vanished from the bench. And
            absent in select mode: the bar's Delete is the one verb there. */}
        {!generating && !selectMode && (
          <>
            <button
              type="button"
              onClick={() => onClose(lane)}
              className="shrink-0 text-xs text-text-faint hover:text-foreground"
              data-testid="studio-close-lane"
            >
              Close
            </button>
            <button
              type="button"
              onClick={() => onDelete(lane)}
              className="shrink-0 text-xs text-text-faint hover:text-foreground"
              data-testid="studio-delete-lane"
            >
              Delete
            </button>
          </>
        )}
      </div>

      <div ref={scrollRef} className="flex gap-2 overflow-x-auto pb-1">
        {lane.cells.map((cell) => {
          const anchored = cell.imageId === anchoredImageId;
          return (
            <button
              key={cell.imageId}
              type="button"
              data-testid="studio-cell"
              aria-pressed={anchored}
              onClick={() => {
                onTapCell(lane, cell);
                // Anchoring scrolls its lane into view (plan, slice 3): the
                // keyboard takes half the phone, and the lane being edited
                // should survive that.
                sectionRef.current?.scrollIntoView({ block: "nearest" });
              }}
              className={`relative shrink-0 w-28 h-28 rounded-md overflow-hidden bg-checkerboard ${
                anchored
                  ? "ring-2 ring-accent ring-offset-2 ring-offset-background"
                  : cell.isPrimary
                    ? "border-2 border-accent"
                    : "border border-border"
              }`}
            >
              <Image
                src={cell.imageUrl}
                alt=""
                fill
                sizes="112px"
                className="object-contain"
              />
              {cell.isPrimary && <span className="sr-only">Primary</span>}
              {anchored && <span className="sr-only">Editing</span>}
            </button>
          );
        })}

        {lane.pending.map((job) => {
          // No job row behind an overlay cell until generateDesign returns,
          // so Cancel has nothing to act on yet.
          const unresolved = unresolvedCellIds.has(job.jobId);
          return (
            <div
              key={job.jobId}
              data-testid="studio-pending-cell"
              className="shrink-0 w-28 h-28 rounded-md border border-dashed border-border bg-surface flex flex-col items-center justify-center gap-1"
            >
              <span className="text-xs text-text-muted animate-pulse">
                Generating…
              </span>
              <span className="text-xs text-text-faint tabular-nums">
                {formatElapsed(nowMs - job.startedAt.getTime())}
              </span>
              {/* The space is reserved from the start: the control renders
                  inert and invisible until the jobId lands, so the label and
                  elapsed time don't shift under the user when it appears. */}
              <button
                type="button"
                disabled={unresolved}
                aria-hidden={unresolved || undefined}
                tabIndex={unresolved ? -1 : undefined}
                onClick={
                  unresolved ? undefined : () => onCancel(lane, job.jobId)
                }
                className={`text-xs text-text-faint hover:text-foreground min-h-[44px] px-3 ${
                  unresolved ? "invisible" : ""
                }`}
                data-testid={
                  unresolved
                    ? "cancel-generation-placeholder"
                    : "cancel-generation"
                }
              >
                Cancel
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
