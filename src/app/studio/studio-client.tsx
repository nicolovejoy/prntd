"use client";

import Image from "next/image";
import Link from "next/link";
import {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { MouseEvent as ReactMouseEvent, RefObject } from "react";
import { Button, EmptyState, useConfirm } from "@/components/ui";
import {
  cancelGeneration,
  closeConversation,
  generateDesign,
} from "@/app/design/actions";
import { deleteDesign } from "@/app/designs/actions";
import {
  DELETE_CONVERSATION_CONSEQUENCE,
  DELETE_CONVERSATION_TITLE,
} from "@/lib/design-view";
import {
  GENERATION_CAP,
  isAtGenerationCap,
  isPollHalted,
  nextPollDelayMs,
  STALE_OPTIMISTIC_MS,
} from "@/lib/generation-poll";
import {
  isServerActionError,
  judgeLostSubmit,
  LOST_SUBMIT_LOOKUP_INTERVAL_MS,
  LOST_SUBMIT_LOOKUP_TIMEOUT_MS,
  LOST_SUBMIT_WINDOW_MS,
  type LostSubmitLookup,
} from "@/lib/lost-submit";
import { withTimeout } from "@/lib/timeout";
import { wellClass, wellForLuminance } from "@/lib/artwork-well";
import {
  applyOptimistic,
  bulkDeleteConsequence,
  bulkDeleteSkipNotice,
  bulkDeleteTitle,
  formatElapsed,
  settleOptimistic,
  timeAgo,
  unseenOptimisticCount,
} from "@/lib/studio-view";
import type { OptimisticEntry } from "@/lib/studio-view";
import type { StudioLane } from "@/lib/studio";
import {
  BENCH_HREF,
  focusHref,
  laneStageHref,
  newestUnseenCell,
  parseFocus,
  resolveFocus,
  type StudioFocus,
} from "@/lib/studio-focus";
import { deleteConversations, getGenerationJobStatus, getStudioLanes } from "./actions";
import { FocusedStage } from "./focused-stage";
import { GuestKeepLine } from "./guest-keep-line";

/**
 * /studio — the working surface (studio-plan slices 2+3): lanes render, a
 * running generation shows as a pending cell with elapsed time, and one
 * composer is the only submit control (at the top of the bench, under the
 * image on the focused stage).
 *
 * Selection is the interaction model. A cell tap opens the focused stage
 * (#188 slice 4, ./focused-stage): that result large, the same composer
 * under it, the conversation's other results as a strip. Being on the stage
 * is what anchors: the shown image is the anchor, the composer carries a
 * chip with a crop of it, and Generate edits exactly that image. The stage's
 * address is the URL (?conversation=&image=), so Back and reload work.
 * On the stage an accepted Generate does NOT spend the anchor — the next
 * line is another change to the same image — and when a result lands in
 * its lane while the stage still shows the image that edit was made from,
 * the stage moves to it. Dismissing the
 * chip makes the same box start a NEW conversation, which lives on the
 * bench, so an unanchored Generate leaves the stage for it when submitted. On the
 * bench the anchor is plain state that nothing sets except a refused
 * submit's give-back (below), and an accepted Generate there spends it
 * (Nico, 2026-10-01, #276: a new idea typed after an edit landed in the old
 * lane). A refused turn hands its words back with the anchor state it was
 * sent with (chip or none), for a retry of the same thing.
 * Decisions settled (plan, slice 3; #188 slice 4): the composer sits at the
 * top of the bench (Paper mock, #188 slice 3), a lane opens scrolled to its
 * newest image, and the bench has no lightbox — tapping the stage's large
 * image does nothing in this slice.
 *
 * Polling: while any lane has a pending cell, the whole read model is
 * re-fetched on the generation-poll schedule (fast, then slow). One request
 * per tick covers every lane, catches generations started in another tab,
 * and lets the server's lazy sweep clear overdue rows (#204: the sweep now
 * runs via `after()`, after the response, so it's the FOLLOWING poll that
 * shows its effect, not the one that triggered it) — which is why the poll
 * target is the surface itself rather than per-design getDesignJobs calls
 * (a fan-out that couldn't discover new lanes at all).
 *
 * Optimistic cells (#187): a submit puts its pending cell (and, unanchored, a
 * lane at the top of the bench) on screen immediately, held in `optimistic`
 * beside the lanes and overlaid at render time by applyOptimistic. Keeping it
 * out of `lanes` is what makes a poll's wholesale setLanes safe; each refresh
 * then retires the entries server truth can account for (settleOptimistic).
 * The cap counts only the entries the server cannot see yet, and Cancel waits
 * for the real jobId.
 *
 * A lost Generate response (#245): `generateDesign` can accept a request,
 * write its job row, and start the render, while the response itself never
 * reaches this tab (a transport failure — prod's `net::ERR_NETWORK_CHANGED`).
 * The old catch treated every throw as a genuine refusal, which duplicated
 * the design on retry. Each submit now mints its own job id up front
 * (`clientJobId`, sent as `generateDesign`'s `jobId`) so a lost response can
 * be told apart from a real failure: an error with a string `digest` is
 * React's Flight client marking an actual server-side throw (#204, an
 * anchored lane closed underneath the tap) and fails at once; anything else
 * starts a reconcile loop that looks the exact id up
 * (`getGenerationJobStatus`) until it lands, fails, is cancelled, or a 60s
 * window (`LOST_SUBMIT_WINDOW_MS`, comfortably past the 45s brief bound
 * behind it) runs out. See `src/lib/lost-submit.ts` for the pure rules this
 * leans on, in particular why only a lookup CALLED after the deadline may
 * report failure — and, distinctly, why a lookup that ERRORS past the
 * deadline (the phone briefly has no network, not the server saying "no such
 * row") must not: it waits instead for a second, later backstop
 * (`STALE_OPTIMISTIC_MS` after the submit) before giving up — and even once
 * that backstop is behind it, only a run of `LOST_SUBMIT_ERROR_ATTEMPTS`
 * CONSECUTIVE errors counts as failure (third review, 2026-09-27; measured in
 * attempts, not elapsed time — a wall-clock streak lets a device freeze
 * inflate it for free, since sleep makes no attempts but the clock still
 * runs): a backstop anchored purely on the submit's own clock can already be
 * behind a device woken from a long background freeze, so its very first
 * post-wake lookup must get the same grace a fresh submit gets, not an
 * instant verdict.
 *
 * The anchor lives OUTSIDE the lane state on purpose: a poll refresh replaces
 * `lanes` wholesale with server truth, and the anchor (plus the draft text)
 * must survive that landing mid-typing. On the stage it is derived from the
 * focus, which is its own state; the chip's control there sets
 * `anchorCleared` until the focus changes. The bench anchor is cleared by
 * the chip's own control, by an accepted bench Generate, and when its image
 * genuinely leaves the surface (the conversation closed or was deleted) —
 * the stage, for its part, falls back to the bench when its cell leaves.
 *
 * Select mode (#189): "Select" lives inside each lane's ⋯ overflow (Paper
 * bench, #188 slice 3 — there is no page-level control) and turns every lane
 * header into a checkbox row, swapping the composer for a bar with the
 * count, Select all, Delete and Done. While selecting, a tap anywhere on a
 * lane — header or cell — toggles that lane; the stage does not open in
 * select mode, so one gesture still means one thing. A lane with a running
 * generation can't be
 * selected (its ⋯ overflow, and so its Close/Delete/Select, is hidden for
 * the same reason — closing or deleting mid-render would land the image in
 * a thread that just vanished from the bench). Escape leaves select mode.
 * The selection is a Set of design ids kept beside the lanes, so a poll
 * landing mid-selection keeps it; ids whose lane left the surface are
 * dropped. The bar is the one piece of fixed chrome left; `main` pays bottom
 * padding for it only while selecting.
 */

type Anchor = {
  designId: string;
  imageId: string;
  imageUrl: string;
  title: string | null;
  /** The well under the chip thumbnail: the cell's luminance, null when published. */
  luminance: number | null;
};

/** Clean Label: names the state, says what to do, stops. */
const AT_CAP_COPY = `${GENERATION_CAP} generating — wait for one to finish.`;
const GENERATE_FAILED_COPY = "Something went wrong. Try again.";

/**
 * Delay before the one-shot mount reconcile (#204) below. Long enough that
 * it never competes with first paint, short enough that a lane the server's
 * `after()` sweep is closing while this tab was away doesn't sit stale for
 * long.
 */
const MOUNT_RECONCILE_DELAY_MS = 1500;

/**
 * A click the browser should handle itself: a new tab or window, a download.
 * The stage's links are real hrefs so these work (#188 slice 4); only a plain
 * click is taken over by pushState.
 */
function isModifiedClick(e: ReactMouseEvent) {
  return e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
}

export function StudioClient({
  initialLanes,
  initialNowMs,
  isGuest = false,
  initialFocus,
}: {
  initialLanes: StudioLane[];
  /**
   * The server's clock reading when it rendered the page. The first render
   * derives the lane-age and elapsed labels from it, on the server and again
   * at hydration, so the two produce identical text (React #418,
   * 2026-09-25). The page must pass it; the Date.now() fallback is for
   * callers that never server-render (tests).
   */
  initialNowMs?: number;
  /** An anonymous guest-funnel session (#241): shows the sign-up/sign-in
   * line under the composer while there is at least one lane to keep. */
  isGuest?: boolean;
  /** The stage address the page parsed from the URL, or null for the bench. */
  initialFocus?: StudioFocus | null;
}) {
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
  // Starts at the server's reading, not the browser's: see initialNowMs.
  const [nowMs, setNowMs] = useState(() => initialNowMs ?? Date.now());
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  // The synthetic lane an unanchored submit just created. It goes to the top
  // of the bench (just below the composer), which is off-screen if the user
  // had scrolled down, so the lane nudges itself into view when it mounts
  // (phone-first: the whole point of #187 is seeing that the tap
  // registered). The nudge is `block:"nearest"` (see the effect below) —
  // with the composer now at the top of the page too, the common case is
  // that the lane is already visible, and a no-op scroll must stay a no-op.
  const [revealDesignId, setRevealDesignId] = useState<string | null>(null);
  // The focused stage's address (#188 slice 4). Lives in the URL
  // (?conversation=&image=) so Back and reload work; moves are pushState /
  // replaceState on the client, not router navigations — the lanes are
  // already here and a soft navigation would re-run the page's DB read on
  // every tap. popstate re-reads the URL (below). Null is the bench.
  const [focus, setFocus] = useState<StudioFocus | null>(initialFocus ?? null);
  // Mirrors `focus` for giveBack, which runs from async callbacks that must
  // see where the user is now, not where the submit was made. Written by
  // go() and the popstate handler as well as the effect, so a give-back in
  // the same tick as a move sees the move.
  const focusRef = useRef(focus);
  useEffect(() => {
    focusRef.current = focus;
  }, [focus]);
  // The cells the stage has already shown for its lane, so a result landing
  // in it can be told apart from cells that were there when the stage
  // opened (the follow effect below). Keyed by lane: entering a lane — a
  // tap, the first render, Back — marks everything already in it as seen.
  const seenCells = useRef<{ designId: string; ids: Set<string> } | null>(null);
  // The image the latest stage edit was anchored to (the stage showed it at
  // submit time). A landing is followed only while the stage still shows
  // it: a user who has picked another result meanwhile is left there.
  const followFrom = useRef<StudioFocus | null>(null);
  // Set by the chip's ✕ on the stage: the stage image stops being the
  // anchor until the focus changes.
  const [anchorCleared, setAnchorCleared] = useState(false);
  // Bumped by the stage's "New design" so the bench's composer input takes
  // focus once the bench has mounted (the stage's own input is gone by then).
  const [focusComposerNonce, setFocusComposerNonce] = useState(0);
  const { confirm, element: confirmSheet } = useConfirm();

  const polling = useRef(false);
  // The poll in flight, for a caller that needs fresh lanes even when a poll
  // is already running (pollOnce itself returns at once in that case).
  const pollInFlight = useRef<Promise<void> | null>(null);
  const pollStartedAt = useRef<number | null>(null);
  // Mirrors `lanes` for the async reconcile loop below, which must read
  // current server state, not the closure it started with.
  const lanesRef = useRef(lanes);
  useEffect(() => {
    lanesRef.current = lanes;
  }, [lanes]);
  // Mirrors `text` so a failed submit can tell, from an async callback and
  // without reading state inside an updater (StrictMode runs updaters twice),
  // whether its words really went back into the box. giveBack and submit
  // write it directly too, so two settles in one tick see each other.
  const textRef = useRef(text);
  useEffect(() => {
    textRef.current = text;
  }, [text]);
  // Guards every lost-submit reconcile loop (#245): each loop checks this
  // before touching state, so an unmount stops it without a stray setState
  // and StrictMode's mount → unmount → remount still works.
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  // The composer panel is the only place `notice` renders (the focused
  // stage renders the same panel under its image, on the same ref), and on
  // the bench it sits at the top of the page — but the control that SETS a
  // notice (Close, Delete, bulk delete, a refused submit) can be lanes below
  // the fold. On a failure transition, bring the panel back on screen so the
  // explanation is actually seen (Important 2, whole-branch review).
  const composerPanelRef = useRef<HTMLDivElement>(null);
  const prevNoticeRef = useRef<string | null>(null);
  useEffect(() => {
    if (notice !== null && prevNoticeRef.current === null && !selectMode) {
      composerPanelRef.current?.scrollIntoView({ block: "nearest" });
    }
    prevNoticeRef.current = notice;
  }, [notice, selectMode]);

  // What the bench renders: server truth plus this tab's own overlay.
  const renderedLanes = applyOptimistic(lanes, optimistic);
  // The lane and cell the focus names, or null: the bench renders.
  const stage = resolveFocus(renderedLanes, focus);
  // On the stage the shown image is the anchor unless the chip was cleared;
  // on the bench the anchor is whatever state holds (nothing sets it there
  // any more except giveBack's restore after a refused submit).
  const effectiveAnchor: Anchor | null =
    stage && !anchorCleared
      ? {
          designId: stage.lane.designId,
          imageId: stage.lane.cells[stage.index].imageId,
          imageUrl: stage.lane.cells[stage.index].imageUrl,
          title: stage.lane.title,
          // A published cell sits on paper (its backdrop is pinned, #139).
          luminance:
            stage.lane.cells[stage.index].backdropColor === null
              ? stage.lane.cells[stage.index].luminance
              : null,
        }
      : stage
        ? null
        : anchor;
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
    let settle!: () => void;
    pollInFlight.current = new Promise<void>((resolve) => {
      settle = resolve;
    });
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
      settle();
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
  // A ref mirror of `active`, read by the mount-reconcile timer below at the
  // moment it FIRES rather than the moment it was scheduled — a plain
  // closure over `active` from an empty-deps mount effect would be stale by
  // then.
  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);
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

  // One reconcile shortly after first paint (#204). The idle-archive half of
  // the after() sweep (studio.ts sweepStudioForUser) doesn't self-correct
  // the way a pending job does: the periodic loop above runs only while
  // something is pending or optimistic, so a lane the server closed while
  // this tab was away (or backgrounded) would otherwise sit on screen until
  // the wake handler fires or a write against it is refused. Skipped when
  // the loop is already active — it will see the same server state on its
  // own very next tick, and firing both would double the request for
  // nothing.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!activeRef.current) void pollOnce();
    }, MOUNT_RECONCILE_DELAY_MS);
    return () => clearTimeout(timer);
    // Mount-once: pollOnce is stable (useCallback, no deps), so listing it
    // does not re-arm this after the first paint.
  }, [pollOnce]);

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

  // On mount, the URL is the truth too. The first render took initialFocus
  // (the server rendered from the same URL, so hydration matches), but a
  // remount from Next's back/forward cache — Back into /studio after Order
  // or Open on the stage — reuses the props of the render it cached, which
  // can name another stage or none. Read after hydration, so the server
  // markup is never contradicted during it.
  useEffect(() => {
    const fromUrl = parseFocus(new URLSearchParams(window.location.search));
    focusRef.current = fromUrl;
    setFocus(fromUrl);
    setAnchorCleared(false);
  }, []);

  // Back/forward: the URL is the truth for which state is on screen. Select
  // mode belongs to the bench, so a Back that lands on a stage leaves it.
  useEffect(() => {
    function onPop() {
      const next = parseFocus(new URLSearchParams(window.location.search));
      focusRef.current = next;
      setFocus(next);
      setAnchorCleared(false);
      if (next) {
        setSelectMode(false);
        setSelected(new Set());
      }
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // A focus that names nothing on the bench (closed elsewhere, archived by
  // the sweep, a stale link) falls back to the bench and drops the params,
  // so a reload does not try again. Not on the lanes in hand alone: a
  // remount from Next's back/forward cache brings the page-load lanes, which
  // can predate the focused image. So first one poll for that focus (or the
  // one already running), and drop the params only if the fresh lanes still
  // don't have it. The bench shows meanwhile.
  const focusKey = focus ? `${focus.designId}\n${focus.imageId}` : null;
  const [focusPolledKey, setFocusPolledKey] = useState<string | null>(null);
  const focusPollStarted = useRef<string | null>(null);
  useEffect(() => {
    if (!focusKey || stage) return;
    if (focusPolledKey === focusKey) {
      go(null, "replace");
      return;
    }
    if (focusPollStarted.current === focusKey) return;
    focusPollStarted.current = focusKey;
    const fresh = polling.current ? pollInFlight.current : pollOnce();
    void Promise.resolve(fresh).then(() => {
      if (mountedRef.current) setFocusPolledKey(focusKey);
    });
    // go is a plain function rebuilt every render; the focus, whether it
    // resolves, and whether its poll is back are the real dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, stage === null, focusPolledKey]);

  // Follow a landed result: when the focused lane gains a cell this stage
  // has not shown while the stage still shows the image the latest edit was
  // anchored to (followFrom), show it (the user asked for the change; seeing
  // it is the point). Picked another result meanwhile, or a landing nobody
  // here asked for (another tab): stay put. replaceState, not push: Back
  // should leave the stage, not step through every result that landed.
  // Entering a lane only records what is already there, so opening the
  // stage on an older result stays put.
  const stageCellIds = stage?.lane.cells.map((c) => c.imageId).join(",");
  useEffect(() => {
    if (!stage) {
      seenCells.current = null;
      return;
    }
    const ids = new Set(stage.lane.cells.map((c) => c.imageId));
    const seen = seenCells.current;
    seenCells.current = { designId: stage.lane.designId, ids };
    if (seen?.designId !== stage.lane.designId) return;
    const fresh = newestUnseenCell(stage.lane, seen.ids);
    const from = followFrom.current;
    const shown = stage.lane.cells[stage.index];
    if (
      fresh &&
      from?.designId === stage.lane.designId &&
      from.imageId === shown.imageId
    ) {
      followFrom.current = null;
      go({ designId: stage.lane.designId, imageId: fresh.imageId }, "replace");
    }
    // The lane's cell ids are the real dependency (the lane object is
    // rebuilt by every poll and every render's overlay).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage?.lane.designId, stageCellIds]);

  // The stage's "New design" lands on the bench; its composer input exists
  // only once the bench has rendered, so focus it here.
  useEffect(() => {
    if (focusComposerNonce === 0) return;
    composerPanelRef.current?.querySelector("input")?.focus();
  }, [focusComposerNonce]);

  // Once mounted, switch from the server's clock reading to the browser's.
  // Right after hydration the two differ by the page's load time; after a
  // remount from the router cache, the cached initialNowMs can be minutes
  // old. Without pending work nothing else ticks, so this is the only
  // refresh the lane-age labels get. A layout effect, not a passive one: a
  // state update in a layout effect re-renders before the browser paints,
  // so a back/forward remount never shows a frame of stale labels. It runs
  // after the hydration commit, so the hydration render itself still uses
  // initialNowMs and matches the server.
  useLayoutEffect(() => {
    setNowMs(Date.now());
  }, []);

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
    const ok = await confirm({
      title: bulkDeleteTitle(ids.length),
      body: bulkDeleteConsequence(ids.length),
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
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

  // Cell tap in select mode: outside select mode a tap opens the stage
  // (openStage below). Lane only calls this once it has already branched on
  // selectMode itself, so there is no mode check here.
  function selectLaneFromCell(lane: StudioLane) {
    if (lane.pending.length === 0) toggleSelected(lane.designId);
  }

  // Moves between the bench and the stage (#188 slice 4) by writing the URL
  // directly, with Next's documented native-history pattern: state `null`.
  // Next's patched pushState/replaceState then copies its own entry state in
  // and updates the router's canonical URL, so a later server action that
  // revalidates (or a refresh) stays on this entry instead of navigating back
  // to the page-load URL. Passing the existing state instead would skip that
  // (Next returns early when its marker is already there).
  function go(next: StudioFocus | null, mode: "push" | "replace") {
    const url = next ? focusHref(next) : BENCH_HREF;
    if (mode === "push") window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
    focusRef.current = next;
    setFocus(next);
    setAnchorCleared(false);
  }

  function openStage(lane: StudioLane, index: number) {
    const c = lane.cells[index];
    if (!c) return;
    // Already shown (a tap on the current strip result): no new history
    // entry, so Back still leaves the stage in one step.
    const shown = focusRef.current;
    if (shown?.designId === lane.designId && shown.imageId === c.imageId) return;
    go({ designId: lane.designId, imageId: c.imageId }, "push");
    window.scrollTo({ top: 0 });
  }

  function leaveStage(e: ReactMouseEvent<HTMLAnchorElement>) {
    if (isModifiedClick(e)) return;
    e.preventDefault();
    go(null, "push");
  }

  // The shared "this submit genuinely failed" path (#245): a digest throw
  // (#204), an offline fast-fail, and a reconcile loop's own "failed"
  // verdict all land here. Drops the cell, shows the notice, gives the words
  // (and their anchor state) back only if the box is still empty (a later
  // draft must never be clobbered), and reconciles once so a closed lane
  // actually leaves.
  function failSubmit(
    localId: string,
    trimmed: string,
    submitAnchor: Anchor | null
  ) {
    setOptimistic((entries) => entries.filter((e) => e.localId !== localId));
    setNotice(GENERATE_FAILED_COPY);
    giveBack(trimmed, submitAnchor);
    void pollOnce();
  }

  // A submit that did not run hands its words back to the box only if the box
  // is empty, and the composer goes back to what was submitted: the words and
  // the anchor state that submit carried, replacing whatever anchor is current
  // (spent by a sibling, dismissed, or a different image set meanwhile). So
  // the chip and placeholder always describe where the words in the box will
  // go. Anchor X whose image is still on the surface comes back as a fresh
  // copy (an earlier sibling submit accepted later can't spend it by
  // reference in spendAnchor); X gone from the surface, or no anchor at all,
  // gives none (a restored anchor on a vanished image would sit until the next
  // lanes change). If the box already has new text, the anchor isn't touched.
  //
  // "On the surface" means that conversation still holds that image: a seed
  // image can sit in two lanes, and the one the words were for may have
  // closed.
  //
  // Where the user is when the refusal arrives decides which anchor is
  // restored. On the bench it is the bench `anchor` state. On the
  // stage (#188 slice 4) the chip is derived from the shown image, and the
  // bench state is left alone (writing it there would leave a hidden bench
  // anchor that surfaces on "← Studio"): an edit of the shown image gets its
  // chip back (undoing a ✕ pressed meanwhile); an edit of another image
  // moves the stage back to that image, since the stage is where an anchor
  // is chosen; words that were not an edit (or whose image left) come back
  // with the chip cleared.
  function giveBack(trimmed: string, submitAnchor: Anchor | null) {
    if (textRef.current !== "") return;
    textRef.current = trimmed;
    setText(trimmed);
    const onSurface =
      submitAnchor !== null &&
      lanesRef.current.some(
        (l) =>
          l.designId === submitAnchor.designId &&
          l.cells.some((c) => c.imageId === submitAnchor.imageId)
      );
    const shown = focusRef.current;
    if (!shown) {
      setAnchor(onSurface ? { ...submitAnchor } : null);
      return;
    }
    if (!onSurface || !submitAnchor) {
      setAnchorCleared(true);
    } else if (
      submitAnchor.designId === shown.designId &&
      submitAnchor.imageId === shown.imageId
    ) {
      setAnchorCleared(false);
    } else {
      go({ designId: submitAnchor.designId, imageId: submitAnchor.imageId }, "replace");
    }
  }

  // Clears the bench anchor a submit was sent with, once its turn is known to
  // have been accepted. Compared by reference: an anchor the user set while
  // the request was in flight, or one giveBack restored as a copy, is a
  // different object and stays. A submit made from the stage passes null
  // here (see submit): the stage keeps its anchor.
  function spendAnchor(submitted: Anchor | null) {
    if (!submitted) return;
    setAnchor((a) => (a === submitted ? null : a));
  }

  // One lost submit's reconcile loop (#245 Design §Client 4): looks its own
  // clientJobId up on LOST_SUBMIT_LOOKUP_INTERVAL_MS cadence, starting
  // immediately, until judgeLostSubmit calls it. Independent of pollOnce and
  // of every other lost submit's own loop — each looks up only its own id.
  //
  // `hardDeadlineMs` (independent review, item 1) is the backstop for a
  // lookup that keeps ERRORING past `deadlineMs` — never trusted as proof of
  // absence the way a real "none" answer is, so it can only fail this submit
  // once STALE_OPTIMISTIC_MS has passed since the submit itself (see
  // judgeLostSubmit's docs).
  //
  // `anchorToSpend` is what an accepted turn spends: the submit's anchor on
  // the bench, null on the stage (see submit).
  async function reconcileLostSubmit(
    localId: string,
    clientJobId: string,
    deadlineMs: number,
    hardDeadlineMs: number,
    trimmed: string,
    submitAnchor: Anchor | null,
    anchorToSpend: Anchor | null
  ) {
    // Tracks the current run of CONSECUTIVE "error" lookups for
    // judgeLostSubmit's errorStreakCount (third review, 2026-09-27): 0 when
    // the last lookup was NOT an error (a real answer resets it), else the
    // number of errors in a row ending with the most recent lookup. Counted
    // in attempts, not elapsed time, so a device that makes zero attempts
    // while asleep can't have the budget consumed by the sleep itself. Local
    // to this submit's own loop — each lost submit reconciles independently.
    let errorStreakCount = 0;
    for (;;) {
      if (!mountedRef.current) return;
      const calledAtMs = Date.now();
      let status: LostSubmitLookup;
      try {
        // A plain Server Function call with no timeout of its own: a
        // genuinely hung request (not just a fast network error) would
        // otherwise stall this loop forever (second independent review,
        // item 3). Treated exactly like a lookup that threw.
        status = (
          await withTimeout(
            "lost-submit lookup",
            LOST_SUBMIT_LOOKUP_TIMEOUT_MS,
            () => getGenerationJobStatus(clientJobId)
          )
        ).status;
      } catch {
        status = "error";
      }
      if (!mountedRef.current) return;
      errorStreakCount = status === "error" ? errorStreakCount + 1 : 0;
      const verdict = judgeLostSubmit({
        status,
        calledAtMs,
        deadlineMs,
        hardDeadlineMs,
        errorStreakCount,
      });
      if (verdict === "landed") {
        // Exactly what a queued response does: the cell now has a real job
        // behind it, and the next poll that lists it retires the overlay.
        setOptimistic((entries) =>
          entries.map((e) =>
            e.localId === localId
              ? { ...e, jobId: clientJobId, jobIdKnownAtMs: Date.now() }
              : e
          )
        );
        spendAnchor(anchorToSpend);
        void pollOnce();
        return;
      }
      if (verdict === "failed") {
        // A "failed" verdict from "none" (at deadlineMs) or "error" (at
        // hardDeadlineMs) is a timeout call, not server proof — a poll may
        // already list this id as pending, and that is positive evidence the
        // submit landed even if lookups keep failing or coming back empty.
        // The net only recognises a PENDING cell: a lane's finished cells
        // (StudioCell) carry no job id at all, so a submit whose job already
        // succeeded and left `pending` can't be recognised this way — that
        // case is instead caught by the lookup itself eventually answering
        // "succeeded" (which is exactly what
        // src/app/studio/__tests__/studio-client.test.tsx's "test 12b:
        // lookups keep erroring past the deadline, then one succeeds"
        // exercises). A genuine status "failed" is authoritative and always
        // fails here regardless.
        if (status !== "failed") {
          const clientIdPending = lanesRef.current.some((lane) =>
            lane.pending.some((job) => job.jobId === clientJobId)
          );
          if (clientIdPending) {
            setOptimistic((entries) =>
              entries.map((e) =>
                e.localId === localId
                  ? { ...e, jobId: clientJobId, jobIdKnownAtMs: Date.now() }
                  : e
              )
            );
            spendAnchor(anchorToSpend);
            void pollOnce();
            return;
          }
        }
        failSubmit(localId, trimmed, submitAnchor);
        return;
      }
      if (verdict === "cancelled") {
        // Deliberate: the only way to cancel is the user's own Cancel, and a
        // cancelled queued job today just leaves — no notice, words not
        // given back. The turn was accepted, so a bench anchor is spent too.
        setOptimistic((entries) => entries.filter((e) => e.localId !== localId));
        spendAnchor(anchorToSpend);
        void pollOnce();
        return;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, LOST_SUBMIT_LOOKUP_INTERVAL_MS)
      );
    }
  }

  async function submit() {
    const trimmed = text.trim();
    // Only the cap blocks — an in-flight submit does not: firing the next
    // idea without waiting for the last one's round trip is the normal case,
    // so the box clears now and each submit runs concurrently up to the cap.
    if (!trimmed || atCap) return;
    const submitAnchor = effectiveAnchor;
    // An accepted turn spends the anchor on the BENCH (Nico, 2026-10-01,
    // #276): the next idea typed there starts a new lane. On the stage the
    // shown image stays the anchor — the next line is another change to it.
    const fromStage = stage !== null;
    const anchorToSpend = fromStage ? null : submitAnchor;
    textRef.current = "";
    setText("");
    setNotice(null);
    // No anchor → a fresh conversation: generateDesign creates the design row
    // for an unseen id only for a submit that passes the quota and capacity
    // checks (#197), so the client mints the id up front and the lane
    // appears on the refetch below once the row exists.
    const targetDesignId = submitAnchor?.designId ?? crypto.randomUUID();
    // The cell goes up now (#187). An anchored submit appends to that lane; an
    // unanchored one synthesizes a lane at the top of the bench — the first
    // lane below the composer panel — which is off-screen on a phone if the
    // user had scrolled down (see the `reveal` nudge-into-view below).
    const localId = crypto.randomUUID();
    // Minted here, not by the server (#245): lets a lost response be
    // reconciled by looking this exact id up, whatever `generateDesign`
    // itself returns or throws.
    const clientJobId = crypto.randomUUID();
    // The submit's own clock reading — the optimistic entry's age (and so
    // settleOptimistic's STALE_OPTIMISTIC_MS cutoff) is measured from it, and
    // a lost response's reconcile loop uses the same instant as the start of
    // ITS hard backstop (below), so the two "give up" points move together.
    const startedAtMs = Date.now();
    // `navigator.onLine` is trusted only in its `false` direction — `true`
    // proves nothing. Captured now so the catch can compare against the
    // reading at failure time (Design §Client 3): only offline at both
    // moments means the fetch was refused on the device.
    const offlineAtSubmit =
      typeof navigator !== "undefined" && navigator.onLine === false;
    if (!submitAnchor) setRevealDesignId(targetDesignId);
    setOptimistic((entries) => [
      ...entries,
      {
        localId,
        designId: targetDesignId,
        anchorImageId: submitAnchor?.imageId ?? null,
        startedAt: new Date(startedAtMs),
        jobId: null,
        clientJobId,
        prompt: trimmed,
      },
    ]);
    // An unanchored submit from the stage starts a new conversation, which
    // lives on the bench: go there now, where the reveal nudge finds the new
    // lane and its pending cell (the stage has no place to show either). An
    // anchored one records the image it edits, for the follow effect.
    if (fromStage && !submitAnchor) go(null, "push");
    if (fromStage && submitAnchor) {
      followFrom.current = {
        designId: submitAnchor.designId,
        imageId: submitAnchor.imageId,
      };
    }
    try {
      const result = await generateDesign(targetDesignId, trimmed, {
        ...(submitAnchor ? { anchorImageId: submitAnchor.imageId } : {}),
        jobId: clientJobId,
      });
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
        // Spends a bench anchor only (anchorToSpend, above).
        spendAnchor(anchorToSpend);
        await pollOnce();
      } else {
        // The turn didn't run, so the cell it promised has to go.
        setOptimistic((entries) => entries.filter((e) => e.localId !== localId));
        setNotice(result.message);
        // Give the words (and the anchor) back if the box is still empty —
        // the turn didn't run.
        giveBack(trimmed, submitAnchor);
      }
    } catch (err) {
      // A digest means React's Flight client rebuilt this from an actual
      // server-side throw (#204: e.g. an anchored lane closed underneath the
      // tap) — that submit never queued, so there is nothing to reconcile.
      if (isServerActionError(err)) {
        failSubmit(localId, trimmed, submitAnchor);
        return;
      }
      // The fetch was refused on the device at both ends of the call: no
      // request reached the server, so there is no job row to find.
      if (
        offlineAtSubmit &&
        typeof navigator !== "undefined" &&
        navigator.onLine === false
      ) {
        failSubmit(localId, trimmed, submitAnchor);
        return;
      }
      // Otherwise the response is lost, not necessarily the request: keep
      // the cell exactly where it is (no notice, no words back) and find out
      // what actually happened. deadlineMs is anchored on THIS CATCH, same as
      // before (Design §Client 4: the server started the request no later
      // than here). hardDeadlineMs (item 1) is anchored on the SUBMIT itself
      // (startedAtMs) rather than the catch — it exists to bound an
      // ERRORING lookup, which can recur for as long as the device stays
      // offline, and STALE_OPTIMISTIC_MS is defined as time since the
      // overlay entry's own startedAt (settleOptimistic), so anchoring both
      // on the same instant keeps them the same "give up" moment.
      void reconcileLostSubmit(
        localId,
        clientJobId,
        Date.now() + LOST_SUBMIT_WINDOW_MS,
        startedAtMs + STALE_OPTIMISTIC_MS,
        trimmed,
        submitAnchor,
        anchorToSpend
      );
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
    const ok = await confirm({
      title: DELETE_CONVERSATION_TITLE,
      body: DELETE_CONVERSATION_CONSEQUENCE,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
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
    <>
      {confirmSheet}
      {/* The stage is wider than the bench: board G's 600px image plus a
          roomy right column does not fit max-w-4xl (its right column would be
          200px at lg). The layout's heading follows via data-studio-stage
          (src/app/studio/layout.tsx). */}
      <main
        data-studio-stage={stage ? "" : undefined}
        className={`flex-1 px-4 sm:px-6 ${stage ? "max-w-6xl" : "max-w-4xl"} mx-auto w-full ${
          selectMode ? "pt-6 pb-40" : "pb-8"
        }`}
      >
        {stage ? (
          <div className="py-2">
            {/* Keyed by conversation so the stage's own local state (the
                history disclosure) resets when the focus moves to another
                conversation. */}
            <FocusedStage
              key={stage.lane.designId}
              lane={stage.lane}
              index={stage.index}
              nowMs={nowMs}
              unresolvedCellIds={unresolvedCellIds}
              onBack={leaveStage}
              onPickResult={(i, e) => {
                if (isModifiedClick(e)) return;
                e.preventDefault();
                openStage(stage.lane, i);
              }}
              onNewDesign={(e) => {
                if (isModifiedClick(e)) return;
                e.preventDefault();
                setAnchor(null);
                go(null, "push");
                setFocusComposerNonce((n) => n + 1);
              }}
              onCancel={(jobId) => void cancelJob(stage.lane, jobId)}
              focusHrefFor={(i) =>
                focusHref({
                  designId: stage.lane.designId,
                  imageId: stage.lane.cells[i].imageId,
                })
              }
              benchHref={BENCH_HREF}
              composer={
                <>
                  <Composer
                    panelRef={composerPanelRef}
                    text={text}
                    anchor={effectiveAnchor}
                    atCap={atCap}
                    capNotice={AT_CAP_COPY}
                    notice={notice}
                    onChangeText={setText}
                    onSubmit={() => void submit()}
                    onClearAnchor={() => setAnchorCleared(true)}
                  />
                  {isGuest && <GuestKeepLine className="-mt-2" />}
                </>
              }
            />
          </div>
        ) : (
          <>
            {selectMode ? null : (
              <>
                <div className="py-6">
                  <Composer
                    panelRef={composerPanelRef}
                    text={text}
                    anchor={effectiveAnchor}
                    atCap={atCap}
                    capNotice={AT_CAP_COPY}
                    notice={notice}
                    onChangeText={setText}
                    onSubmit={() => void submit()}
                    onClearAnchor={() => setAnchor(null)}
                  />
                </div>
                {/* The guest line (#241) goes BELOW the composer, never above:
                    it wraps to two 44px rows on a phone and comes and goes
                    mid-session (a guest's first lane appears, their last lane
                    is deleted), so above the composer it would shove the
                    composer down under the thumb that just pressed Generate.
                    Keyed off renderedLanes, optimistic lanes included, so it
                    shows as soon as a first lane does; hidden on an empty bench,
                    where there is nothing to keep. It sits with the composer as
                    the bench's top chrome, so select mode hides both. */}
                {isGuest && renderedLanes.length > 0 && (
                  <GuestKeepLine className="-mt-3 pb-3" />
                )}
              </>
            )}

            {renderedLanes.length === 0 ? (
              <EmptyState message="No open designs." />
            ) : (
              renderedLanes.map((lane) => (
                <Lane
                  key={lane.designId}
                  lane={lane}
                  nowMs={nowMs}
                  anchoredImageId={effectiveAnchor?.imageId ?? null}
                  selectMode={selectMode}
                  selected={selected.has(lane.designId)}
                  onTapCell={selectLaneFromCell}
                  onOpenCell={openStage}
                  onToggleSelect={toggleSelected}
                  onClose={closeLane}
                  onDelete={deleteLane}
                  onCancel={cancelJob}
                  onEnterSelectMode={enterSelectMode}
                  unresolvedCellIds={unresolvedCellIds}
                  reveal={lane.designId === revealDesignId}
                />
              ))
            )}
          </>
        )}
      </main>

      {selectMode && (
        <div
          className="fixed bottom-0 inset-x-0 border-t border-foreground bg-surface px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
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
      )}
    </>
  );
}

/**
 * The bench's one submit control, at the top of the page (Paper bench,
 * #188 slice 3). It was a fixed bottom bar; the mock puts it under the tab
 * strip as a bordered paper panel, so the page has no fixed chrome and
 * `main` pays no standing bottom padding. The focused stage (#188 slice 4)
 * renders this same component under its image, unchanged.
 *
 * The field is a bare underlined input rather than the `Input` primitive:
 * the primitive draws a bordered box, and the panel already owns the box.
 * It keeps `data-testid="studio-composer"` and stays inside a form so Enter
 * submits and the existing submit tests keep working.
 */
function Composer({
  panelRef,
  text,
  anchor,
  atCap,
  capNotice,
  notice,
  onChangeText,
  onSubmit,
  onClearAnchor,
}: {
  panelRef: RefObject<HTMLDivElement | null>;
  text: string;
  anchor: Anchor | null;
  atCap: boolean;
  capNotice: string;
  notice: string | null;
  onChangeText: (value: string) => void;
  onSubmit: () => void;
  onClearAnchor: () => void;
}) {
  return (
    <div
      ref={panelRef}
      data-testid="studio-composer-panel"
      className="w-full max-w-[640px] bg-surface border border-foreground p-5 flex flex-col gap-3.5"
    >
      <span className="font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted">
        New design
      </span>
      <form
        className="contents"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        {/* text-[17px], not the house text-sm (14px): the mock's value, and
            below 16px iOS Safari zooms the viewport on focus — don't
            "correct" this back down in a copy/style sweep. */}
        <input
          type="text"
          value={text}
          onChange={(e) => onChangeText(e.target.value)}
          placeholder={anchor ? "Describe the change" : "Describe a design"}
          className="min-h-11 w-full py-2.5 bg-transparent border-0 border-b border-text-faint text-[17px] leading-6 text-foreground placeholder:text-text-faint focus:outline-none focus:border-foreground"
          data-testid="studio-composer"
        />
        {anchor && (
          <div
            className="flex items-center gap-2 min-w-0"
            data-testid="anchor-chip"
          >
            <div className={`relative w-8 h-8 overflow-hidden ${wellClass(anchor.luminance)} shrink-0 border border-border`}>
              <Image
                src={anchor.imageUrl}
                alt=""
                fill
                sizes="32px"
                className="object-cover"
              />
            </div>
            <span className="font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted truncate">
              Editing · {anchor.title ?? "Untitled"}
            </span>
            <button
              type="button"
              aria-label="Clear anchor"
              onClick={onClearAnchor}
              className="shrink-0 min-h-11 px-2 text-text-muted hover:text-foreground"
            >
              ✕
            </button>
          </div>
        )}
        {atCap && (
          <p className="text-xs text-text-muted" data-testid="cap-notice">
            {capNotice}
          </p>
        )}
        {notice && <p className="text-xs text-text-muted">{notice}</p>}
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs leading-4 text-text-muted">
            Each line starts a design. Tap a result to change it.
          </span>
          <Button
            type="submit"
            variant="generate"
            disabled={!text.trim() || atCap}
            className="shrink-0 min-h-11 px-4 font-mono text-[11px] leading-4 tracking-[0.08em] uppercase"
            data-testid="studio-generate"
          >
            Generate
          </Button>
        </div>
      </form>
    </div>
  );
}

/** Items are found in the DOM rather than passed as data, so `Lane` keeps
 * owning their labels, handlers and test ids. An item added without this
 * role is invisible to the arrow keys — that is the contract. `children`
 * is also expected to be a flat list of menuitem elements (no wrapping
 * fragments/conditionals-that-render-false in the middle): the roving
 * tabIndex below counts valid elements to stay in step with this
 * selector's DOM-order count, and a nested or skipped position would
 * desync the two. */
const MENUITEM_SELECTOR = '[role="menuitem"]';

/**
 * The per-lane overflow (Paper bench, #188 slice 3). The actions that used
 * to sit as inline text links in the lane header — Close, Delete, and the
 * page-level Select — live behind one 46px control so the row reads as a
 * title, a state and a time, which is what makes activity-desc ordering
 * legible (#187 point 3).
 *
 * It is a WAI-ARIA menu button, not a disclosure — the markup already
 * declared `aria-haspopup="menu"` / `role="menu"` / `role="menuitem"`, which
 * promises arrow-key navigation and roving tabindex; this implements that
 * promise rather than retracting it.
 *
 * Closes on outside click, on Escape, and on any click inside (every item
 * is a terminal action, so there is nothing to keep it open for). Focus
 * returns to the trigger on Escape ONLY. An outside click has already put
 * the user's attention somewhere deliberate, Tab is a deliberate move
 * onward, and on activation the trigger usually does not survive — Close
 * and Delete remove the lane, and Select hides every ⋯ on the page — so a
 * generic on-close restore would focus a detached node.
 */
function LaneMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dropUp, setDropUp] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const menuItems = useCallback(
    () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(MENUITEM_SELECTOR) ?? []
      ),
    []
  );

  const focusItem = useCallback(
    (index: number) => {
      const items = menuItems();
      if (items.length === 0) return;
      const next = ((index % items.length) + items.length) % items.length;
      setActiveIndex(next);
      items[next]?.focus();
    },
    [menuItems]
  );

  // Focus enters the panel on open. Layout effect, so it lands before paint
  // and a screen reader announces the item rather than the button again.
  // activeIndex itself is reset to 0 in the trigger's onClick (below), not
  // here — react-hooks/set-state-in-effect forbids a setState call in an
  // effect body; this effect only synchronizes focus with the DOM.
  useLayoutEffect(() => {
    if (!open) return;
    // preventScroll: this effect and the flip-placement effect below both
    // key off `open` and run in declaration order, so focus can land before
    // the panel's dropUp position is measured. A focus() without this flag
    // scrolls the (still top-full, possibly below-the-fold) panel into
    // view first — the trigger the user just tapped is on-screen by
    // construction, so that scroll is never wanted. Do not remove it.
    menuItems()[0]?.focus({ preventScroll: true });
  }, [open, menuItems]);

  // The last lane sits at the bottom of a scrolling page, where a panel
  // anchored to `top-full` opens below the fold. Measured from real rects
  // after the panel renders — no estimated height, because the panel is
  // three rows today and may not be tomorrow. Re-run on every open so a
  // menu that flipped once does not stay flipped after a scroll.
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current?.getBoundingClientRect();
    const panel = panelRef.current?.getBoundingClientRect();
    if (!trigger || !panel) return;
    setDropUp(trigger.bottom + panel.height > window.innerHeight);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpen(false);
      // isConnected: Escape can race a poll that removed this lane.
      if (triggerRef.current?.isConnected) triggerRef.current.focus();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function onPanelKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusItem(activeIndex + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusItem(activeIndex - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusItem(0);
    } else if (e.key === "End") {
      e.preventDefault();
      focusItem(menuItems().length - 1);
    } else if (e.key === "Tab") {
      // No preventDefault (ruling R4): the browser moves focus onward and
      // the panel unmounts in the same tick.
      setOpen(false);
    }
  }

  // Roving tabindex: exactly one item is in the Tab order at a time.
  // Indexed by valid-element position, not Children.map's position — a
  // conditional item (`{cond && <button role="menuitem">…</button>}`)
  // still consumes a Children index when it renders `false`, which would
  // desync this from menuItems()'s DOM-order count and could leave no
  // item focusable.
  let itemIndex = -1;
  const items = Children.map(children, (child) =>
    isValidElement<{ tabIndex?: number }>(child)
      ? cloneElement(child, { tabIndex: ++itemIndex === activeIndex ? 0 : -1 })
      : child
  );

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label="More"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          if (!open) setActiveIndex(0);
          setOpen(!open);
        }}
        className="w-[46px] min-h-11 -mr-3 flex items-center justify-center text-foreground"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      {open && (
        <div
          ref={panelRef}
          role="menu"
          onClick={() => setOpen(false)}
          onKeyDown={onPanelKeyDown}
          className={`absolute right-0 ${
            dropUp ? "bottom-full" : "top-full"
          } z-10 min-w-[9rem] bg-surface border border-foreground flex flex-col`}
        >
          {items}
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
  onOpenCell,
  onToggleSelect,
  onClose,
  onDelete,
  onCancel,
  onEnterSelectMode,
  unresolvedCellIds,
  reveal,
}: {
  lane: StudioLane;
  nowMs: number;
  anchoredImageId: string | null;
  selectMode: boolean;
  selected: boolean;
  /** Select-mode cell tap only — a plain tap outside select mode opens the
   * stage instead (Lane's own onClick branches on selectMode before
   * calling this), so there is no cell to pass. */
  onTapCell: (lane: StudioLane) => void;
  /** A plain cell tap opens the focused stage for that cell; select mode
   * keeps its own tap, see onTapCell. */
  onOpenCell: (lane: StudioLane, index: number) => void;
  onToggleSelect: (designId: string) => void;
  onClose: (lane: StudioLane) => void;
  onDelete: (lane: StudioLane) => void;
  onCancel: (lane: StudioLane, jobId: string) => void;
  /** Opens this row's own Select entry inside its ⋯ overflow (Paper bench,
   * #188 slice 3) — the page-level "Select" control is gone, so this is now
   * the only door into select mode. */
  onEnterSelectMode: () => void;
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
  // `block:"nearest"` rather than `"start"`: the composer panel now lives at
  // the TOP of the page (Paper bench, #188 slice 3), so pinning this lane to
  // the very top of the viewport would push the panel — draft field, cap
  // notice, error line — off screen right after the user just used it.
  // "nearest" is a no-op when the lane is already visible (the common case,
  // since submitting requires the top-of-page composer to be on screen) and
  // scrolls the minimum amount otherwise.
  useEffect(() => {
    if (reveal) sectionRef.current?.scrollIntoView({ block: "nearest" });
  }, [reveal]);

  return (
    <section
      ref={sectionRef}
      className="border-t border-border pt-2 pb-4 flex flex-col gap-2"
      data-testid="studio-lane"
      data-selected={selectMode ? selected : undefined}
    >
      <div
        className={`flex items-center gap-3 min-h-11 ${
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
          // The stage of the lane's primary cell, else its newest (#188
          // slice 4); a lane with no cells yet keeps its thread link.
          <Link
            href={laneStageHref(lane) ?? `/design?id=${lane.designId}`}
            onClick={(e) => {
              if (!laneStageHref(lane) || isModifiedClick(e)) return;
              e.preventDefault();
              const target = lane.cells.findIndex((c) => c.isPrimary);
              onOpenCell(lane, target === -1 ? lane.cells.length - 1 : target);
            }}
            className="min-w-0 flex-1 hover:underline"
          >
            <h2 className="text-sm font-medium truncate">
              {lane.title ?? "Untitled"}
            </h2>
          </Link>
        )}
        {generating && (
          <span
            data-testid="lane-generating"
            className="shrink-0 font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-foreground border border-foreground px-2 py-0.5"
          >
            Generating
          </span>
        )}
        <span className="shrink-0 font-mono text-[11px] leading-4 text-text-faint">
          {timeAgo(lane.lastActiveAt, nowMs)}
        </span>
        {/* Close and Delete are absent while generating (closing or deleting
            mid-render would land the image in a thread that just vanished
            from the bench) and in select mode (the bar's Delete is the one
            verb there). With every item gone there is nothing to open, so
            the trigger goes too. */}
        {!generating && !selectMode && (
          <LaneMenu>
            <button
              type="button"
              role="menuitem"
              onClick={() => onClose(lane)}
              className="min-h-11 px-4 text-left text-sm text-text-muted hover:text-foreground hover:bg-surface-well"
              data-testid="studio-close-lane"
            >
              Close
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => onDelete(lane)}
              className="min-h-11 px-4 text-left text-sm text-text-muted hover:text-foreground hover:bg-surface-well"
              data-testid="studio-delete-lane"
            >
              Delete
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={onEnterSelectMode}
              className="min-h-11 px-4 text-left text-sm text-text-muted hover:text-foreground hover:bg-surface-well"
              data-testid="select-mode"
            >
              Select
            </button>
          </LaneMenu>
        )}
      </div>

      <div ref={scrollRef} className="flex gap-2 overflow-x-auto pb-1">
        {lane.cells.map((cell, index) => {
          const anchored = cell.imageId === anchoredImageId;
          // Creation order, same convention as the /design strip (#151):
          // #1 is the lane's first image, and a later generation never
          // renumbers an earlier one.
          const label = `#${index + 1}`;
          // The ink well is the same colour as border-foreground and the
          // muted label colour, so on it the anchored cue and the #N / Primary
          // labels invert to Paper. Published cells stay on paper, as in the
          // focused stage's strip.
          const onInk = cell.backdropColor === null && wellForLuminance(cell.luminance) === "dark";
          return (
            <div
              key={cell.imageId}
              className="relative shrink-0 w-28 h-28 sm:w-36 sm:h-36"
            >
              <button
                type="button"
                data-testid="studio-cell"
                aria-label={`Open result #${index + 1}${
                  cell.isPrimary ? ", primary" : ""
                }${anchored ? ", editing" : ""}`}
                onClick={() => {
                  // One gesture, one meaning (docblock above): outside select
                  // mode the cell body opens the focused stage on this cell
                  // (#188 slice 4), which is also what anchors it. In select
                  // mode the tap keeps its old job (toggle this lane's
                  // selection), and the section-scroll that used to
                  // compensate for the keyboard popping up over an anchor
                  // only makes sense there.
                  if (selectMode) {
                    onTapCell(lane);
                    sectionRef.current?.scrollIntoView({ block: "nearest" });
                    return;
                  }
                  onOpenCell(lane, index);
                }}
                className={`absolute inset-0 overflow-hidden ${
                  onInk ? "bg-surface-well-dark" : "bg-surface"
                } ${
                  anchored
                    ? onInk
                      ? "border-2 border-background"
                      : "border-2 border-foreground"
                    : "border border-foreground"
                }`}
              >
                <span className="absolute inset-1.5">
                  <Image
                    src={cell.imageUrl}
                    alt=""
                    fill
                    sizes="(min-width: 640px) 144px, 112px"
                    className="object-contain"
                  />
                </span>
                <span className={`absolute top-1 left-1.5 font-mono text-[11px] leading-4 ${onInk ? "text-background" : "text-text-muted"}`}>
                  {label}
                </span>
                {/* Anchored (2px ink border) and primary (this mono label) are
                    orthogonal signals, not two weights of the same one — a
                    non-primary cell being edited must not read as "the lead
                    image", and the lead image must stay identifiable while
                    something else is being edited. Same offsets as the #N
                    label, mirrored to the bottom. */}
                {cell.isPrimary && (
                  <span className={`absolute bottom-1 left-1.5 font-mono text-[11px] leading-4 uppercase tracking-[0.08em] ${onInk ? "text-background" : "text-text-muted"}`}>
                    Primary
                  </span>
                )}
                {/* The button carries an explicit aria-label (above) built
                    from the same isPrimary/anchored state, rather than
                    relying on its visible contents: an aria-label REPLACES
                    the whole subtree in the accessibility tree, so a screen
                    reader never sees the "#N"/"Primary" text spans at all —
                    they're sighted-only decoration once a label is present.
                    `aria-pressed` was dropped (#236 follow-up) for the same
                    reason it would otherwise have covered: this button opens
                    the stage rather than toggling its own state, so a
                    pressed/unpressed semantic would be wrong. */}
              </button>
            </div>
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
              className="shrink-0 w-28 h-28 sm:w-36 sm:h-36 border border-dashed border-foreground bg-surface flex flex-col items-center justify-center gap-1.5"
            >
              <span className="font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted animate-pulse">
                Generating…
              </span>
              <span className="font-mono text-xs leading-4 text-text-faint tabular-nums">
                {formatElapsed(nowMs - job.startedAt.getTime())}
              </span>
              {/* The space is reserved from the start: the control renders
                  inert and invisible until the jobId lands, so the label and
                  elapsed time don't shift under the user when it appears.
                  Cancel is min-h-7 (28px), under the house 44px rule — a
                  deliberate exception (controller-ruled, task-4 brief): it
                  sits inside a 112px cell under two lines of text, where a
                  44px target does not fit, and the cell itself is not
                  tappable, so nothing sits next to it to mis-hit. */}
              <button
                type="button"
                disabled={unresolved}
                aria-hidden={unresolved || undefined}
                tabIndex={unresolved ? -1 : undefined}
                onClick={
                  unresolved ? undefined : () => onCancel(lane, job.jobId)
                }
                className={`text-xs leading-4 text-foreground underline underline-offset-[3px] min-h-7 px-3 ${
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
