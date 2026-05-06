"use server";

import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { design as designTable, type ChatMessage } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createMockupTask, pollMockupTask } from "@/lib/printful";
import {
  getProduct,
  getProductOrThrow,
  getDefaultPlacement,
  needsAspectRegeneration,
  DEFAULT_PRODUCT_ID,
  type AspectRatio,
} from "@/lib/products";
import { uploadMockupImage, uploadDesignImage } from "@/lib/r2";
import { generateAnchoredTransparent } from "@/lib/replicate";
import {
  insertDesignImage,
  findPlacementRender,
  getDesignImageById,
  getDesignDisplayImageUrl,
} from "@/lib/design-images";

const COST_PER_GENERATION = 0.03;

export async function generateMockup(
  designId: string,
  colorName: string,
  productId: string = DEFAULT_PRODUCT_ID,
  scale: number = 1.0
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

  // Cache key includes product and scale so different combos don't collide
  const cacheKey = `${productId}:${colorName}:${scaleKey}`;
  const cached = found.mockupUrls?.[cacheKey];
  if (cached) return { mockupUrl: cached };

  // Look up product and variant — use "M" for apparel, first available for other products
  const product = getProductOrThrow(productId);
  const colorVariants = product.variants[colorName];
  const variantId = colorVariants?.["M"] ?? (colorVariants ? Object.values(colorVariants)[0] : undefined);
  if (!variantId) throw new Error(`No variant for ${colorName} on ${product.name}`);

  const placement = product.placements[0];
  if (!placement) throw new Error(`Product ${product.id} has no placements defined`);

  // Resolve the image URL to print: use the placement-specific render
  // when one exists (for products whose aspect differs from the source),
  // otherwise fall back to the design's primary image. After Step 2,
  // getOrCreatePlacementRender always populates this row before
  // generateMockup runs, so the cache hit is the common case.
  const placementRender = await findPlacementRender(designId, productId, placement.id);
  const sourceImageUrl =
    placementRender?.imageUrl ?? (await getDesignDisplayImageUrl(designId));
  if (!sourceImageUrl) throw new Error("No design image");

  // Compute scaled position (centered within print area)
  const base = product.mockupPosition;
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
  const r2Url = await uploadMockupImage(designId, colorName, buffer);

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
 * render on the product. Does NOT mutate design.currentImageUrl or
 * design.primary_image_id — primary stays anchored on the user's source
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
  productId: string
): Promise<{ id: string; imageUrl: string; aspectRatio: AspectRatio }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const found = await db.query.design.findFirst({
    where: eq(designTable.id, designId),
  });
  if (!found || found.userId !== session.user.id) {
    throw new Error("Unauthorized");
  }
  if (!found.primaryImageId) {
    throw new Error("No primary image — design has no source pick yet");
  }

  const primary = await getDesignImageById(found.primaryImageId);
  if (!primary) throw new Error("Primary image row missing");

  const product = getProductOrThrow(productId);
  const placement = getDefaultPlacement(product);
  const targetAspect = placement.aspectRatio;

  // Source aspect already fits → primary IS the placement render.
  if (!needsAspectRegeneration(primary.aspectRatio, targetAspect)) {
    return {
      id: primary.id,
      imageUrl: primary.imageUrl,
      aspectRatio: primary.aspectRatio,
    };
  }

  const cached = await findPlacementRender(designId, productId, placement.id);
  if (cached) {
    console.log(
      `getOrCreatePlacementRender: cache hit design=${designId} product=${productId} url=${cached.imageUrl}`
    );
    return cached;
  }

  // Generate anchored on primary. Pull the prompt from primary.prompt,
  // fall back to the most recent assistant fluxPrompt in chat history.
  let prompt = primary.prompt ?? null;
  if (!prompt) {
    const chatHistory = (found.chatHistory as ChatMessage[]) ?? [];
    prompt =
      [...chatHistory]
        .reverse()
        .find((m) => m.role === "assistant" && m.fluxPrompt)?.fluxPrompt ?? null;
  }
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
  });

  // Bump generation_count + cost so accounting stays accurate. Do NOT
  // touch currentImageUrl or primaryImageId — primary stays on the
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
export async function prefetchProductMockups(
  designId: string,
  productId: string = DEFAULT_PRODUCT_ID
): Promise<void> {
  const startedAt = Date.now();
  const product = getProduct(productId);
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

    const placement = product.placements[0];
    if (!placement) return;

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
    const base = product.mockupPosition;
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
          const r2Url = await uploadMockupImage(designId, colorName, buffer);
          // Cache key matches generateMockup: productId:color:scale (100 = 1.0)
          newEntries[`${productId}:${colorName}:100`] = r2Url;
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
