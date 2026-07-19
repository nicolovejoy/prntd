"use client";

import type { DesignImage, ProductVersionGroup } from "@/lib/design-images";

// Mobile-only strip docked above the composer: real thumbnails of the
// generated previews (newest first, selected one highlighted), horizontally
// scrollable. Tapping a thumbnail opens the lightbox; the "All" tile opens
// the full gallery drawer (product versions + Make Products live there).
// Replaces the numbered FAB, which floated over content and didn't read as
// "your previews".
export function MobileGalleryStrip({
  images,
  productGroups,
  selectedImage,
  generating,
  onClickImage,
  onOpenDrawer,
}: {
  images: DesignImage[];
  productGroups: ProductVersionGroup[];
  selectedImage: string | null;
  generating: boolean;
  onClickImage: (index: number) => void;
  onOpenDrawer: () => void;
}) {
  if (images.length === 0 && productGroups.length === 0 && !generating) {
    return null;
  }

  // Newest first so the latest render is in view without scrolling.
  const ordered = images.map((img, index) => ({ img, index })).reverse();

  return (
    <div
      className="md:hidden border-t border-border"
      data-testid="mobile-gallery-strip"
    >
      <div className="flex items-center gap-2 overflow-x-auto px-3 py-2">
        {generating && (
          <div
            className="shrink-0 w-14 h-14 rounded-md border-2 border-border bg-surface animate-pulse"
            aria-label="Generating"
          />
        )}
        {ordered.map(({ img, index }) => (
          <button
            key={img.id ?? img.number}
            type="button"
            onClick={() => onClickImage(index)}
            aria-label={`Preview #${img.number}`}
            className={`shrink-0 w-14 h-14 rounded-md overflow-hidden border-2 bg-gray-900 transition-colors ${
              selectedImage === img.url ? "border-accent" : "border-border"
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={img.url}
              alt={`Preview #${img.number}`}
              className="w-full h-full object-contain"
            />
          </button>
        ))}
        <button
          type="button"
          onClick={onOpenDrawer}
          data-testid="mobile-gallery-all"
          className="shrink-0 min-w-[56px] h-14 px-2 rounded-md border-2 border-border text-xs text-text-muted hover:text-foreground hover:border-border-hover transition-colors"
        >
          All
        </button>
      </div>
    </div>
  );
}
