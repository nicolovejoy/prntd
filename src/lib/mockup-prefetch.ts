import { db } from "@/lib/db";
import { design as designTable } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createMockupTask, pollMockupTask } from "@/lib/printful";
import { getBlank, getPlacement, DEFAULT_BLANK_ID } from "@/lib/blanks";
import { uploadMockupImage } from "@/lib/r2";
import { mockupCacheKey } from "@/lib/mockup-cache";
import {
  findPlacementRender,
  getDesignDisplayImageUrl,
} from "@/lib/design-images";

/**
 * Pre-fetch Printful mockups for every color of a product, best-effort.
 * Scheduled via after() by `ensureMockupsPrefetched`
 * (src/app/preview/actions.ts), which /preview calls on page load after
 * checking that the viewer owns the design. Printful mockup tasks are free;
 * only wall time costs.
 *
 * Issues a single multi-variant Printful task instead of one task per
 * color. One API round trip, one DB write at the end — no read-modify-
 * write race against concurrent on-demand mockup writes.
 *
 * Never throws to the caller; failures are logged and the function
 * returns without populating (or partially populating) the cache.
 *
 * Does no auth or ownership check on designId; callers must do it (#251).
 */
export async function prefetchProductMockups(
  designId: string,
  productId: string = DEFAULT_BLANK_ID
): Promise<void> {
  const startedAt = Date.now();
  const product = getBlank(productId);
  if (!product) {
    console.warn(`prefetchProductMockups: unknown product ${productId}`);
    return;
  }

  try {
    const found = await db.query.design.findFirst({
      where: eq(designTable.id, designId),
    });
    if (!found) {
      console.warn(`prefetchProductMockups: design ${designId} not found`);
      return;
    }

    // Prefetch stays front-only — back renders on demand so we don't
    // double the bulk mockup cost for the phone-first front path.
    const placement = getPlacement(product, "front");

    // Resolve the source image — same priority as generateMockup: prefer
    // the placement-specific render, fall back to the design's primary
    // image (resolved via primary_image_id, latest source as backup).
    // Anchored on the primary (#138 defect 2): prefetch warms the DEFAULT
    // front, so a render of some other pinned front must not satisfy it.
    const placementRender = await findPlacementRender(
      designId,
      productId,
      placement.id,
      found.primaryImageId ?? undefined
    );
    const sourceImageUrl =
      placementRender?.imageUrl ?? (await getDesignDisplayImageUrl(designId));
    if (!sourceImageUrl) {
      console.warn(`prefetchProductMockups: design ${designId} has no image`);
      return;
    }

    // Build the (color, variantId) list. Use size "M" for apparel, first
    // available variant for products without an "M" (e.g. phone cases).
    const variantToColor = new Map<number, string>();
    for (const color of product.colors) {
      const sizeMap = product.variants[color.name];
      const variantId =
        sizeMap?.["M"] ?? (sizeMap ? Object.values(sizeMap)[0] : undefined);
      if (variantId) variantToColor.set(variantId, color.name);
    }
    if (variantToColor.size === 0) return;

    // Use the same scaled position the on-demand path uses at scale 1.0.
    const base = placement.mockupPosition;
    const scaledPosition = {
      area_width: base.area_width,
      area_height: base.area_height,
      width: base.width,
      height: base.height,
      top: base.top,
      left: base.left,
    };

    const taskKey = await createMockupTask(
      product.printfulProductId,
      Array.from(variantToColor.keys()),
      sourceImageUrl,
      scaledPosition,
      placement.id
    );
    // Bigger window — bulk tasks render N variants and may take longer
    // than the on-demand single-variant default.
    const results = await pollMockupTask(taskKey, { timeoutMs: 180000 });

    // Download each mockup to R2 in parallel — these don't touch the
    // design row, so no race here.
    const newEntries: Record<string, string> = {};
    await Promise.all(
      results.map(async (r) => {
        const colorName = r.variantIds
          .map((v) => variantToColor.get(v))
          .find((c): c is string => Boolean(c));
        if (!colorName) return;
        try {
          const response = await fetch(r.mockupUrl);
          if (!response.ok) throw new Error(`fetch ${response.status}`);
          const buffer = Buffer.from(await response.arrayBuffer());
          const parts = {
            productId,
            placementId: "front",
            colorName,
            scaleKey: 100,
          };
          const r2Url = await uploadMockupImage(designId, buffer, parts);
          newEntries[mockupCacheKey(parts)] = r2Url;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(
            `prefetchProductMockups: r2 upload failed color=${colorName}: ${msg}`
          );
        }
      })
    );

    if (Object.keys(newEntries).length === 0) return;

    // Single read-modify-write at the end. The window is small enough
    // that an on-demand mockup write landing in this gap would just
    // overwrite a few keys we'd have populated — acceptable.
    const fresh = await db.query.design.findFirst({
      where: eq(designTable.id, designId),
      columns: { mockupUrls: true },
    });
    const merged = { ...(fresh?.mockupUrls ?? {}), ...newEntries };
    await db
      .update(designTable)
      .set({ mockupUrls: merged, updatedAt: new Date() })
      .where(eq(designTable.id, designId));

    console.log(
      `prefetchProductMockups: design=${designId} product=${productId} cached=${Object.keys(newEntries).length}/${variantToColor.size} elapsed=${Date.now() - startedAt}ms`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `prefetchProductMockups: design=${designId} product=${productId} failed: ${msg} elapsed=${Date.now() - startedAt}ms`
    );
  }
}
