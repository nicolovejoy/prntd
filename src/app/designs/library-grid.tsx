import Image from "next/image";
import Link from "next/link";
import { publishedBackdrop } from "@/lib/blanks";
import type { LibraryImage } from "@/lib/user-designs";

// Matches the column count below (3 on a phone, 4/5 wider) so the browser
// requests a thumbnail rather than the full-res R2 PNG (#127 slice 3).
const GRID_SIZES = "(max-width: 767px) 33vw, (max-width: 1023px) 25vw, 20vw";

/**
 * My Designs: the user's images, newest first (studio-plan slice 5). A cell
 * taps through to the image detail page, which is where everything you can do
 * with an image lives — order it, publish it, start a new conversation from
 * it, or open the conversation that made it.
 *
 * Three columns at 390px: the whole cell is the tap target, so it clears 44px
 * with room to spare, and the grid never scrolls sideways.
 */
export function LibraryGrid({ images }: { images: LibraryImage[] }) {
  return (
    <div
      data-testid="library-grid"
      className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 sm:gap-3"
    >
      {images.map((img) => {
        // Published images sit on their chosen storefront backdrop (null →
        // White, #73); unpublished work keeps the checkerboard working view.
        const backdrop = img.isPublished
          ? publishedBackdrop(img.backgroundColor)
          : { className: "bg-checkerboard", style: undefined };
        return (
          <Link
            key={img.imageId}
            href={`/d/${img.imageId}?from=/designs`}
            className="group block"
          >
            <div
              className={`relative aspect-square rounded-md overflow-hidden border border-border group-hover:border-accent transition-colors ${backdrop.className}`}
              style={backdrop.style}
            >
              <Image
                src={img.imageUrl}
                alt="Design"
                fill
                sizes={GRID_SIZES}
                loading="lazy"
                decoding="async"
                className="object-contain"
              />
              {/* Quiet markers, one line, bottom of the cell — state the
                  reader needs to tell two thumbnails apart, nothing more. */}
              {(img.isPublished || img.isArchived) && (
                <span className="absolute inset-x-0 bottom-0 px-1.5 py-1 text-[10px] leading-none text-white bg-black/45 truncate">
                  {[
                    img.isPublished ? "Published" : null,
                    img.isArchived ? "Archived" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              )}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
