"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import {
  isPollHalted,
  nextPollDelayMs,
} from "@/lib/generation-poll";
import { formatElapsed, timeAgo } from "@/lib/studio-view";
import type { StudioLane } from "@/lib/studio";
import { getStudioLanes } from "./actions";

/**
 * /studio — read-only in this slice (studio-plan slice 2): lanes render, a
 * running generation shows as a pending cell with elapsed time, and nothing
 * here mutates. The composer and cell-tap anchoring are slice 3, so cells
 * are deliberately inert — giving taps a navigation meaning now would
 * collide with the anchor gesture they gain next slice.
 *
 * Polling: while any lane has a pending cell, the whole read model is
 * re-fetched on the generation-poll schedule (fast, then slow). One request
 * per tick covers every lane, catches generations started in another tab,
 * and lets the server's lazy sweep clear overdue rows — which is why the
 * poll target is the surface itself rather than per-design getDesignJobs
 * calls (a fan-out that couldn't discover new lanes at all).
 */
export function StudioClient({ initialLanes }: { initialLanes: StudioLane[] }) {
  const [lanes, setLanes] = useState<StudioLane[]>(initialLanes);
  const [pollErrors, setPollErrors] = useState(0);
  // Bumped after every completed poll so the timer effect re-arms.
  const [pollNonce, setPollNonce] = useState(0);
  // Ticks once a second while something is pending, for the elapsed labels.
  const [nowMs, setNowMs] = useState(() => Date.now());

  const polling = useRef(false);
  const pollStartedAt = useRef<number | null>(null);

  const pendingCount = lanes.reduce((n, lane) => n + lane.pending.length, 0);

  const pollOnce = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    try {
      const fresh = await getStudioLanes();
      // Server truth replaces the whole surface — this screen holds no local
      // state a poll could clobber (read-only slice; slice 3's anchor is the
      // thing that will need protecting here).
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

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 px-4 sm:px-6 py-8 max-w-4xl mx-auto w-full">
        <h1 className="text-xl sm:text-2xl font-bold mb-6">Studio</h1>

        {lanes.length === 0 ? (
          <div className="text-center py-16 space-y-4">
            <p className="text-text-faint text-lg">No open designs.</p>
            <Link href="/design">
              <Button>New design</Button>
            </Link>
          </div>
        ) : (
          lanes.map((lane) => <Lane key={lane.designId} lane={lane} nowMs={nowMs} />)
        )}
      </main>
    </div>
  );
}

function Lane({ lane, nowMs }: { lane: StudioLane; nowMs: number }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const cellCount = lane.cells.length + lane.pending.length;

  // Land on the newest work: cells run oldest → newest, so a lane wider than
  // the phone opens (and stays) scrolled to its right edge as results arrive.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [cellCount]);

  return (
    <section className="mb-8" data-testid="studio-lane">
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
      </div>

      <div ref={scrollRef} className="flex gap-2 overflow-x-auto pb-1">
        {lane.cells.map((cell) => (
          <div
            key={cell.imageId}
            data-testid="studio-cell"
            className={`relative shrink-0 w-28 h-28 rounded-md overflow-hidden bg-checkerboard ${
              cell.isPrimary ? "border-2 border-accent" : "border border-border"
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
          </div>
        ))}

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
