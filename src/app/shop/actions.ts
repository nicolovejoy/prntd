"use server";

import { headers } from "next/headers";
import { eq, inArray } from "drizzle-orm";
import { auth, isAnonymousUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { storesEnabled } from "@/lib/flags";
import * as svc from "@/lib/store-service";
import { canViewStore, canBuyStoreProduct, productIsListed } from "@/lib/stores";
import {
  design as designTable,
  designImage as designImageTable,
} from "@/lib/db/schema";
import {
  getBlank,
  getColorHex,
  type AspectRatio,
  type BlankColor,
} from "@/lib/blanks";
import { computePrice, computeOrderTotal } from "@/lib/pricing";
import { createStripeCheckoutForOrder } from "../order/actions";

/** The item price the customer sees: the organizer's override, else the
 * computed default for the blank at size M. */
function itemPriceFor(blankId: string, price: number | null): number {
  return price ?? computePrice(0, blankId, "M").total;
}

/** Resolve a product's printed image id (front placement, else design primary). */
async function resolveProductImageId(
  placements: Record<string, string> | null,
  designId: string
): Promise<string | null> {
  const placed = placements ? Object.values(placements)[0] : undefined;
  if (placed) return placed;
  const [d] = await db
    .select({ primaryImageId: designTable.primaryImageId })
    .from(designTable)
    .where(eq(designTable.id, designId));
  return d?.primaryImageId ?? null;
}

export type StorefrontProduct = {
  id: string;
  blankId: string;
  blankName: string;
  imageUrl: string;
  /** The blank's first color, for the card backdrop. */
  bgHex: string;
  /** Customer's all-in price (item + shipping). */
  total: number;
};

export type Storefront = {
  slug: string;
  name: string;
  description: string | null;
  accentColor: string | null;
  isOwner: boolean;
  products: StorefrontProduct[];
};

/**
 * A store's public storefront by slug. Null when stores are off, the slug is
 * unknown, or the viewer can't see it (draft/hidden are owner-only). The owner
 * previewing sees every product state; the public sees only `listed`.
 */
export async function getStorefront(slug: string): Promise<Storefront | null> {
  if (!storesEnabled()) return null;
  const session = await auth.api.getSession({ headers: await headers() });
  const viewer = session?.user ?? null;

  const store = await svc.getStoreBySlug(db, slug);
  if (!store || !canViewStore(store, viewer)) return null;
  const isOwner = !!viewer && viewer.id === store.ownerId;

  const all = await svc.getStoreProducts(db, store.id);
  const visible = all.filter((p) => isOwner || productIsListed(p));

  // Batch-resolve placement images.
  const imageIds = visible
    .map((p) => (p.placements ? Object.values(p.placements)[0] : undefined))
    .filter((id): id is string => Boolean(id));
  const imgs = imageIds.length
    ? await db
        .select({ id: designImageTable.id, imageUrl: designImageTable.imageUrl })
        .from(designImageTable)
        .where(inArray(designImageTable.id, imageIds))
    : [];
  const urlById = new Map(imgs.map((r) => [r.id, r.imageUrl]));

  const products: StorefrontProduct[] = visible.flatMap((p) => {
    const imageId = p.placements ? Object.values(p.placements)[0] : undefined;
    const imageUrl = imageId ? urlById.get(imageId) : undefined;
    if (!imageUrl) return [];
    const blank = getBlank(p.blankId);
    return [
      {
        id: p.id,
        blankId: p.blankId,
        blankName: blank?.name ?? p.blankId,
        imageUrl,
        bgHex: getColorHex(p.blankId, blank?.colors[0]?.name),
        total: computeOrderTotal(itemPriceFor(p.blankId, p.price)).total,
      },
    ];
  });

  return {
    slug: store.slug,
    name: store.name,
    description: store.description,
    accentColor: store.accentColor,
    isOwner,
    products,
  };
}

export type StoreProductDetail = {
  storeSlug: string;
  storeName: string;
  accentColor: string | null;
  productId: string;
  blankId: string;
  blankName: string;
  imageUrl: string;
  aspectRatio: AspectRatio;
  sizes: string[];
  colors: BlankColor[];
  /** Organizer override; null = price computed per size client-side. */
  fixedPrice: number | null;
  /** False when the product/store isn't in a buyable state (owner preview). */
  buyable: boolean;
};

/** One product's detail for the buy page. Null if not viewable (same rules). */
export async function getStoreProductForBuy(
  slug: string,
  productId: string
): Promise<StoreProductDetail | null> {
  if (!storesEnabled()) return null;
  const session = await auth.api.getSession({ headers: await headers() });
  const viewer = session?.user ?? null;

  const store = await svc.getStoreBySlug(db, slug);
  if (!store || !canViewStore(store, viewer)) return null;
  const isOwner = !!viewer && viewer.id === store.ownerId;

  const product = await svc.getProductById(db, productId);
  if (!product || product.storeId !== store.id) return null;
  // Public can only land on a listed product; the owner can preview any.
  if (!isOwner && !productIsListed(product)) return null;

  const imageId = await resolveProductImageId(product.placements, product.designId);
  if (!imageId) return null;
  const [img] = await db
    .select({
      imageUrl: designImageTable.imageUrl,
      aspectRatio: designImageTable.aspectRatio,
    })
    .from(designImageTable)
    .where(eq(designImageTable.id, imageId));
  if (!img) return null;

  const blank = getBlank(product.blankId);
  return {
    storeSlug: store.slug,
    storeName: store.name,
    accentColor: store.accentColor,
    productId: product.id,
    blankId: product.blankId,
    blankName: blank?.name ?? product.blankId,
    imageUrl: img.imageUrl,
    aspectRatio: img.aspectRatio as AspectRatio,
    sizes: blank?.sizes ?? [],
    colors: blank?.colors ?? [],
    fixedPrice: product.price,
    buyable: canBuyStoreProduct(product, store),
  };
}

/**
 * Buy a storefront product. Browsing is open; this is the gated point — an
 * anonymous/signed-out shopper is sent to sign-in (the guest-funnel model).
 * The sale attributes to the store + organizer product so a later payout phase
 * can sum proceeds. Reuses the shared checkout choke point.
 */
export async function buyStoreProduct(params: {
  storeProductId: string;
  size: string;
  color: string;
}): Promise<{ url: string | null; needsAuth?: boolean; error?: string }> {
  if (!storesEnabled()) return { url: null, error: "Stores are not enabled" };

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || isAnonymousUser(session.user)) {
    return { url: null, needsAuth: true };
  }

  const product = await svc.getProductById(db, params.storeProductId);
  if (!product || !product.storeId) return { url: null, error: "Product not found" };
  const store = await svc.getStoreById(db, product.storeId);
  if (!store || !canBuyStoreProduct(product, store)) {
    return { url: null, error: "This product isn't available to buy" };
  }

  const imageId = await resolveProductImageId(product.placements, product.designId);
  const [img] = imageId
    ? await db
        .select({ imageUrl: designImageTable.imageUrl })
        .from(designImageTable)
        .where(eq(designImageTable.id, imageId))
    : [];

  return createStripeCheckoutForOrder({
    userId: session.user.id,
    designId: product.designId,
    productId: product.blankId,
    size: params.size,
    color: params.color,
    itemPrice: itemPriceFor(product.blankId, product.price),
    placements: product.placements,
    checkoutImageUrl: img?.imageUrl ?? null,
    cancelUrl: `/shop/${store.slug}/${product.id}`,
    storeId: store.id,
    storeProductId: product.id,
  });
}
