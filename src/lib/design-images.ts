import { db } from "@/lib/db";
import { designImage as designImageTable } from "@/lib/db/schema";
import { eq, and, asc, desc, inArray, isNull, isNotNull } from "drizzle-orm";
import { getProduct, type AspectRatio } from "@/lib/products";

/**
 * Insert a new design_image row for a generation. Automatically links
 * `parentImageId` to the most recent existing image for the same design,
 * forming the provenance chain.
 */
export async function insertDesignImage(params: {
  designId: string;
  imageUrl: string;
  aspectRatio: AspectRatio;
  prompt?: string | null;
  generationCost: number;
  productId?: string | null;
  placementId?: string | null;
}): Promise<string> {
  const latest = await db
    .select({ id: designImageTable.id })
    .from(designImageTable)
    .where(eq(designImageTable.designId, params.designId))
    .orderBy(desc(designImageTable.createdAt))
    .limit(1);

  const id = crypto.randomUUID();
  await db.insert(designImageTable).values({
    id,
    designId: params.designId,
    parentImageId: latest[0]?.id ?? null,
    aspectRatio: params.aspectRatio,
    productId: params.productId ?? null,
    placementId: params.placementId ?? null,
    imageUrl: params.imageUrl,
    prompt: params.prompt ?? null,
    generationCost: params.generationCost,
    isApproved: false,
  });
  return id;
}

/**
 * Look up an existing placement-targeted render for a design. Used as
 * a cache-hit short-circuit so re-clicking the same product doesn't
 * re-spend Replicate credits.
 *
 * Returns the most recent matching row (latest wins if there are
 * multiple, which can happen if an earlier rewrite landed before
 * dedup was in place).
 */
export async function findPlacementRender(
  designId: string,
  productId: string,
  placementId: string
): Promise<{ id: string; imageUrl: string; aspectRatio: AspectRatio } | null> {
  const rows = await db
    .select({
      id: designImageTable.id,
      imageUrl: designImageTable.imageUrl,
      aspectRatio: designImageTable.aspectRatio,
    })
    .from(designImageTable)
    .where(
      and(
        eq(designImageTable.designId, designId),
        eq(designImageTable.productId, productId),
        eq(designImageTable.placementId, placementId)
      )
    )
    .orderBy(desc(designImageTable.createdAt))
    .limit(1);
  if (!rows[0]) return null;
  return {
    id: rows[0].id,
    imageUrl: rows[0].imageUrl,
    aspectRatio: rows[0].aspectRatio as AspectRatio,
  };
}

/**
 * Fetch a single design_image by id. Returns null if not found.
 */
export async function getDesignImageById(
  id: string
): Promise<{
  id: string;
  designId: string;
  imageUrl: string;
  aspectRatio: AspectRatio;
  prompt: string | null;
} | null> {
  const rows = await db
    .select({
      id: designImageTable.id,
      designId: designImageTable.designId,
      imageUrl: designImageTable.imageUrl,
      aspectRatio: designImageTable.aspectRatio,
      prompt: designImageTable.prompt,
    })
    .from(designImageTable)
    .where(eq(designImageTable.id, id))
    .limit(1);
  if (!rows[0]) return null;
  return {
    id: rows[0].id,
    designId: rows[0].designId,
    imageUrl: rows[0].imageUrl,
    aspectRatio: rows[0].aspectRatio as AspectRatio,
    prompt: rows[0].prompt,
  };
}

/**
 * Find the design_image row whose imageUrl matches a target URL, scoped
 * to a design. Used at order-creation time to pin the order to the
 * specific image that was on screen when the customer clicked checkout.
 * Returns null if no matching row (e.g. pre-Phase-2 designs that haven't
 * been backfilled).
 */
export async function findDesignImageByUrl(
  designId: string,
  imageUrl: string
): Promise<string | null> {
  const rows = await db
    .select({ id: designImageTable.id })
    .from(designImageTable)
    .where(
      and(
        eq(designImageTable.designId, designId),
        eq(designImageTable.imageUrl, imageUrl)
      )
    )
    .orderBy(desc(designImageTable.createdAt))
    .limit(1);
  return rows[0]?.id ?? null;
}

/**
 * Resolve the image URL to display for a list of orders. Prefers each
 * order's `placements.front` (a design_image id snapshot from purchase
 * time) over the current design.currentImageUrl, so historical orders
 * keep showing what was actually printed even if the design was
 * regenerated afterward.
 *
 * Falls back to the provided fallback map (designId → currentImageUrl)
 * when the order has no placements or the referenced design_image is
 * gone.
 */
