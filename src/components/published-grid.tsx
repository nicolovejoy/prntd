import Image from "next/image";
import Link from "next/link";
import type { PublishedImage } from "@/app/d/actions";
import { publishedBackdrop } from "@/lib/blanks";

// Matches the grid's responsive column count (grid-cols-2 / sm:3 / lg:4) so
// the browser requests an appropriately-sized image instead of the full-res
// R2 source (#127 slice 3 — these were raw <img> full-res PNGs at ~180px).
// The two must change together — a stale boundary fetches an undersized
// source for the slot (25vw for what's actually 33vw between 768–1023px).
const GRID_SIZES = "(max-width: 639px) 50vw, (max-width: 1023px) 33vw, 25vw";

/**
 * Shared grid of Shop cards, used by the homepage teaser and /shop. Each
 * card links to the image detail page at /d/[imageId]. The viewer's own
 * designs are tagged "by you" (set on PublishedImage.isOwn by the feed
 * query).
 *
 * Card anatomy (Paper slice 6, #188): the card sells a shirt — art on its
 * pinned backdrop in a hairline frame, then title, then what it costs and
 * on what garment, then the maker.
 *
 * data-testid="published-grid" is the post-deploy prod smoke's DB canary
 * (.github/workflows/prod-smoke.yml): it only reaches the HTML when the
 * server-side feed query returned rows.
 */
export function PublishedGrid({
  images,
  from,
}: {
  images: PublishedImage[];
  /** Origin recorded on each card's link so the detail page's "up"/Escape returns here. */
  from?: string;
}) {
  const suffix = from ? `?from=${encodeURIComponent(from)}` : "";
  return (
    <div
      data-testid="published-grid"
      className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4"
    >
      {images.map((img) => {
        const backdrop = publishedBackdrop(img.backgroundColor);
        return (
        <Link key={img.imageId} href={`/d/${img.imageId}${suffix}`} className="group block">
          <div
            className={`relative aspect-square overflow-hidden border border-border group-hover:border-border-hover group-focus-visible:border-border-hover transition-colors ${backdrop.className}`}
            style={backdrop.style}
          >
            <Image
              src={img.imageUrl}
              alt={img.title ?? "Design"}
              fill
              sizes={GRID_SIZES}
              loading="lazy"
              decoding="async"
              className="object-contain"
            />
          </div>
          <div className="mt-2 space-y-0.5">
            <p className="text-sm font-medium text-foreground truncate">
              {img.title || "Untitled"}
            </p>
            {/* No price line: a card shows no garment or size, so any number
                here is one nobody pays (Nico, 2026-09-08). The total appears
                in the buy panel once both are picked. */}
            <p className="text-[11px] leading-4 text-text-faint truncate">
              {img.isOwn ? "by you" : `by ${img.designerName}`}
            </p>
          </div>
        </Link>
        );
      })}
    </div>
  );
}
