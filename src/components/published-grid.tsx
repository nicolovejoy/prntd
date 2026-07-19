import Link from "next/link";
import type { PublishedImage } from "@/app/d/actions";
import { publishedBackdrop } from "@/lib/blanks";

/**
 * Shared grid of published (Shop, /prints) designs. Each card links to the
 * buy page at /d/[imageId]. The viewer's own designs are tagged "by you"
 * (set on PublishedImage.isOwn by the feed query).
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
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
      {images.map((img) => {
        const backdrop = publishedBackdrop(img.backgroundColor);
        return (
        <Link key={img.imageId} href={`/d/${img.imageId}${suffix}`} className="group block">
          <div
            className={`aspect-square rounded-md overflow-hidden border border-border group-hover:border-accent transition-colors ${backdrop.className}`}
            style={backdrop.style}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={img.imageUrl}
              alt={img.title ?? "Design"}
              className="w-full h-full object-contain"
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
