"use client";

import { useEffect, useRef, useState } from "react";

// How long the link reads "Preparing download…" after a click. The zip
// streams, so the browser shows no progress until the first bytes arrive.
const STARTING_MS = 8000;

/**
 * "Download all my designs". A plain anchor, not next/link: no prefetch and
 * no client routing, so the browser treats /designs/export as a file
 * download. After a click it reads as busy for a few seconds and ignores
 * further taps, so a slow start isn't answered with a second download.
 */
export function ExportLink() {
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

  const look = starting
    ? "border-dotted border-border text-text-muted cursor-not-allowed"
    : "border-border text-text-muted hover:border-foreground hover:text-foreground";

  return (
    <a
      href="/designs/export"
      download
      onClick={onClick}
      aria-disabled={starting ? "true" : undefined}
      className={`inline-flex min-h-11 items-center rounded-md border px-3 text-xs transition-colors ${look}`}
    >
      {starting ? "Preparing download…" : "Download all my designs"}
    </a>
  );
}
