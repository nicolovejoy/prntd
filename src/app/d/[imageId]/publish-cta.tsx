"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { PublishModal } from "@/components/publish-modal";

/**
 * Publish affordance for an owner's unpublished image on `/d/[imageId]`
 * (#136 slice 1). The page now serves private work, so publish state has to
 * be stated and actionable here — the modal is the same one My Designs and
 * the design thread open.
 */
export function PublishCta({
  imageId,
  imageUrl,
}: {
  imageId: string;
  imageUrl: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Publish
      </Button>
      <PublishModal
        imageId={open ? imageId : null}
        imageUrl={imageUrl}
        open={open}
        onClose={() => setOpen(false)}
        from={`/d/${imageId}`}
      />
    </>
  );
}
