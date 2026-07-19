import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { auth, isAnonymousUser } from "@/lib/auth";
import { getStoreProductForBuy } from "../../actions";
import { getLastPurchaseDefaults } from "@/app/preview/actions";
import { StoreBuyPanel } from "./store-buy-panel";

type Params = Promise<{ slug: string; productId: string }>;

export const dynamic = "force-dynamic";

export default async function StoreProductPage({ params }: { params: Params }) {
  const { slug, productId } = await params;
  const detail = await getStoreProductForBuy(slug, productId);
  if (!detail) notFound();

  const session = await auth.api.getSession({ headers: await headers() });
  // Anonymous (guest) sessions don't count for the buy CTA — purchase needs a
  // real account, same as the published-design buy flow.
  const isLoggedIn = Boolean(session) && !isAnonymousUser(session?.user);

  // Remembered size (#44, §8 Q3) — the blank is fixed here (the organizer
  // chose it), so only the size default applies; the panel validates it
  // against this product's sizes.
  const remembered = await getLastPurchaseDefaults();

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 px-4 py-8">
        <div className="max-w-md mx-auto">
          <Link
            href={`/shop/${slug}`}
            className="text-sm text-text-muted hover:text-foreground"
          >
            ← {detail.storeName}
          </Link>

          <div className="mt-4 aspect-square rounded-lg flex items-center justify-center overflow-hidden border border-border bg-checkerboard">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={detail.imageUrl}
              alt={detail.blankName}
              className="max-w-[80%] max-h-[80%] object-contain"
            />
          </div>

          <h1 className="mt-4 text-lg font-semibold">{detail.blankName}</h1>

          <StoreBuyPanel
            storeSlug={detail.storeSlug}
            productId={detail.productId}
            blankId={detail.blankId}
            fixedPrice={detail.fixedPrice}
            sizes={detail.sizes}
            colors={detail.colors}
            isLoggedIn={isLoggedIn}
            buyable={detail.buyable}
            rememberedSize={remembered?.size ?? null}
          />
        </div>
      </main>
    </div>
  );
}
