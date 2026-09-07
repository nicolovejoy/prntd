import { getDiscoverFeed } from "../d/actions";
import { PublishedGrid } from "@/components/published-grid";
import { EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * The Shop — the community feed, moved here from /prints by nav model A so
 * that the word "Shop" names exactly one thing. The organizer storefronts at
 * /shop/[slug] are retired (#191) and drop out entirely with #201; a dynamic
 * segment needs a non-empty path segment, so they never shadow this page.
 *
 * Paper slice 6 (#188): the masthead is a left-aligned mono label, not a
 * centred display heading — matched by the homepage's Shop teaser in
 * src/app/page.tsx. The old sub-line ("Designs published by other makers.")
 * is dropped with no replacement: the Shop sells shirts, not art
 * (docs/object-model-composition.md), so a line about designs/makers is off
 * message and the card grid itself (backdrop, price, garment, maker) already
 * says what's for sale.
 */
export default async function ShopPage() {
  const images = await getDiscoverFeed(60);

  return (
    <main className="flex-1 px-4 py-10">
      <div className="max-w-6xl mx-auto">
        <h1 className="mb-8 font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted">
          Shop
        </h1>

        {images.length > 0 ? (
          <PublishedGrid images={images} from="/shop" />
        ) : (
          <EmptyState message="No published designs yet." />
        )}
      </div>
    </main>
  );
}
