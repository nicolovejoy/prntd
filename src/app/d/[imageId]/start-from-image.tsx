"use client";

import { useState } from "react";
import { startConversationFromImage } from "@/app/design/actions";
import { ensureGuestSession } from "@/lib/ensure-guest-session";
import { Button, InlineNotice } from "@/components/ui";
import { START_FROM_IMAGE_FAILED } from "@/lib/action-copy";

/**
 * Fresh-start entry on the public image page (slice 3): open a new
 * conversation seeded by this published image — a reference link, not a
 * copy. Open to guests like the rest of the design funnel: a session is
 * minted on tap if needed (ensureGuestSession), same as /design.
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
    <div className="w-full space-y-2">
      <Button
        variant="secondary"
        size="lg"
        onClick={start}
        disabled={starting}
        data-testid="start-from-image"
        className="w-full"
      >
        {starting ? "Starting…" : "New design from this image"}
      </Button>
      {error && <InlineNotice message={error} />}
    </div>
  );
}
