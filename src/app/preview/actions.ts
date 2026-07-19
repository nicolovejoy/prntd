"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import { auth, isAnonymousUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { design as designTable } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createMockupTask, pollMockupTask } from "@/lib/printful";
import {
  getBlank,
  getBlankOrThrow,
  getPlacement,
  multiPlacementEnabled,
  needsAspectRegeneration,
  DEFAULT_BLANK_ID,
  type AspectRatio,
} from "@/lib/blanks";
import { uploadMockupImage, uploadDesignImage } from "@/lib/r2";
import { generateAnchoredTransparent } from "@/lib/replicate";
import {
  insertDesignImage,
  findPlacementRender,
  getDesignImageWithOwner,
  getDesignDisplayImageUrl,
} from "@/lib/design-images";
import { canUseAsPlacementSource } from "@/lib/design-publish";
import {
  getBackSourceGroups,
  type BackSourceGroup,
} from "@/lib/back-sources";
import { resolveLastPurchaseDefaults } from "@/lib/last-purchase";
import type { PurchaseDefaults } from "@/lib/purchase-defaults";

const COST_PER_GENERATION = 0.03;

/**
 * Expose the server-side multi-placement kill-switch to client components.
 * `/preview` and `/order` call this once on mount to decide whether to honor
 * back-design UI / a `back` URL param. Off by default (#25, until 2.5).
 */
export async function isMultiPlacementEnabled(): Promise<boolean> {
  return multiPlacementEnabled();
}

/**
 * Source groups for the /preview back-design picker (#72): the current
 * thread's images, the user's other designs' display images, and published
 * Shop images. Anonymous guests get This design + Shop only — their other
 * designs join My Designs once they claim the account.
 */
export async function getBackDesignSources(
  designId: string
): Promise<{ groups: BackSourceGroup[] }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const found = await db.query.design.findFirst({
    where: eq(designTable.id, designId),
    columns: { id: true, userId: true },
  });
  if (!found || found.userId !== session.user.id) {
    throw new Error("Unauthorized");
  }

  const groups = await getBackSourceGroups({
    designId,
    userId: isAnonymousUser(session.user) ? null : session.user.id,
  });
  return { groups };
}

/**
 * Remembered defaults (#44, §3): the signed-in user's last purchase seeds
 * product + size on the buy surfaces (/preview, /d, /shop). Null for guests —
 * no localStorage fallback. Values are validated against the active catalog
 * in resolveLastPurchaseDefaults.
 */
export async function getLastPurchaseDefaults(): Promise<PurchaseDefaults | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || isAnonymousUser(session.user)) return null;
  return resolveLastPurchaseDefaults(db, session.user);
}

