"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { closeConversation, generateDesign } from "@/app/design/actions";
import {
  GENERATION_CAP,
  isAtGenerationCap,
  isPollHalted,
  nextPollDelayMs,
} from "@/lib/generation-poll";
import { formatElapsed, timeAgo } from "@/lib/studio-view";
import type { StudioLane } from "@/lib/studio";
import { getStudioLanes } from "./actions";

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
 * The anchor lives OUTSIDE the lane state on purpose: a poll refresh replaces
 * `lanes` wholesale with server truth, and the anchor (plus the draft text)
 * must survive that landing mid-typing. It's cleared only when its image
 * genuinely leaves the surface (the conversation closed or was deleted).
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
  // In-flight generateDesign calls: the job row doesn't exist until the
  // action returns, so these count toward the cap or a fast triple-tap would
  // send a fourth request for the server to reject (generation-poll.ts).
  const [submitting, setSubmitting] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [pollErrors, setPollErrors] = useState(0);
  // Bumped after every completed poll so the timer effect re-arms.
  const [pollNonce, setPollNonce] = useState(0);
  // Ticks once a second while something is pending, for the elapsed labels.
  const [nowMs, setNowMs] = useState(() => Date.now());

  const polling = useRef(false);
  const pollStartedAt = useRef<number | null>(null);

  const pendingCount = lanes.reduce((n, lane) => n + lane.pending.length, 0);
  const atCap = isAtGenerationCap(pendingCount, submitting);

  const pollOnce = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    try {
      const fresh = await getStudioLanes();
      // Server truth replaces the lanes — and only the lanes. The anchor and
      // the draft are the local state this refresh must not clobber; both
      // live in their own useState and are untouched here.
      setLanes(fresh);
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
  const active = pendingCount > 0 && !isPollHalted(pollErrors);
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
    if (pendingCount === 0) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pendingCount]);

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

  function toggleAnchor(lane: StudioLane, cell: StudioLane["cells"][number]) {
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
    setSubmitting((n) => n + 1);
    // No anchor → a fresh conversation: generateDesign creates the design row
    // for an unseen id, so the client mints one and the lane appears on the
    // refetch below.
    const targetDesignId = submitAnchor?.designId ?? crypto.randomUUID();
    try {
      const result = await generateDesign(
        targetDesignId,
        trimmed,
        submitAnchor ? { anchorImageId: submitAnchor.imageId } : {}
      );
      if (result.kind === "queued") {
        // The anchor deliberately stays put (plan, slice 3): successive
        // instructions fan out from the image the user chose; building on a
        // result means tapping it.
        await pollOnce();
      } else {
        setNotice(result.message);
        // Give the words back if the box is still empty — the turn didn't run.
        setText((t) => t || trimmed);
      }
    } catch {
      setNotice(GENERATE_FAILED_COPY);
      setText((t) => t || trimmed);
    } finally {
      setSubmitting((n) => n - 1);
    }
  }

  // Clear a lane by hand — Nico's "dead design" case. Close is the existing
  // reversible verb (closed_at; Reopen lives on /designs and /design), so
  // this is a new caller of an existing state, same as slice 4's auto-archive
  // will be. Optimistic: the lane leaves now, comes back on error.
  async function closeLane(lane: StudioLane) {
    const prev = lanes;
    setLanes((ls) => ls.filter((l) => l.designId !== lane.designId));
    setAnchor((a) => (a?.designId === lane.designId ? null : a));
    try {
      await closeConversation(lane.designId);
    } catch {
      setLanes(prev);
      setNotice("Couldn't close that design. Try again.");
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 px-4 sm:px-6 py-8 pb-40 max-w-4xl mx-auto w-full">
        <h1 className="text-xl sm:text-2xl font-bold mb-6">Studio</h1>

        {lanes.length === 0 ? (
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
          lanes.map((lane) => (
            <Lane
              key={lane.designId}
              lane={lane}
              nowMs={nowMs}
              anchoredImageId={anchor?.imageId ?? null}
              onTapCell={toggleAnchor}
              onClose={closeLane}
            />
          ))
        )}
      </main>

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
              placeholder={anchor ? "Describe the change" : "Describe a design"}
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
    </div>
  );
}

function Lane({
  lane,
  nowMs,
  anchoredImageId,
  onTapCell,
  onClose,
}: {
  lane: StudioLane;
  nowMs: number;
  anchoredImageId: string | null;
  onTapCell: (lane: StudioLane, cell: StudioLane["cells"][number]) => void;
  onClose: (lane: StudioLane) => void;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const cellCount = lane.cells.length + lane.pending.length;

  // Land on the newest work: cells run oldest → newest, so a lane wider than
  // the phone opens (and stays) scrolled to its right edge as results arrive.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [cellCount]);

  return (
    <section ref={sectionRef} className="mb-8" data-testid="studio-lane">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <Link
          href={`/design?id=${lane.designId}`}
          className="min-w-0 flex-1 hover:underline"
        >
          <h2 className="text-sm font-medium truncate">
            {lane.title ?? "Untitled"}
          </h2>
        </Link>
        <span className="text-xs text-text-faint shrink-0">
          {timeAgo(lane.lastActiveAt, nowMs)}
        </span>
        {/* Absent while generating: closing mid-render would land the image
            in a thread that just vanished from the bench. */}
        {lane.pending.length === 0 && (
          <button
            type="button"
            onClick={() => onClose(lane)}
            className="shrink-0 text-xs text-text-faint hover:text-foreground"
            data-testid="studio-close-lane"
          >
            Close
          </button>
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

        {lane.pending.map((job) => (
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
          </div>
        ))}
      </div>
    </section>
  );
}
