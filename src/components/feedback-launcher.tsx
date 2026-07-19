"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { FeedbackWidget } from "./feedback-widget";
import { isFunnelRoute } from "@/lib/funnel-routes";

// Shared panel card: header row + close + widget. Used by the floating
// launcher below and by the SiteHeader "Feedback" menu item.
export function FeedbackPanel({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-raised p-4 shadow-lg">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">Feedback</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close feedback"
          className="-m-2 flex h-11 w-11 items-center justify-center text-text-muted hover:text-foreground"
        >
          ✕
        </button>
      </div>
      <FeedbackWidget projectId={projectId} onSent={onClose} />
    </div>
  );
}

// Fixed bottom-right launcher. Tap to toggle a small feedback panel that
// POSTs to ibuild4you. Rendered globally from the root layout so the page
// URL captured in each submission reflects wherever the user was.
// Hidden on funnel routes (#74) — it overlapped the generate CTA on /design
// mobile; there the header menu item opens the same panel.
export function FeedbackLauncher({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  if (isFunnelRoute(pathname)) return null;

  return (
    // data-loop-redact: the launcher is widget chrome — exclude it from its own page capture.
    <div className="fixed bottom-4 right-4 z-50 print:hidden" data-loop-redact="">
      {open && (
        <div className="mb-2 w-72 max-w-[calc(100vw-2rem)]">
          <FeedbackPanel projectId={projectId} onClose={() => setOpen(false)} />
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="min-h-11 rounded-full border border-border bg-surface-raised px-4 py-2 text-sm text-text-muted shadow-lg transition-colors hover:border-border-hover hover:text-foreground"
      >
        {open ? "Close" : "Feedback"}
      </button>
    </div>
  );
}
