"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updatePublishedNaming } from "@/app/designs/actions";
import { publishedBackdrop, DEFAULT_PUBLISH_BACKGROUND } from "@/lib/blanks";
import { BackgroundPicker } from "@/components/background-picker";

/**
 * The published design's image with its storefront backdrop. The owner gets
 * an always-visible background picker right under the image — pick a swatch
 * and the backdrop updates live (local state), persisting in the background.
 * Non-owners just see the image on its pinned backdrop.
 *
 * The picker lives here, not behind the title "Edit" link, because setting
 * the backdrop is a visual, direct-manipulation action — you want to see it
 * applied to the actual art as you choose. The owner's non-visual actions
 * (Publish/Un-publish, Open conversation, Delete conversation) live in the
 * OWNER row instead (`owner-actions.tsx`).
 */
export function PublishedImageView({
  imageId,
  imageUrl,
  alt,
  initialBackgroundColor,
  canEdit,
}: {
  imageId: string;
  imageUrl: string;
  alt: string;
  initialBackgroundColor: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  // Legacy rows can carry null; the picker offers no transparent option
  // (#73), so seed it with the White display default instead.
  const [bg, setBg] = useState<string>(
    initialBackgroundColor ?? DEFAULT_PUBLISH_BACKGROUND
  );
  const [pending, startTransition] = useTransition();
  const backdrop = publishedBackdrop(bg);

  function pick(color: string) {
    const prev = bg;
    setBg(color); // optimistic
    startTransition(async () => {
      try {
        // R6: the return is `{ error?: string }` now, discarded here on
        // purpose — a backdrop-only edit sends no `title`, so the blank-title
        // guard can never fire on this call site today. But it IS a call
        // site that would silently swallow a future structured refusal on
        // this field; if one is ever added, this needs to read the result.
        await updatePublishedNaming(imageId, { backgroundColor: color });
        // Refresh so the storefront grid / other surfaces pick up the change.
        router.refresh();
      } catch {
        setBg(prev); // roll back on failure
      }
    });
  }

  return (
    <div className="space-y-3">
      {/* 1px bordered card on paper; the fill inside is the listing's pinned
          backdrop, which stays a real colour because it is the buyer's
          garment-colour choice (design review, Paper note). */}
      <div
        className={`rounded-lg overflow-hidden border border-border ${backdrop.className}`}
        style={backdrop.style}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt={alt}
          className="w-full h-auto max-h-[40vh] md:max-h-none object-contain mx-auto"
        />
      </div>

      {canEdit && (
        <BackgroundPicker value={bg} onChange={pick} disabled={pending} />
      )}
    </div>
  );
}
