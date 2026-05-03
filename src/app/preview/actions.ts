"use server";

import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { design as designTable, type ChatMessage } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createMockupTask, pollMockupTask } from "@/lib/printful";
import {
  getProductOrThrow,
  getDefaultPlacement,
  needsAspectRegeneration,
  DEFAULT_PRODUCT_ID,
  type AspectRatio,
} from "@/lib/products";
import { uploadMockupImage, uploadDesignImage } from "@/lib/r2";
import { generateImage, removeBackground } from "@/lib/replicate";
import { insertDesignImage } from "@/lib/design-images";

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
  if (!found.currentImageUrl) throw new Error("No design image");

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

  // Generate mockup via Printful
  const taskKey = await createMockupTask(
    product.printfulProductId,
    variantId,
    found.currentImageUrl,
    scaledPosition,
    placement.id
  );
  const { mockupUrl: tempUrl } = await pollMockupTask(taskKey);

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
 * Regenerate the design's image to fit a product's placement aspect ratio.
 *
 * Phase 1 of the print-targets work (see docs/print-targets-plan.md): we
 * overwrite design.currentImageUrl with the re-targeted render and clear
 * the mockup cache. The original 1:1 source is lost from the design row
 * (still preserved as an earlier generation in chat_history). Phase 2/3
 * introduce a proper design_image table that preserves provenance.
 *
 * Skips work and returns null when the source aspect is close enough to
 * the target — see needsAspectRegeneration's threshold.
 */
export async function regenerateForPlacement(
  designId: string,
  productId: string,
  sourceAspect: AspectRatio = "1:1"
): Promise<{ imageUrl: string; aspectRatio: AspectRatio } | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const found = await db.query.design.findFirst({
    where: eq(designTable.id, designId),
  });
  if (!found || found.userId !== session.user.id) {
    throw new Error("Unauthorized");
  }
  if (!found.currentImageUrl) throw new Error("No design image to re-target");

  const product = getProductOrThrow(productId);
  const placement = getDefaultPlacement(product);
  const targetAspect = placement.aspectRatio;

  if (!needsAspectRegeneration(sourceAspect, targetAspect)) {
    return null;
  }

  // Pull the most recent generation prompt from chat history. Without a
  // prompt we can't re-render meaningfully — bail rather than guess.
  const chatHistory = (found.chatHistory as ChatMessage[]) ?? [];
  const lastPrompt = [...chatHistory]
    .reverse()
    .find((m) => m.role === "assistant" && m.fluxPrompt)?.fluxPrompt;
  if (!lastPrompt) {
    throw new Error("No generation prompt available to re-render");
  }

  // Use the existing image as a style reference so the re-render keeps
  // the look the user already approved of, just at the new shape.
  let replicateUrl: string;
  try {
    replicateUrl = await generateImage(
      lastPrompt,
      found.currentImageUrl,
      undefined,
      targetAspect
    );
  } catch (err) {
    console.error("regenerateForPlacement generateImage failed:", err);
    throw new Error("Image generation failed");
  }

  // Same text-preserving carve-out as src/app/design/actions.ts: when
  // the prompt asks Ideogram to render a quoted caption, skip
  // bg-removal so the matting model doesn't strip the lettering.
  const promptHasText = /"[^"]{2,}"/.test(lastPrompt);

  let finalUrl = replicateUrl;
  if (promptHasText) {
    console.log("Skipping background removal — prompt contains text");
  } else {
    try {
      finalUrl = await removeBackground(replicateUrl);
    } catch (err) {
      console.error("Background removal failed, using original:", err);
    }
  }

  const newGeneration = found.generationCount + 1;
  const response = await fetch(finalUrl);
  const buffer = Buffer.from(await response.arrayBuffer());
  const r2Url = await uploadDesignImage(designId, newGeneration, buffer);

  // Phase 2: record the re-targeted render as its own design_image
  // with productId/placementId set so we can later distinguish "the
  // 1:1 source" from "the 1:2 render for the iPhone case." Phase 3
  // will start using these to avoid overwriting the source.
  await insertDesignImage({
    designId,
    imageUrl: r2Url,
    aspectRatio: targetAspect,
    prompt: lastPrompt,
    generationCost: COST_PER_GENERATION,
    productId,
    placementId: placement.id,
  });

  await db
    .update(designTable)
    .set({
      currentImageUrl: r2Url,
      generationCount: newGeneration,
      generationCost: found.generationCost + COST_PER_GENERATION,
      mockupUrls: null,
      updatedAt: new Date(),
    })
    .where(eq(designTable.id, designId));

  return { imageUrl: r2Url, aspectRatio: targetAspect };
}
