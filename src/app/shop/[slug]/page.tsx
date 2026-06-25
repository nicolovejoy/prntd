import Link from "next/link";
import { notFound } from "next/navigation";
import { getStorefront } from "../actions";

type Params = Promise<{ slug: string }>;

// Storefront content depends on the live store/products + viewer session.
export const dynamic = "force-dynamic";

export default async function StorefrontPage({ params }: { params: Params }) {
  const { slug } = await params;
  const shop = await getStorefront(slug);
  if (!shop) notFound();

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 px-4 py-8">
        <div className="max-w-3xl mx-auto">
          <header className="flex items-center gap-3">
            {shop.accentColor && (
              <span
                className="inline-block w-4 h-4 rounded-full border border-border shrink-0"
                style={{ backgroundColor: shop.accentColor }}
                aria-hidden
              />
            )}
            <h1 className="text-2xl font-bold">{shop.name}</h1>
          </header>
          {shop.description && (
            <p className="mt-2 text-text-muted">{shop.description}</p>
          )}
          {shop.isOwner && (
            <p className="mt-2 text-xs text-text-faint">
              You&apos;re viewing your own shop — drafts and hidden products are
              visible to you only.
            </p>
          )}

          {shop.products.length === 0 ? (
            <p className="mt-8 text-sm text-text-faint">
              No products yet. Check back soon.
            </p>
          ) : (
            <div className="mt-8 grid grid-cols-2 sm:grid-cols-3 gap-4">
              {shop.products.map((p) => (
                <Link
                  key={p.id}
                  href={`/shop/${shop.slug}/${p.id}`}
                  className="group block"
                >
                  <div
                    className="aspect-square rounded-lg flex items-center justify-center overflow-hidden border border-border"
                    style={{ backgroundColor: p.bgHex }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.imageUrl}
                      alt={p.blankName}
                      className="max-w-[72%] max-h-[72%] object-contain transition-transform group-hover:scale-105"
                    />
                  </div>
                  <div className="mt-2 flex items-baseline justify-between gap-2">
                    <span className="text-sm truncate">{p.blankName}</span>
                    <span className="text-sm font-medium">${p.total.toFixed(2)}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
