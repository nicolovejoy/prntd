import { db } from "@/lib/db";
import { designImage as designImageTable } from "@/lib/db/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import type { AspectRatio } from "@/lib/products";

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
