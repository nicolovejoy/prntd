"use client";

import { useState } from "react";
import { startConversationFromImage } from "@/app/design/actions";
import { ensureGuestSession } from "@/lib/ensure-guest-session";
import { Button } from "@/components/ui";

/**
 * Fresh-start entry on the public image page (slice 3): open a new
 * conversation seeded by this published image — a reference link, not a
 * copy. Open to guests like the rest of the design funnel: a session is
 * minted on tap if needed (ensureGuestSession), same as /design.
 */
export function StartFromImage({ imageId }: { imageId: string }) {
  const [starting, setStarting] = useState(false);

  async function start() {
    setStarting(true);
    try {
      await ensureGuestSession();
      const { designId } = await startConversationFromImage(imageId);
      window.location.assign(`/design?id=${designId}`);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Action failed");
      setStarting(false);
    }
  }

  return (
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
  );
}
