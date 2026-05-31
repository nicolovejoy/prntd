"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updatePublishedNaming } from "@/app/designs/actions";
import { publishedBackdrop } from "@/lib/products";
import { BackgroundPicker } from "@/components/background-picker";

/**
 * The published design's image with its storefront backdrop. The owner gets
 * an always-visible background picker right under the image — pick a swatch
 * and the backdrop updates live (local state), persisting in the background.
 * Non-owners just see the image on its pinned backdrop.
 *
 * The picker lives here, not behind the title "Edit" link, because setting
 * the backdrop is a visual, direct-manipulation action — you want to see it
 * applied to the actual art as you choose.
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
  const [bg, setBg] = useState<string | null>(initialBackgroundColor);
  const [pending, startTransition] = useTransition();
  const backdrop = publishedBackdrop(bg);

  function pick(color: string | null) {
    const prev = bg;
    setBg(color); // optimistic
    startTransition(async () => {
      try {
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
      <div
        className={`rounded-lg overflow-hidden border border-border ${backdrop.className}`}
        style={backdrop.style}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt={alt} className="w-full h-auto object-contain" />
      </div>

      {canEdit && (
        <BackgroundPicker value={bg} onChange={pick} disabled={pending} />
      )}
    </div>
  );
}