export async function generateMockup(
  designId: string,
  colorName: string,
  productId: string = DEFAULT_BLANK_ID,
  scale: number = 1.0,
  placementId: string = "front",
  /** Source image the placement render was anchored on (#25). Required for a
   * non-front placement so the mockup matches the picked source and the cache
   * key doesn't collide across back choices. Front leaves it undefined. */
  sourceImageId?: string
): Promise<{ mockupUrl: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const found = await db.query.design.findFirst({
    where: eq(designTable.id, designId),
  });
  if (!found || found.userId !== session.user.id)
    throw new Error("Unauthorized");

  // Clamp scale to valid range
  const clampedScale = Math.max(0.3, Math.min(1.0, scale));
  const scaleKey = Math.round(clampedScale * 100);

  // Cache key includes product, placement, scale, and (for non-front) the
  // source pick so two back choices don't collide on one key. Placement was
  // added in #25 2.1; front keys stay `${product}:front:${color}:${scale}`.
  const cacheKey = sourceImageId
    ? `${productId}:${placementId}:${sourceImageId}:${colorName}:${scaleKey}`
    : `${productId}:${placementId}:${colorName}:${scaleKey}`;
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
  const placementRender = await findPlacementRender(
    designId,
    productId,
    placement.id,
    sourceImageId
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
        userId: session.user.id,
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
  const r2Url = await uploadMockupImage(designId, colorName, buffer, placement.id);

  // Re-read before update to avoid clobbering concurrent preloads
  const fresh = await db.query.design.findFirst({
    where: eq(designTable.id, designId),
    columns: { mockupUrls: true },
  });
  const updatedMockups = { ...(fresh?.mockupUrls ?? {}), [cacheKey]: r2Url };
  await db
    .update(designTable)
    .set({ mockupUrls: updatedMockups, updatedAt: new Date() })
    .where(eq(designTable.id, designId));

  return { mockupUrl: r2Url };
}

/**
 * Pure function of (designId, productId): return the design_image to
 * render on the product. Does NOT mutate design.primary_image_id —
 * primary stays anchored on the user's source
 * pick. Caller (the /preview page) drives all UI state from the return.
 *
 *   1. Read design.primary_image_id. Null → throw (caller redirects).
 *   2. If the primary's aspect already fits the product's placement,
 *      return the primary directly. No new row, no Replicate spend.
 *   3. Else look up an existing (designId, productId, placementId) row.
 *      Hit → return.
 *   4. Else generate anchored on primary, insert design_image row,
 *      return.
 *
 * Step 2 of the design data model rework. Replaces the imperative
 * `regenerateForPlacement` flow that mutated design row state on every
 * product switch.
 */
export async function getOrCreatePlacementRender(
  designId: string,
  productId: string,
  placementId: string = "front",
  sourceImageId?: string
): Promise<{ id: string; imageUrl: string; aspectRatio: AspectRatio }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const found = await db.query.design.findFirst({
    where: eq(designTable.id, designId),
  });
  if (!found || found.userId !== session.user.id) {
    throw new Error("Unauthorized");
  }

  // Anchor source: an explicit pick (decision 2a — back reuses a chosen
  // source image from the same thread) wins; otherwise the design's
  // primary image (the front default).
  const anchorId = sourceImageId ?? found.primaryImageId;
  if (!anchorId) {
    throw new Error("No source image — design has no source pick yet");
  }

  const primary = await getDesignImageWithOwner(anchorId);
  if (!primary) throw new Error("Source image row missing");
  // Cross-design sources are allowed for the origins the back picker offers
  // (own designs, published Shop images) — anything else is rejected (#72).
  if (
    !canUseAsPlacementSource({
      image: primary,
      imageOwnerId: primary.ownerId,
      orderDesignId: designId,
      userId: session.user.id,
    })
  ) {
    throw new Error("Source image is not available for this design");
  }

  const product = getBlankOrThrow(productId);
  const placement = getPlacement(product, placementId);
  const targetAspect = placement.aspectRatio;

  // Source aspect already fits → primary IS the placement render.
  if (!needsAspectRegeneration(primary.aspectRatio, targetAspect)) {
    return {
      id: primary.id,
      imageUrl: primary.imageUrl,
      aspectRatio: primary.aspectRatio,
    };
  }

  // Match the cache on the anchor too — a non-front placement can be rendered
  // from any of several sources, so without this a second back pick returns
  // the first back render (#25 display bug).
  const cached = await findPlacementRender(
    designId,
    productId,
    placement.id,
    sourceImageId
  );
  if (cached) {
    console.log(
      `getOrCreatePlacementRender: cache hit design=${designId} product=${productId} url=${cached.imageUrl}`
    );
    return cached;
  }

  // Generate anchored on primary. Prompt comes from primary.prompt.
  // Every chat-driven generation writes its fluxPrompt to design_image,
  // so this is the canonical source.
  const prompt = primary.prompt ?? null;
  if (!prompt) {
    throw new Error("No generation prompt available to re-render");
  }

  const startedAt = Date.now();
  console.log(
    `getOrCreatePlacementRender: design=${designId} product=${productId} target=${targetAspect} promptLen=${prompt.length} anchor=${primary.imageUrl}`
  );
  let imageUrl: string;
  try {
    imageUrl = await generateAnchoredTransparent(
      prompt,
      primary.imageUrl,
      targetAspect
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("getOrCreatePlacementRender failed:", msg);
    throw new Error(`Image generation failed: ${msg}`);
  }
  console.log(
    `getOrCreatePlacementRender: design=${designId} done in ${Date.now() - startedAt}ms imageUrl=${imageUrl}`
  );

  const generationNumber = (found.generationCount ?? 0) + 1;
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch generated image: ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const r2Url = await uploadDesignImage(designId, generationNumber, buffer);

  const newId = await insertDesignImage({
    designId,
    imageUrl: r2Url,
    aspectRatio: targetAspect,
    prompt,
    generationCost: COST_PER_GENERATION,
    productId,
    placementId: placement.id,
    // Anchor the render to its source so a later lookup matches the exact pick.
    parentImageId: anchorId,
  });

  // Bump generation_count + cost so accounting stays accurate. Do NOT
  // touch primaryImageId — primary stays on the
  // source pick. clearing mockupUrls because the cache is keyed on
  // (productId, color, scale) and a fresh placement render invalidates
  // any stale mockups for that product.
  await db
    .update(designTable)
    .set({
      generationCount: generationNumber,
      generationCost: (found.generationCost ?? 0) + COST_PER_GENERATION,
      mockupUrls: null,
      updatedAt: new Date(),
    })
    .where(eq(designTable.id, designId));

  return { id: newId, imageUrl: r2Url, aspectRatio: targetAspect };
}

/**
 * Pre-fetch Printful mockups for every color of a product, best-effort.
 * Triggered via after() on accept so the user lands on /preview with the
 * color cache already warming. Printful mockup tasks are free; only wall
 * time costs.
 *
 * Issues a single multi-variant Printful task instead of one task per
 * color. One API round trip, one DB write at the end — no read-modify-
 * write race against concurrent on-demand mockup writes.
 *
 * Never throws to the caller; failures are logged and the function
 * returns without populating (or partially populating) the cache.
 */
/**
 * Schedule a prefetch via after() if there are no cached mockups yet
 * for this product. Cheap idempotent call — `/preview` invokes it on
 * page load, which is the only cache-warming path now that the
 * approveDesign handoff (and its prefetch hook) is gone.
 *
 * Returns instantly; the actual prefetch runs after the response is
 * sent, scoped to this function invocation's 300s budget. Safe to
 * call from a client useEffect — failures are logged inside
 * prefetchProductMockups.
 */
export async function ensureMockupsPrefetched(
  designId: string,
  productId: string = DEFAULT_BLANK_ID
): Promise<{ kicked: boolean }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const found = await db.query.design.findFirst({
    where: eq(designTable.id, designId),
    columns: { userId: true, mockupUrls: true },
  });
  if (!found || found.userId !== session.user.id) {
    throw new Error("Unauthorized");
  }

  const prefix = `${productId}:`;
  const hasAny = Object.keys(found.mockupUrls ?? {}).some((k) =>
    k.startsWith(prefix)
  );
  if (hasAny) return { kicked: false };

  after(() => prefetchProductMockups(designId, productId));
  return { kicked: true };
}

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
    const placementRender = await findPlacementRender(
      designId,
      productId,
      placement.id
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
          const r2Url = await uploadMockupImage(designId, colorName, buffer, "front");
          // Cache key matches generateMockup: productId:placement:color:scale (100 = 1.0)
          newEntries[`${productId}:front:${colorName}:100`] = r2Url;
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
