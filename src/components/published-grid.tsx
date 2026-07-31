import Image from "next/image";
import Link from "next/link";
import type { PublishedImage } from "@/app/d/actions";
import { publishedBackdrop } from "@/lib/blanks";

// Matches the grid's responsive column count (grid-cols-2 / sm:3 / md:4) so
// the browser requests an appropriately-sized image instead of the full-res
// R2 source (#127 slice 3 — these were raw <img> full-res PNGs at ~180px).
const GRID_SIZES = "(max-width: 639px) 50vw, (max-width: 767px) 33vw, 25vw";

/**
 * Shared grid of published (Shop, /prints) designs. Each card links to the
 * buy page at /d/[imageId]. The viewer's own designs are tagged "by you"
 * (set on PublishedImage.isOwn by the feed query).
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
      className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4"
    >
      {images.map((img) => {
        const backdrop = publishedBackdrop(img.backgroundColor);
        return (
        <Link key={img.imageId} href={`/d/${img.imageId}${suffix}`} className="group block">
          <div
            className={`relative aspect-square rounded-md overflow-hidden border border-border group-hover:border-accent transition-colors ${backdrop.className}`}
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
          {img.title && (
            <p className="mt-2 text-sm font-medium truncate">{img.title}</p>
          )}
          <p className="text-xs text-text-muted truncate">
            {img.isOwn ? "by you" : `by ${img.designerName}`}
          </p>
        </Link>
        );
      })}
    </div>
  );
}
