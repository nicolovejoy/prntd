"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import {
  DESIGN_ENTRY_FAILED,
  DESIGN_ENTRY_OPENING,
  DESIGN_ENTRY_RETRY,
} from "@/lib/action-copy";
import { ensureGuestSession } from "@/lib/ensure-guest-session";
import { rateLimitRetryDelayMs } from "@/lib/guest-session-error";
import { seedHref } from "@/lib/studio-seed";

/**
 * The sessionless way into the Studio (#188 slice 2b, spec ruling 1). The
 * proxy sends a request with no session cookie to /sign-in for /studio, but
 * lets /design through while the guest funnel is on; so a visitor with no
 * cookie lands here, gets an anonymous session, and then moves on to the
 * Studio carrying the landing idea. A visitor who already has a session never
 * sees this page: /design redirects them on the server.
 *
 * It navigates only after the mint settles, so the Studio's request carries
 * the new cookie. A lookup that fails without minting also resolves, and the
 * navigation goes ahead: the proxy then sends the visitor to sign-in, which is
 * what happened on /design before.
 *
 * A mint that Better-Auth refuses rejects. Its default rate limit is 3
 * sign-ins per 10 s per IP, so a fourth visitor behind one address gets a 429;
 * that one is retried once, on its own, after the wait the response states
 * (10 s without one, 15 s at most), with the status line still on screen. Any
 * other failure, or a second 429, shows one line and a retry button.
 *
 * It leaves with window.location.replace, not router.replace. Server actions
 * do run on this page: the site header's getHeaderState posts on mount and
 * again when the mint changes the session, and a concurrent action can swallow
 * a client-side navigation (the 2026-09-08 sign-in hang; sign-in and sign-up
 * hard-navigate for the same reason). The Studio is a full document load, so
 * its seed effect starts from a clean page.
 */
export function DesignEntry({ prompt }: { prompt: string | null }) {
  const [failed, setFailed] = useState(false);
  const started = useRef(false);
  const mounted = useRef(false);

  async function enter() {
    setFailed(false);
    let retried = false;
    for (;;) {
      try {
        await ensureGuestSession();
        break;
      } catch (err) {
        console.error(
          "[design] guest session failed",
          err instanceof Error ? err.message : String(err)
        );
        const waitMs = retried ? null : rateLimitRetryDelayMs(err);
        if (waitMs === null) {
          if (mounted.current) setFailed(true);
          return;
        }
        retried = true;
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        if (!mounted.current) return;
      }
    }
    if (!mounted.current) return;
    window.location.replace(seedHref(prompt));
  }

  // The attempt is ref-guarded so Strict Mode's double effect makes one; the
  // mounted flag is not, because Strict Mode's simulated unmount clears it and
  // the second effect sets it again.
  useEffect(() => {
    mounted.current = true;
    if (!started.current) {
      started.current = true;
      void enter();
    }
    return () => {
      mounted.current = false;
    };
    // Mount-once; enter is rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 px-4 sm:px-6 py-8 max-w-4xl mx-auto w-full">
        {failed ? (
          <div className="space-y-3" data-testid="design-entry-failed">
            <p role="alert" className="text-sm text-negative">
              {DESIGN_ENTRY_FAILED}
            </p>
            <Button
              variant="secondary"
              className="min-h-11"
              onClick={() => void enter()}
            >
              {DESIGN_ENTRY_RETRY}
            </Button>
          </div>
        ) : (
          <p
            role="status"
            data-testid="design-entry-status"
            className="font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted"
          >
            {DESIGN_ENTRY_OPENING}
          </p>
        )}
      </main>
    </div>
  );
}
