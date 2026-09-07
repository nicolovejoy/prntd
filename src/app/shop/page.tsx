import { getDiscoverFeed } from "../d/actions";
import { PublishedGrid } from "@/components/published-grid";
import { EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * The Shop — the community feed, moved here from /prints by nav model A so
 * that the word "Shop" names exactly one thing. The organizer storefronts at
 * /shop/[slug] are retired (#191) and drop out entirely with #201; a dynamic
 * segment needs a non-empty path segment, so they never shadow this page.
 */
export default async function ShopPage() {
  const images = await getDiscoverFeed(60);

  return (
    <main className="flex-1 px-4 py-10">
      <div className="max-w-6xl mx-auto">
        <header className="mb-8 text-center">
          <h1 className="text-3xl font-bold">Shop</h1>
          <p className="text-text-muted mt-2">
            Designs published by other makers.
          </p>
        </header>

        {images.length > 0 ? (
          <PublishedGrid images={images} from="/shop" />
        ) : (
          <EmptyState message="No published designs yet." />
        )}
      </div>
    </main>
  );
}
