"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import {
  DESIGN_ENTRY_FAILED,
  DESIGN_ENTRY_OPENING,
  DESIGN_ENTRY_RETRY,
} from "@/lib/action-copy";
import { ensureGuestSession } from "@/lib/ensure-guest-session";
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
 * what happened on /design before. A mint that rejects shows one line and a
 * retry. No server action runs here, so the router.replace has nothing to
 * race (contrast the Studio's own page, which must not write history).
 */
export function DesignEntry({ prompt }: { prompt: string | null }) {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  async function enter() {
    setFailed(false);
    try {
      await ensureGuestSession();
    } catch (err) {
      console.error(
        "[design] guest session failed",
        err instanceof Error ? err.message : String(err)
      );
      setFailed(true);
      return;
    }
    router.replace(seedHref(prompt));
  }

  // Ref-guarded so Strict Mode's double effect makes one attempt.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void enter();
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
