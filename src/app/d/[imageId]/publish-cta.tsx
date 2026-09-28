"use client";

import { useState } from "react";
import { PublishModal } from "@/components/publish-modal";
import { GuestPublishPrompt } from "@/components/guest-publish-prompt";

/**
 * Publish affordance for an owner's unpublished image on `/d/[imageId]`
 * (#136 slice 1). The page now serves private work, so publish state has to
 * be stated and actionable here — the modal is the same one My Designs and
 * the design thread open.
 *
 * `canPublish` comes from the server page's own session read (a guest-funnel
 * anonymous session is a real Better-Auth user row and would otherwise pass
 * an owner check here — publishImage rejects it server-side too, but the
 * button shouldn't invite the click). When false, the modal never opens;
 * a sign-up / sign-in prompt (GuestPublishPrompt) explains why instead,
 * returning the guest to this page afterwards.
 */
export function PublishCta({
  imageId,
  imageUrl,
  canPublish,
}: {
  imageId: string;
  imageUrl: string;
  canPublish: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (!canPublish) {
    return <GuestPublishPrompt next={`/d/${imageId}`} />;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center text-sm text-text-muted underline underline-offset-[3px] hover:no-underline sm:min-h-0"
      >
        Publish
      </button>
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
