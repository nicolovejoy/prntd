"use client";

import type { DesignImage, ProductVersionGroup } from "@/lib/design-images";
import { Button } from "@/components/ui";

/**
 * Desktop working stage (#147). Post-#136 the thread is one tap deeper than
 * the image page, so its job is iterating, not browsing — but the artwork was
 * only visible as a ~120px thumbnail in a narrow rail while a pasted prompt
 * filled the page.
 *
 * Here the current image leads at real size, generations sit in a strip
 * beneath it, and chat is the column beside. Mobile keeps the existing
 * chat-first layout (strip + drawer) untouched.
 */
export function DesignStage({
  images,
  productGroups,
  selectedImage,
  generating,
  onSelectImage,
  onOpenLightbox,
  onMakeProducts,
  onSelectProductVersion,
}: {
  images: DesignImage[];
  productGroups: ProductVersionGroup[];
  selectedImage: string | null;
  generating: boolean;
  /** Promote an image to the design's primary and show it in the hero. */
  onSelectImage: (imageUrl: string) => void;
  onOpenLightbox: (index: number) => void;
  onMakeProducts: () => void;
  onSelectProductVersion: (productId: string) => void;
}) {
  // The hero is the design's primary image, falling back to the newest
  // generation so a thread always leads with something.
  const heroIndex = (() => {
    const i = images.findIndex((img) => img.url === selectedImage);
    return i >= 0 ? i : images.length - 1;
  })();
  const hero = images[heroIndex];

  return (
    <div className="hidden md:flex flex-1 min-w-0 flex-col">
      {/* Hero */}
      <div className="flex-1 min-h-0 flex items-center justify-center p-6">
        {hero ? (
          <button
            type="button"
            onClick={() => onOpenLightbox(heroIndex)}
            className="h-full max-h-full w-full flex items-center justify-center"
            title="Open full size"
            data-testid="stage-hero"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={hero.url}
              alt={`Design #${hero.number}`}
              className="max-h-full max-w-full object-contain rounded-lg bg-checkerboard"
            />
          </button>
        ) : (
          <p className="text-sm text-text-faint">
            {generating ? "Generating…" : "No images yet."}
          </p>
        )}
      </div>

      {/* Generations strip */}
      {(images.length > 0 || generating) && (
        <div className="border-t border-border p-3" data-testid="stage-strip">
          <div className="flex gap-2 overflow-x-auto">
            {images.map((img, i) => (
              <button
                key={img.id ?? img.number}
                onClick={() => onSelectImage(img.url)}
                className={`relative shrink-0 w-[72px] aspect-square rounded-lg overflow-hidden border-2 transition-colors bg-checkerboard ${
                  i === heroIndex
                    ? "border-accent"
                    : "border-border hover:border-border-hover"
                }`}
                title={`Design #${img.number}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.url}
                  alt={`Design #${img.number}`}
                  className="w-full h-full object-contain"
                />
                <span className="absolute top-0.5 left-0.5 bg-black/70 text-white text-[10px] font-mono px-1 rounded">
                  #{img.number}
                </span>
              </button>
            ))}
            {generating && (
              <div className="shrink-0 w-[72px] aspect-square rounded-lg border-2 border-border flex items-center justify-center bg-surface">
                <span className="text-[10px] text-text-faint animate-pulse">
                  …
                </span>
              </div>
            )}
          </div>

          {/* Product versions — placement-targeted renders, grouped by product */}
          {productGroups.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
              {productGroups.map((group) => (
                <button
                  key={group.productId}
                  onClick={() => onSelectProductVersion(group.productId)}
                  className="text-[11px] text-text-muted hover:text-foreground"
                >
                  {group.productName} &rarr;
                </button>
              ))}
            </div>
          )}

          {images.length > 0 && (
            <div className="mt-3">
              <Button
                onClick={onMakeProducts}
                disabled={!selectedImage}
                size="sm"
                data-testid="stage-make-products"
              >
                Make Products &rarr;
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
