import { getDiscoverFeed } from "../d/actions";
import { PublishedGrid } from "@/components/published-grid";

export const dynamic = "force-dynamic";

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
          <PublishedGrid images={images} from="/prints" />
        ) : (
          <p className="text-center text-text-muted py-16">
            No published designs yet.
          </p>
        )}
      </div>
    </main>
  );
}
