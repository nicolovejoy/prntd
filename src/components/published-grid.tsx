import Link from "next/link";
import type { PublishedImage } from "@/app/d/actions";

/**
 * Shared grid of published ("Fresh Prints") designs. Each card links to the
 * buy page at /d/[imageId]. The viewer's own designs are tagged "by you"
 * (set on PublishedImage.isOwn by the feed query).
 */
export function PublishedGrid({ images }: { images: PublishedImage[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
      {images.map((img) => (
        <Link key={img.imageId} href={`/d/${img.imageId}`} className="group block">
          <div className="aspect-square bg-checkerboard rounded-md overflow-hidden border border-border group-hover:border-accent transition-colors">
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
      ))}
    </div>
  );
}
