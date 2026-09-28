"use client";

import { useEffect, useId, useRef, useState } from "react";

// How long a download link reads "Preparing download…" after a tap. A
// `download` anchor gives the page no signal when the download starts or
// ends. The route returns its response before reading any image, so the
// browser's download UI normally appears quickly, but the page can't see
// that; the window only stops a second tap from starting a second download.
const STARTING_MS = 8000;

/** One part as the page passes it: dates as ISO strings. */
export type ExportPartLink = {
  part: number;
  partCount: number;
  count: number;
  firstCreatedAt: string;
  lastCreatedAt: string;
};

const pacificDate = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  month: "short",
  day: "numeric",
  year: "numeric",
});

/** "Jan 4, 2026 – Mar 2, 2026", or one date when the part is a single day. */
function dateRange(firstIso: string, lastIso: string): string {
  const first = pacificDate.format(new Date(firstIso));
  const last = pacificDate.format(new Date(lastIso));
  return first === last ? first : `${first} – ${last}`;
}

function designs(n: number): string {
  return `${n} design${n === 1 ? "" : "s"}`;
}

/** Busy for STARTING_MS after the first tap; later taps in the window are ignored. */
function useStarting() {
  const [starting, setStarting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function onClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (starting) {
      e.preventDefault();
      return;
    }
    setStarting(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setStarting(false);
    }, STARTING_MS);
  }

  return { starting, onClick };
}

function LiveStatus({ starting }: { starting: boolean }) {
  return (
    <span role="status" aria-live="polite" className="sr-only">
      {starting ? "Preparing download…" : ""}
    </span>
  );
}

const CONTROL =
  "inline-flex min-h-11 items-center rounded-md border px-3 text-xs transition-colors";
const IDLE = "border-border text-text-muted hover:border-foreground hover:text-foreground";
const BUSY = "border-dotted border-border text-text-muted cursor-not-allowed";

function WholeLibraryLink() {
  const { starting, onClick } = useStarting();
  return (
    <>
      <a
        href="/designs/export"
        download
        onClick={onClick}
        aria-disabled={starting ? "true" : undefined}
        className={`${CONTROL} ${starting ? BUSY : IDLE}`}
      >
        {starting ? "Preparing download…" : "Download all my designs"}
      </a>
      <LiveStatus starting={starting} />
    </>
  );
}

function PartLink({ summary }: { summary: ExportPartLink }) {
  const { starting, onClick } = useStarting();
  return (
    <li>
      <a
        href={`/designs/export?part=${summary.part}`}
        download
        onClick={onClick}
        aria-disabled={starting ? "true" : undefined}
        className={`block min-h-11 rounded-md border px-3 py-2 text-xs transition-colors ${
          starting
            ? "border-dotted border-border text-text-muted cursor-not-allowed"
            : "border-border text-foreground hover:border-foreground"
        }`}
      >
        <span className="block">
          {starting
            ? "Preparing download…"
            : `Part ${summary.part} of ${summary.partCount} · ${designs(summary.count)}`}
        </span>
        <span className="block text-text-muted">
          {dateRange(summary.firstCreatedAt, summary.lastCreatedAt)}
        </span>
      </a>
      <LiveStatus starting={starting} />
    </li>
  );
}

/**
 * "Download all my designs". Download links are plain anchors, not
 * next/link: no prefetch and no client routing, so the browser treats
 * /designs/export as a file download.
 *
 * One part: the control is the link. More than one: a button that opens a
 * panel under it with one link per part (oldest first). The panel is
 * absolutely positioned so the masthead row never grows; Escape or a second
 * tap on the button closes it.
 */
export function ExportControl({
  parts,
  maxImages,
}: {
  parts: ExportPartLink[];
  maxImages: number;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      if (panel.current?.contains(document.activeElement)) button.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (parts.length <= 1) {
    return (
      <span className="relative inline-flex">
        <WholeLibraryLink />
      </span>
    );
  }

  const total = parts.reduce((sum, p) => sum + p.count, 0);
  return (
    <span className="relative inline-flex">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className={`${CONTROL} ${open ? "border-foreground text-foreground" : IDLE}`}
      >
        Download all my designs
      </button>
      <div
        ref={panel}
        id={panelId}
        hidden={!open}
        className="absolute right-0 top-full z-10 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-md border border-foreground bg-background p-3"
      >
        <p className="mb-2 text-xs text-text-muted">
          {total} designs in {parts.length} files of up to {maxImages}, oldest first.
        </p>
        <ul className="space-y-2">
          {parts.map((p) => (
            <PartLink key={p.part} summary={p} />
          ))}
        </ul>
      </div>
    </span>
  );
}
