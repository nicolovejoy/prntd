/**
 * Shared render-and-cache body behind two mockup actions:
 *
 *  - `generateMockup` (`src/app/preview/actions.ts`) — owner-gated, the
 *    design-your-own flow.
 *  - `getListingMockup` and `getListingBackMockup` (`src/app/d/actions.ts`,
 *    #135 slice 1) — gated like the buy itself (`resolveBuyableImage`: a
 *    published, visible image for anyone, otherwise only its owner through a
 *    live conversation of theirs), so a cross-owner Shop buyer can render a
 *    mockup for a listing they don't own.
 *
 * Auth stays with the callers; this only resolves the source image,
 * renders via Printful, uploads to R2, and persists the result on
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
  getDesignDisplayImageUrl,
} from "@/lib/design-images";
import { canUseAsPlacementSource } from "@/lib/design-publish";

export type RenderMockupParams = {
  designId: string;
  productId: string;
  colorName: string;
  scale: number;
  placementId: string;
  /** Source image the placement render was anchored on. Required for a
   * non-front placement so the mockup matches the picked source and the
   * cache key doesn't collide across back choices. */
  sourceImageId?: string;
  /** Requesting user, for the cross-design placement-source guard exercised
   * when an explicit source has no placement-render row yet (a fresh /
   * cross-design pick). Null for a signed-out visitor to a published image's
   * page, who reaches only published, not-hidden sources through the guard
   * (`canUseAsPlacementSource`, which refuses a hidden image for everyone).
   * The callers have already gated the PAGE image (ownership for `/preview`,
   * `resolveBuyableImage` for the image detail page); the guard here is the
   * check on an explicit SOURCE, so a caller that skipped its own source check
   * still can't render a private or hidden image. */
  userId: string | null;
  /** /preview only (`generateMockup`): treat a front source equal to the
   * design's primary AT THIS READ as the default front (source-less cache key
   * and R2 key). Off for every other caller, whose source-keyed front entries
   * (the /d buy page) must keep their keys. Decided here, from the row this
   * call reads, so it can't disagree with the anchor resolved below. */
  foldPrimaryFront?: boolean;
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

  // Clamp scale to valid range
  const clampedScale = Math.max(0.3, Math.min(1.0, params.scale));
  const scaleKey = Math.round(clampedScale * 100);

  // Cache key includes product, placement, scale, and (for non-front) the
  // source pick so two back choices don't collide on one key (#25 2.1). The
  // shared builder version-bumps the format (#102) so pre-fix entries — whose
  // URLs point at collided R2 objects — never satisfy a lookup again.
  const keySourceId =
    params.foldPrimaryFront &&
    placementId === "front" &&
    sourceImageId === found.primaryImageId
      ? undefined
      : sourceImageId;
  const cacheKey = mockupCacheKey({
    productId,
    placementId,
    sourceImageId: keySourceId,
    colorName,
    scaleKey,
  });
  // The image this render prints: the explicit source, else the primary read
  // above. The write-back below holds the cache to it.
  const renderedImageId = sourceImageId ?? found.primaryImageId ?? null;
  const cached = found.mockupUrls?.[cacheKey];
  if (cached) return { mockupUrl: cached };

  // Look up product and variant — use "M" for apparel, first available for other products
  const product = getBlankOrThrow(productId);
  const colorVariants = product.variants[colorName];
  const variantId = colorVariants?.["M"] ?? (colorVariants ? Object.values(colorVariants)[0] : undefined);
  if (!variantId) throw new Error(`No variant for ${colorName} on ${product.name}`);

  const placement = getPlacement(product, placementId);

  // Resolve the image URL to print. Prefer the placement-specific render
  // (products whose aspect differs from the source). With an explicit source
  // (#25 non-front) and no render row — the case where the source already fits
  // the placement aspect, so getOrCreatePlacementRender returned it directly —
  // print that source, NOT the design's display image (which is the front;
  // using it made a back mockup show the front). Front (no source) keeps the
  // legacy display-image fallback.
  // Anchor the lookup on the source that's actually being printed — the
  // explicit pick, or the design's primary when there is none (#138 defect
  // 2). An unfiltered front lookup matches ANY front render for the product
  // and returns the newest, which serves the wrong artwork once a
  // non-primary front render exists.
  const placementRender = await findPlacementRender(
    designId,
    productId,
    placement.id,
    sourceImageId ?? found.primaryImageId ?? undefined
  );
  let sourceImageUrl = placementRender?.imageUrl ?? null;
  if (!sourceImageUrl && sourceImageId) {
    // Explicit source pick — may live on another design (#72). Same guard as
    // getOrCreatePlacementRender so an arbitrary id can't be mocked up.
    const source = await getDesignImageWithOwner(sourceImageId);
    if (
      source &&
      canUseAsPlacementSource({
        image: source,
        imageOwnerId: source.ownerId,
        orderDesignId: designId,
        userId: userId ?? "",
      })
    ) {
      sourceImageUrl = source.imageUrl;
    }
  } else if (!sourceImageUrl) {
    sourceImageUrl = await getDesignDisplayImageUrl(designId);
  }
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
  // multi-variant API (variant_ids accepts an array); bulk callers like
  // prefetchProductMockups pass the full set in one task.
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
    sourceImageId: keySourceId,
    colorName,
    scaleKey,
  });

  // Re-read before update to avoid clobbering concurrent preloads
  const fresh = await db.query.design.findFirst({
    where: eq(designTable.id, designId),
    columns: { mockupUrls: true, primaryImageId: true },
  });
  // A generation claiming the primary clears mockup_urls. A default
  // (source-less) entry means "the primary's render", so it may only be
  // written while the primary is still the image rendered; otherwise store it
  // under the source-keyed form, which is exactly the key a pinned request
  // for that image reads.
  const storeKey =
    keySourceId === undefined &&
    renderedImageId &&
    fresh?.primaryImageId !== renderedImageId
      ? mockupCacheKey({
          productId,
          placementId,
          sourceImageId: renderedImageId,
          colorName,
          scaleKey,
        })
      : cacheKey;
  const updatedMockups = { ...(fresh?.mockupUrls ?? {}), [storeKey]: r2Url };
  // Conditional on the primary still being the one just read, in one
  // statement: a generation committing between the read and this write makes
  // it a no-op instead of resurrecting stale entries over its clear. The URL
  // is returned either way.
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
