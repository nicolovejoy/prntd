"use client";

import { useState } from "react";
import { startConversationFromImage } from "@/app/design/actions";
import { ensureGuestSession } from "@/lib/ensure-guest-session";
import { InlineNotice } from "@/components/ui";
import { START_FROM_IMAGE_FAILED } from "@/lib/action-copy";

/**
 * Fresh-start entry on the public image page (slice 3): open a new
 * conversation seeded by this published image — a reference link, not a
 * copy. Open to guests like the rest of the design funnel: a session is
 * minted on tap if needed (ensureGuestSession), same as /design.
 *
 * Renders as a small text action beside the one primary "Order" (Paper
 * slice 5, #188) — it used to be a second full-width button, visually
 * identical to the primary purchase action it sat beside.
 */
export function StartFromImage({ imageId }: { imageId: string }) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setStarting(true);
    setError(null);
    try {
      await ensureGuestSession();
      const { designId } = await startConversationFromImage(imageId);
      window.location.assign(`/design?id=${designId}`);
    } catch {
      // The thrown message is a Next.js digest in production, so the line
      // says what happened in our own words instead.
      setError(START_FROM_IMAGE_FAILED);
      setStarting(false);
    }
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={start}
        disabled={starting}
        data-testid="start-from-image"
        className="inline-flex min-h-11 items-center text-sm text-text-muted underline underline-offset-[3px] hover:no-underline disabled:cursor-not-allowed disabled:text-text-faint disabled:no-underline"
      >
        {starting ? "Starting…" : "New design from this image"}
      </button>
      {error && <InlineNotice message={error} />}
    </div>
  );
}