export async function resolveOrderImageUrls(
  orders: { id: string; designId: string; placements: Record<string, string> | null }[],
  fallback: Map<string, string | null>
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();

  const imageIds = orders
    .map((o) => o.placements?.front)
    .filter((v): v is string => Boolean(v));

  const imageRows =
    imageIds.length > 0
      ? await db
          .select({ id: designImageTable.id, imageUrl: designImageTable.imageUrl })
          .from(designImageTable)
          .where(inArray(designImageTable.id, imageIds))
      : [];
  const byId = new Map(imageRows.map((r) => [r.id, r.imageUrl]));

  for (const o of orders) {
    const pinned = o.placements?.front ? byId.get(o.placements.front) : undefined;
    out.set(o.id, pinned ?? fallback.get(o.designId) ?? null);
  }
  return out;
}

export type SourceImage = {
  id: string;
  imageUrl: string;
  aspectRatio: AspectRatio;
  createdAt: Date;
};

/**
 * Fetch all source images for a design (rows with product_id IS NULL —
 * the exploratory 1:1 generations and user uploads). Ordered oldest →
 * newest so the chat-thread gallery scrolls forward in time.
 */
export async function getDesignSourceImages(
  designId: string
): Promise<SourceImage[]> {
  const rows = await db
    .select({
      id: designImageTable.id,
      imageUrl: designImageTable.imageUrl,
      aspectRatio: designImageTable.aspectRatio,
      createdAt: designImageTable.createdAt,
    })
    .from(designImageTable)
    .where(
      and(
        eq(designImageTable.designId, designId),
        isNull(designImageTable.productId)
      )
    )
    .orderBy(asc(designImageTable.createdAt));

  return rows.map((r) => ({
    id: r.id,
    imageUrl: r.imageUrl,
    aspectRatio: r.aspectRatio as AspectRatio,
    createdAt: r.createdAt,
  }));
}

export type ProductVersion = {
  id: string;
  imageUrl: string;
  aspectRatio: AspectRatio;
  placementId: string;
  createdAt: Date;
};

export type ProductVersionGroup = {
  productId: string;
  productName: string;
  images: ProductVersion[];
};

/**
 * Fetch placement-targeted renders for a design (rows with non-null
 * product_id), grouped by product. Each group's `images` is ordered
 * oldest → newest. Products with no renders for this design are
 * omitted entirely.
 */
export async function getDesignPlacementRenders(
  designId: string
): Promise<ProductVersionGroup[]> {
  const rows = await db
    .select({
      id: designImageTable.id,
      imageUrl: designImageTable.imageUrl,
      aspectRatio: designImageTable.aspectRatio,
      productId: designImageTable.productId,
      placementId: designImageTable.placementId,
      createdAt: designImageTable.createdAt,
    })
    .from(designImageTable)
    .where(
      and(
        eq(designImageTable.designId, designId),
        isNotNull(designImageTable.productId)
      )
    )
    .orderBy(asc(designImageTable.createdAt));

  const byProduct = new Map<string, ProductVersionGroup>();
  for (const r of rows) {
    if (!r.productId) continue;
    let group = byProduct.get(r.productId);
    if (!group) {
      const product = getProduct(r.productId);
      group = {
        productId: r.productId,
        productName: product?.name ?? r.productId,
        images: [],
      };
      byProduct.set(r.productId, group);
    }
    group.images.push({
      id: r.id,
      imageUrl: r.imageUrl,
      aspectRatio: r.aspectRatio as AspectRatio,
      placementId: r.placementId ?? "default",
      createdAt: r.createdAt,
    });
  }
  return Array.from(byProduct.values());
}

/**
 * Delete a design_image row. Returns the id that should become the
 * design's new primary_image_id (the most recent remaining source
 * image), or null if there are no source images left. Caller is
 * responsible for updating design.primary_image_id and
 * design.currentImageUrl.
 */
export async function deleteDesignImageRow(
  designId: string,
  imageId: string
): Promise<{ newPrimaryId: string | null; newPrimaryUrl: string | null }> {
  await db
    .delete(designImageTable)
    .where(
      and(
        eq(designImageTable.id, imageId),
        eq(designImageTable.designId, designId)
      )
    );

  const remaining = await db
    .select({
      id: designImageTable.id,
      imageUrl: designImageTable.imageUrl,
    })
    .from(designImageTable)
    .where(
      and(
        eq(designImageTable.designId, designId),
        isNull(designImageTable.productId)
      )
    )
    .orderBy(desc(designImageTable.createdAt))
    .limit(1);

  return {
    newPrimaryId: remaining[0]?.id ?? null,
    newPrimaryUrl: remaining[0]?.imageUrl ?? null,
  };
}
