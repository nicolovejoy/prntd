/**
 * Shared render-and-cache body behind the image detail page's two mockup
 * actions, `getListingMockup` and `getListingBackMockup`
 * (`src/app/d/actions.ts`, #135 slice 1). Both are gated like the buy itself
 * (`resolveBuyableImage`: a published, visible image for anyone, otherwise
 * only its owner through a live conversation of theirs), so a cross-owner Shop
 * buyer can render a mockup for a listing they don't own.
 *
 * Every call names its source image (#278 slice 4). Auth on the page image
 * stays with the callers; the source is guarded here. This resolves the source
 * image, renders via Printful, uploads to R2, and persists the result on
 * `design.mockupUrls`.
 */
import { db } from "@/lib/db";
import { design as designTable } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { createMockupTask, pollMockupTask } from "@/lib/printful";
import { getBlankOrThrow, getPlacement } from "@/lib/blanks";
import { uploadMockupImage } from "@/lib/r2";
import { mockupCacheKey } from "@/lib/mockup-cache";
import {
  findPlacementRender,
  getDesignImageWithOwner,
} from "@/lib/design-images";
import { placementSourceUsable } from "@/lib/back-sources";

export type RenderMockupParams = {
  designId: string;
  productId: string;
  colorName: string;
  scale: number;
  placementId: string;
  /** The image being printed, or the source the placement render was anchored
   * on. Always set, so the mockup matches the picked image and the cache key
   * doesn't collide across front or back choices. */
  sourceImageId: string;
  /** Requesting user, for the placement-source guard run on every source
   * before any cached mockup or placement render is served. Null for a signed-out visitor to a published image's
   * page, who reaches only published, not-hidden sources through the guard
   * (`canUseAsPlacementSource`, which refuses a hidden image for everyone).
   * The callers have already gated the PAGE image (`resolveBuyableImage`);
   * the guard here is the check on the SOURCE, so a caller that skipped its
   * own source check still can't render a private or hidden image. */
  userId: string | null;
};

export async function renderAndCacheMockup(
  params: RenderMockupParams
): Promise<{ mockupUrl: string }> {
  const { designId, productId, colorName, placementId, sourceImageId, userId } =
    params;

  const found = await db.query.design.findFirst({
    where: eq(designTable.id, designId),
  });
  if (!found) throw new Error("Design not found");

  // The source is judged before anything is served for it. A cached mockup URL
  // and a cached placement render both answer without looking at the source
  // image again, so without this check a source that was cached while it was
  // published (or the caller's own) would keep rendering after it was
  // unpublished or admin-hidden. Every caller passes its own `userId`, and
  // every caller's source is either the caller's own image or a published,
  // visible one, so a legitimate request clears this on every call.
  const source = await getDesignImageWithOwner(sourceImageId);
  if (!source || !(await placementSourceUsable(source, designId, userId ?? ""))) {
    throw new Error("Source image is not available for this design");
  }

  // Clamp scale to valid range
  const clampedScale = Math.max(0.3, Math.min(1.0, params.scale));
  const scaleKey = Math.round(clampedScale * 100);

  // Cache key includes product, placement, scale and the source, so two back
  // (or front) choices don't collide on one key (#25 2.1). The shared builder
  // version-bumps the format (#102) so pre-fix entries — whose URLs point at
  // collided R2 objects — never satisfy a lookup again.
  const cacheKey = mockupCacheKey({
    productId,
    placementId,
    sourceImageId,
    colorName,
    scaleKey,
  });
  const cached = found.mockupUrls?.[cacheKey];
  if (cached) return { mockupUrl: cached };

  // Look up product and variant — use "M" for apparel, first available for other products
  const product = getBlankOrThrow(productId);
  const colorVariants = product.variants[colorName];
  const variantId = colorVariants?.["M"] ?? (colorVariants ? Object.values(colorVariants)[0] : undefined);
  if (!variantId) throw new Error(`No variant for ${colorName} on ${product.name}`);

  const placement = getPlacement(product, placementId);

  // Resolve the image URL to print. Prefer the placement-specific render
  // (products whose aspect differs from the source), anchored on the source
  // that's actually being printed (#138 defect 2): an unfiltered lookup
  // matches ANY render for the product and returns the newest, which serves
  // the wrong artwork once a render of another image exists. With no render
  // row — the case where the source already fits the placement aspect — print
  // the source itself, NOT some other image of the design (a back mockup once
  // showed the front that way). The source may live on another design (#72);
  // it was held to placementSourceUsable above, before any cache could answer.
  const placementRender = await findPlacementRender(
    designId,
    productId,
    placement.id,
    sourceImageId
  );
  const sourceImageUrl = placementRender?.imageUrl ?? source.imageUrl;
  if (!sourceImageUrl) throw new Error("No design image");

  // Compute scaled position (centered within print area)
  const base = placement.mockupPosition;
  const scaledWidth = Math.round(base.width * clampedScale);
  const scaledHeight = Math.round(base.height * clampedScale);
  const scaledPosition = {
    area_width: base.area_width,
    area_height: base.area_height,
    width: scaledWidth,
    height: scaledHeight,
    top: Math.round((base.area_height - scaledHeight) / 2),
    left: Math.round((base.area_width - scaledWidth) / 2),
  };

  // Generate mockup via Printful. Single-variant call uses the same
  // multi-variant API (variant_ids accepts an array).
  const taskKey = await createMockupTask(
    product.printfulProductId,
    [variantId],
    sourceImageUrl,
    scaledPosition,
    placement.id
  );
  const results = await pollMockupTask(taskKey);
  const tempUrl = results[0]?.mockupUrl;
  if (!tempUrl) throw new Error("Mockup completed but no URL");

  // Download and persist to R2
  const response = await fetch(tempUrl);
  const buffer = Buffer.from(await response.arrayBuffer());
  const r2Url = await uploadMockupImage(designId, buffer, {
    productId,
    placementId: placement.id,
    sourceImageId,
    colorName,
    scaleKey,
  });

  // Re-read before update to avoid clobbering concurrent renders
  const fresh = await db.query.design.findFirst({
    where: eq(designTable.id, designId),
    columns: { mockupUrls: true, primaryImageId: true },
  });
  // The new entry is keyed on its source image, so it is always stored under
  // `cacheKey`: a generation claiming the primary doesn't change what this
  // render shows. Older entries with no source segment can still be in
  // `mockup_urls`; they are spread back untouched here, and only a
  // generation's clear removes them.
  const updatedMockups = { ...(fresh?.mockupUrls ?? {}), [cacheKey]: r2Url };
  // Conditional on the primary still being the one just read, in one
  // statement: a generation that commits between the read and this write
  // clears `mockup_urls`, and the write must not bring the cleared entries
  // back. It becomes a no-op instead. The URL is returned either way.
  await db
    .update(designTable)
    .set({ mockupUrls: updatedMockups, updatedAt: new Date() })
    .where(
      and(
        eq(designTable.id, designId),
        fresh?.primaryImageId
          ? eq(designTable.primaryImageId, fresh.primaryImageId)
          : isNull(designTable.primaryImageId)
      )
    );

  return { mockupUrl: r2Url };
}
