"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { and, desc, eq, inArray, not } from "drizzle-orm";
import { auth, isAnonymousUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { storesEnabled } from "@/lib/flags";
import { storeShareUrl } from "@/lib/stores";
import * as svc from "@/lib/store-service";
import {
  store as storeTable,
  product as productTable,
  design as designTable,
  designImage as designImageTable,
} from "@/lib/db/schema";
import { getBlank, type AspectRatio } from "@/lib/blanks";

type Store = typeof storeTable.$inferSelect;
type Product = typeof productTable.$inferSelect;

/** Client-readable: whether the Dashboard nav link + routes should show. */
export async function isStoresEnabled(): Promise<boolean> {
  return storesEnabled();
}

function assertEnabled() {
  if (!storesEnabled()) throw new Error("Stores are not enabled");
}

async function requireUserId(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");
  return session.user.id;
}

/** Build the public share origin from the request, NOT NEXT_PUBLIC_APP_URL. */
async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export type DashboardProduct = {
  id: string;
  blankId: string;
  blankName: string;
  price: number | null;
};
export type DashboardStore = Store & {
  shareUrl: string;
  productCount: number;
  products: DashboardProduct[];
};

/** The organizer's stores with share links + their products for the back office. */
export async function getDashboard(): Promise<DashboardStore[]> {
  if (!storesEnabled()) return [];
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return [];
  const [stores, origin] = await Promise.all([
    svc.getMyStores(db, session.user.id),
    requestOrigin(),
  ]);
  return Promise.all(
    stores.map(async (s) => {
      const rows = await svc.getStoreProducts(db, s.id);
      const products: DashboardProduct[] = rows.map((p) => ({
        id: p.id,
        blankId: p.blankId,
        blankName: getBlank(p.blankId)?.name ?? p.blankId,
        price: p.price,
      }));
      return {
        ...s,
        shareUrl: storeShareUrl(s.slug, origin),
        productCount: products.length,
        products,
      };
    })
  );
}

export async function createStore(input: {
  name: string;
  description?: string;
  accentColor?: string;
}): Promise<DashboardStore> {
  assertEnabled();
  const ownerId = await requireUserId();
  const store = await svc.createStore(db, ownerId, input);
  revalidatePath("/dashboard");
  const origin = await requestOrigin();
  return { ...store, shareUrl: storeShareUrl(store.slug, origin), productCount: 0, products: [] };
}

export async function updateStore(
  storeId: string,
  patch: svc.UpdateStoreInput
): Promise<Store> {
  assertEnabled();
  const ownerId = await requireUserId();
  const updated = await svc.updateStore(db, ownerId, storeId, patch);
  revalidatePath("/dashboard");
  return updated;
}

// --- product compose ---

export type ComposableDesign = {
  designId: string;
  /** The design's primary `design_image` id — the value stored in placements. */
  imageId: string;
  imageUrl: string;
  aspectRatio: AspectRatio;
};

/**
 * The organizer's own designs that have artwork — the compose picker's source
 * (slice 2 = "A", own designs only; published-design support is a later,
 * additive source). Each carries its primary image's url + aspect so the form
 * can preview it and run the client-side validity check.
 */
export async function getComposableDesigns(): Promise<ComposableDesign[]> {
  if (!storesEnabled()) return [];
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || isAnonymousUser(session.user)) return [];

  const designs = await db.query.design.findMany({
    where: and(
      eq(designTable.userId, session.user.id),
      not(eq(designTable.status, "archived"))
    ),
    orderBy: desc(designTable.updatedAt),
    columns: { id: true, primaryImageId: true },
  });

  const primaryIds = designs
    .map((d) => d.primaryImageId)
    .filter((id): id is string => id !== null);
  if (primaryIds.length === 0) return [];

  const imgs = await db
    .select({
      id: designImageTable.id,
      imageUrl: designImageTable.imageUrl,
      aspectRatio: designImageTable.aspectRatio,
    })
    .from(designImageTable)
    .where(inArray(designImageTable.id, primaryIds));
  const byId = new Map(imgs.map((r) => [r.id, r]));

  return designs.flatMap((d) => {
    const img = d.primaryImageId ? byId.get(d.primaryImageId) : undefined;
    if (!img) return [];
    return [
      {
        designId: d.id,
        imageId: img.id,
        imageUrl: img.imageUrl,
        aspectRatio: img.aspectRatio as AspectRatio,
      },
    ];
  });
}

export type CreateProductDraftInput = {
  designId: string;
  blankId: string;
  storeId?: string | null;
  placements?: Record<string, string> | null;
  price?: number | null;
};

export async function createProductDraft(
  input: CreateProductDraftInput
): Promise<Product> {
  assertEnabled();
  const ownerId = await requireUserId();
  const product = await svc.createProduct(db, ownerId, input);
  revalidatePath("/dashboard");
  return product;
}

export async function saveProduct(
  productId: string,
  patch: svc.UpdateProductInput
): Promise<Product> {
  assertEnabled();
  const ownerId = await requireUserId();
  const updated = await svc.updateProduct(db, ownerId, productId, patch);
  revalidatePath("/dashboard");
  return updated;
}

/** Owner-scoped product fetch for the edit form. Null if missing or not theirs. */
export async function getProductDraft(productId: string): Promise<Product | null> {
  if (!storesEnabled()) return null;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const product = await svc.getProductById(db, productId);
  if (!product || product.ownerId !== session.user.id) return null;
  return product;
}

export type EditableProduct = {
  id: string;
  storeId: string | null;
  blankId: string;
  placements: Record<string, string>;
  price: number | null;
  status: Product["status"];
  /** The fixed design behind this product, for the compose form's preview + fit. */
  design: ComposableDesign;
};

/**
 * Owner-scoped product fetch hydrated with its design's primary image, so the
 * edit form can preview + run the client-side validity check the same way the
 * new-product form does. Null if missing, not theirs, or its design lost its
 * artwork. The design itself is fixed on a product — only blank/placement/price
 * are editable (see svc.updateProduct).
 */
export async function getProductForEdit(
  productId: string
): Promise<EditableProduct | null> {
  if (!storesEnabled()) return null;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const product = await svc.getProductById(db, productId);
  if (!product || product.ownerId !== session.user.id) return null;

  // Resolve the placed image (placements value, else the design's primary).
  const placements = product.placements ?? {};
  const placedImageId = Object.values(placements)[0];
  const [d] = await db
    .select({ primaryImageId: designTable.primaryImageId })
    .from(designTable)
    .where(eq(designTable.id, product.designId));
  const imageId = placedImageId ?? d?.primaryImageId ?? null;
  if (!imageId) return null;

  const [img] = await db
    .select({
      id: designImageTable.id,
      imageUrl: designImageTable.imageUrl,
      aspectRatio: designImageTable.aspectRatio,
    })
    .from(designImageTable)
    .where(eq(designImageTable.id, imageId));
  if (!img) return null;

  return {
    id: product.id,
    storeId: product.storeId,
    blankId: product.blankId,
    placements,
    price: product.price,
    status: product.status,
    design: {
      designId: product.designId,
      imageId: img.id,
      imageUrl: img.imageUrl,
      aspectRatio: img.aspectRatio as AspectRatio,
    },
  };
}
