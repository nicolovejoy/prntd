"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import { auth, isAnonymousUser } from "@/lib/auth";
import { consumeGenerationQuota } from "@/lib/generation-quota";
import { db } from "@/lib/db";
import {
  design as designTable,
  designImage as designImageTable,
  order as orderTable,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { chatAboutDesign, constructFluxPrompt, assessReadiness } from "@/lib/ai";
import { uploadDesignImage } from "@/lib/r2";
import { getGenerator, GENERATORS, DEFAULT_GENERATOR_ID } from "@/lib/generators/registry";
import {
  insertDesignImage,
  findDesignImageByUrl,
  getDesignSourceImages,
  getDesignPlacementRenders,
  deleteDesignImageRow,
  getDesignDisplayImageUrl,
  getDesignMessages,
  insertChatMessage,
  getDesignImagesForAIContext,
  type SourceImage,
  type ProductVersionGroup,
} from "@/lib/design-images";
import { prefetchProductMockups } from "@/app/preview/actions";
import { DEFAULT_BLANK_ID } from "@/lib/blanks";
import { imageReferencedByOrders } from "@/lib/design-publish";
import { compareSummary, dedupeById } from "@/lib/compare";
import type { ChatMessage } from "@/lib/db/schema";

async function getOrCreateDesign(designId: string, userId: string) {
  let found = await db.query.design.findFirst({
    where: eq(designTable.id, designId),
  });

  if (!found) {
    const [created] = await db
      .insert(designTable)
      .values({
        id: designId,
        userId,
      })
      .returning();
    found = created;
  }

  if (found.userId !== userId) throw new Error("Unauthorized");
  return found;
}

/** First IP from the forwarded-for chain (the client), or null. */
function clientIp(hdrs: Headers): string | null {
  return hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
}

/** Copy shown when a generation is blocked by the daily cap (#26 A3). */
function generationLimitMessage(reason: "identity" | "ip" | undefined): string {
  return reason === "ip"
    ? "This network has hit today's free design limit. Sign in to keep designing."
    : "You've reached today's free design limit. Sign in to keep designing.";
}

export async function sendChatMessage(designId: string, userMessage: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  await getOrCreateDesign(designId, session.user.id);
  const messages = await getDesignMessages(designId);
  const images = await getDesignImagesForAIContext(designId);

  const aiResponse = await chatAboutDesign(userMessage, messages, images);

  await insertChatMessage({ designId, role: "user", content: userMessage });
  await insertChatMessage({
    designId,
    role: "assistant",
    content: aiResponse.message,
  });

  await db
    .update(designTable)
    .set({ updatedAt: new Date() })
    .where(eq(designTable.id, designId));

  return {
    message: aiResponse.message,
    readyToGenerate: aiResponse.readyToGenerate,
  };
}

/**
 * Claude declines to generate and asks a clarifying question (e.g. when the
 * user hasn't specified a style) by returning an empty fluxPrompt. Detect
 * that so we surface the question in chat instead of sending an empty prompt
 * to the image model, which 400s.
 */
function isClarificationOnly(fluxPrompt: string | null | undefined): boolean {
  return !fluxPrompt || fluxPrompt.trim() === "";
}

async function persistClarification(
  designId: string,
  userMessage: string | undefined,
  message: string
) {
  if (userMessage) {
    await insertChatMessage({ designId, role: "user", content: userMessage });
  }
  await insertChatMessage({ designId, role: "assistant", content: message });
  await db
    .update(designTable)
    .set({ updatedAt: new Date() })
    .where(eq(designTable.id, designId));
}

export async function generateDesign(
  designId: string,
  userMessage?: string
) {
  const hdrs = await headers();
  const session = await auth.api.getSession({ headers: hdrs });
  if (!session) throw new Error("Unauthorized");

  const found = await getOrCreateDesign(designId, session.user.id);

  // Abuse guard (#26 A3): count this generation against the daily caps before
  // any paid model call. Over the cap → nudge to sign in, no API spend.
  const quota = await consumeGenerationQuota({
    userId: session.user.id,
    isAnonymous: isAnonymousUser(session.user),
    ip: clientIp(hdrs),
  });
  if (!quota.allowed) {
    return {
      message: generationLimitMessage(quota.reason),
      imageUrl: null,
      imageId: null,
      generationNumber: found.generationCount,
      readyToGenerate: true,
    };
  }

  const messages = await getDesignMessages(designId);
  const images = await getDesignImagesForAIContext(designId);

  // If user typed a message with the generate action, fold it into the
  // context the AI sees (without persisting until generation succeeds).
  const messagesForPrompt: ChatMessage[] = userMessage
    ? [
        ...messages,
        {
          id: "pending",
          designId,
          role: "user",
          content: userMessage,
          imageId: null,
          createdAt: new Date(),
        },
      ]
    : messages;

  // Fast pre-check: if the idea is too thin to render, ask for the missing
  // piece in ~1s (Haiku) instead of paying the heavy constructFluxPrompt
  // round-trip just to surface a clarifying question. Fails open.
  const readiness = await assessReadiness(messagesForPrompt, images, userMessage);
  if (!readiness.ready) {
    await persistClarification(designId, userMessage, readiness.question);
    return {
      message: readiness.question,
      imageUrl: null,
      imageId: null,
      generationNumber: found.generationCount,
      readyToGenerate: false,
    };
  }

  let aiResponse;
  try {
    aiResponse = await constructFluxPrompt(
      messagesForPrompt,
      images,
      userMessage
    );
  } catch (err) {
    console.error("constructFluxPrompt failed:", err);
    throw new Error("Failed to construct prompt");
  }

  if (isClarificationOnly(aiResponse.fluxPrompt)) {
    await persistClarification(designId, userMessage, aiResponse.message);
    return {
      message: aiResponse.message,
      imageUrl: null,
      imageId: null,
      generationNumber: found.generationCount,
      readyToGenerate: false,
    };
  }

  const anchorUrl =
    aiResponse.referenceImage != null
      ? images.find((img) => img.number === aiResponse.referenceImage)?.url
      : undefined;

  const generator = getGenerator(found.activeGeneratorId);

  let imageUrl: string;
  try {
    imageUrl = await generator.generate(generator.adaptPrompt(aiResponse.fluxPrompt), {
      aspect: "1:1",
      referenceImageUrl: anchorUrl,
      negativePrompt: aiResponse.negativePrompt,
    });
  } catch (err) {
    console.error("generateDesign image generation failed:", err);
    throw new Error("Image generation failed");
  }

  // Download and upload to R2
  const newGeneration = found.generationCount + 1;
  const response = await fetch(imageUrl);
  const buffer = Buffer.from(await response.arrayBuffer());
  const r2Url = await uploadDesignImage(designId, newGeneration, buffer);

  // Phase 2: record this generation as a first-class design_image row.
  // Aspect is "1:1" here — chat-driven generations are always square;
  // product-targeted regenerations happen in preview/actions.ts.
  const newImageId = await insertDesignImage({
    designId,
    imageUrl: r2Url,
    aspectRatio: "1:1",
    prompt: aiResponse.fluxPrompt,
    generationCost: generator.costPerImage,
    generator: generator.id,
  });

  if (userMessage) {
    await insertChatMessage({ designId, role: "user", content: userMessage });
  }
  await insertChatMessage({
    designId,
    role: "assistant",
    content: aiResponse.message,
    imageId: newImageId,
  });

  await db
    .update(designTable)
    .set({
      primaryImageId: newImageId,
      generationCount: newGeneration,
      generationCost: found.generationCost + generator.costPerImage,
      mockupUrls: null,
      updatedAt: new Date(),
    })
    .where(eq(designTable.id, designId));

  return {
    message: aiResponse.message,
    imageUrl: r2Url,
    imageId: newImageId,
    generationNumber: newGeneration,
    readyToGenerate: true,
  };
}

export async function uploadReferenceImage(
  designId: string,
  base64Data: string,
  fileName: string
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  await getOrCreateDesign(designId, session.user.id);

  // Upload to R2 as an "upload" (not a generation)
  const uploadNumber = Date.now();
  const buffer = Buffer.from(base64Data, "base64");
  const r2Url = await uploadDesignImage(designId, uploadNumber, buffer, "upload");

  // Record as a design_image row so the gallery picks it up and the
  // AI gallery context can reference it.
  const newImageId = await insertDesignImage({
    designId,
    imageUrl: r2Url,
    aspectRatio: "1:1",
    prompt: `[user upload] ${fileName}`,
    generationCost: 0,
  });

  await insertChatMessage({
    designId,
    role: "user",
    content: `Uploaded reference image: ${fileName}`,
    imageId: newImageId,
  });

  await db
    .update(designTable)
    .set({ updatedAt: new Date() })
    .where(eq(designTable.id, designId));

  return { imageUrl: r2Url, imageId: newImageId };
}

export async function selectImage(designId: string, imageUrl: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const found = await db.query.design.findFirst({
    where: eq(designTable.id, designId),
  });
  if (!found || found.userId !== session.user.id)
    throw new Error("Unauthorized");

  const primaryImageId = await findDesignImageByUrl(designId, imageUrl);

  await db
    .update(designTable)
    .set({
      primaryImageId,
      mockupUrls: null,
      updatedAt: new Date(),
    })
    .where(eq(designTable.id, designId));
}

/**
 * Delete a design_image row by id. Refuses when any order pins the
 * row via placements (e.g. order.placements.front references this id),
 * so a deletion can't orphan an order's recorded thumbnail. Recomputes
 * primary_image_id to the most recent remaining source image when
 * the delete proceeds.
 */
export async function deleteDesignImage(designId: string, imageId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const found = await db.query.design.findFirst({
    where: eq(designTable.id, designId),
  });
  if (!found || found.userId !== session.user.id)
    throw new Error("Unauthorized");

  // Publishing is reversible, so deletion is no longer blocked on publish
  // state — only on real order references. Refuse if an order depends on
  // this image (pinned in placements, or the primary a legacy order falls
  // back to); deleting would orphan the order's print/thumbnail.
  const orders = await db
    .select({ placements: orderTable.placements })
    .from(orderTable)
    .where(eq(orderTable.designId, designId));

  if (imageReferencedByOrders(imageId, found.primaryImageId, orders)) {
    throw new Error(
      "Can't delete this image — it's referenced by an order."
    );
  }

  const { newPrimaryId } = await deleteDesignImageRow(designId, imageId);

  await db
    .update(designTable)
    .set({
      primaryImageId: newPrimaryId,
      updatedAt: new Date(),
    })
    .where(eq(designTable.id, designId));
}

export async function getDesign(designId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const found = await db.query.design.findFirst({
    where: eq(designTable.id, designId),
  });

  if (found && found.userId !== session.user.id)
    throw new Error("Unauthorized");

  if (!found) return null;

  // Resolve the display image URL via primary_image_id (callers
  // consume `displayImageUrl` rather than touching design_image rows
  // directly).
  const displayImageUrl = await getDesignDisplayImageUrl(designId);
  return { ...found, displayImageUrl };
}

/**
 * Hydrate chat thread for a design. Append-only log read from the
 * chat_message table.
 */
export async function getDesignChat(designId: string): Promise<ChatMessage[]> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const found = await db.query.design.findFirst({
    where: eq(designTable.id, designId),
    columns: { id: true, userId: true },
  });
  if (!found) return [];
  if (found.userId !== session.user.id) throw new Error("Unauthorized");

  return await getDesignMessages(designId);
}

/**
 * Fetch the gallery payload for /design: source images (1:1 explorations)
 * and placement renders grouped by product. Single round trip so the page
 * can refresh both sections after every action.
 */
export async function getDesignGallery(
  designId: string
): Promise<{ sources: SourceImage[]; productGroups: ProductVersionGroup[] }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const found = await db.query.design.findFirst({
    where: eq(designTable.id, designId),
    columns: { id: true, userId: true },
  });
  if (found && found.userId !== session.user.id)
    throw new Error("Unauthorized");
  if (!found) return { sources: [], productGroups: [] };

  const [sources, productGroups] = await Promise.all([
    getDesignSourceImages(designId),
    getDesignPlacementRenders(designId),
  ]);
  // Guard against a duplicate row ever reaching the gallery — the header
  // count and the mobile FAB badge both derive from this list, so a dupe
  // would make them disagree (#19).
  return { sources: dedupeById(sources), productGroups };
}

export async function approveDesign(designId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  await db
    .update(designTable)
    .set({ status: "approved", updatedAt: new Date() })
    .where(eq(designTable.id, designId));

  // Warm the mockup cache for every color of the default product. By the
  // time the user lands on /preview and starts clicking colors, the common
  // picks render instantly. Printful mockups are free so this is pure UX.
  // Best-effort: failures log and are swallowed by prefetchProductMockups.
  after(() => prefetchProductMockups(designId, DEFAULT_BLANK_ID));
}

/**
 * Run the same Claude-built prompt through every registered generator and
 * insert one design_image per result, tagged with its generator. Does NOT
 * change the design's active generator — that happens on adoptGenerator.
 * Returns the new images (id + url + generator) newest-last.
 */
export async function compareGenerators(designId: string, userMessage?: string) {
  const hdrs = await headers();
  const session = await auth.api.getSession({ headers: hdrs });
  if (!session) throw new Error("Unauthorized");

  const found = await getOrCreateDesign(designId, session.user.id);

  // Abuse guard (#26 A3): Compare runs two paid model calls, so it's the
  // costliest dead-click — count it against the daily caps before any work.
  const quota = await consumeGenerationQuota({
    userId: session.user.id,
    isAnonymous: isAnonymousUser(session.user),
    ip: clientIp(hdrs),
  });
  if (!quota.allowed) {
    return { message: generationLimitMessage(quota.reason), images: [], readyToGenerate: true };
  }

  const messages = await getDesignMessages(designId);
  const images = await getDesignImagesForAIContext(designId);
  const messagesForPrompt: ChatMessage[] = userMessage
    ? [...messages, { id: "pending", designId, role: "user", content: userMessage, imageId: null, createdAt: new Date() }]
    : messages;

  // Same fast thin-check as generateDesign — Compare runs two models, so a
  // dead-click here is even costlier; bail in ~1s before any heavy work.
  const readiness = await assessReadiness(messagesForPrompt, images, userMessage);
  if (!readiness.ready) {
    await persistClarification(designId, userMessage, readiness.question);
    return { message: readiness.question, images: [], readyToGenerate: false };
  }

  let aiResponse;
  try {
    aiResponse = await constructFluxPrompt(messagesForPrompt, images, userMessage);
  } catch (err) {
    console.error("compareGenerators constructFluxPrompt failed:", err);
    throw new Error("Failed to construct prompt");
  }

  if (isClarificationOnly(aiResponse.fluxPrompt)) {
    await persistClarification(designId, userMessage, aiResponse.message);
    return { message: aiResponse.message, images: [], readyToGenerate: false };
  }

  const anchorUrl =
    aiResponse.referenceImage != null
      ? images.find((img) => img.number === aiResponse.referenceImage)?.url
      : undefined;

  const results = await Promise.all(
    Object.values(GENERATORS).map(async (g, i) => {
      try {
        const url = await g.generate(g.adaptPrompt(aiResponse.fluxPrompt), {
          aspect: "1:1",
          referenceImageUrl: anchorUrl,
          negativePrompt: aiResponse.negativePrompt,
        });
        const response = await fetch(url);
        const buffer = Buffer.from(await response.arrayBuffer());
        // Distinct generation number per adapter so parallel uploads don't
        // collide on the R2 key (designs/{id}/{generation}.png).
        const generation = found.generationCount + 1 + i;
        const r2Url = await uploadDesignImage(designId, generation, buffer);
        const imageId = await insertDesignImage({
          designId,
          imageUrl: r2Url,
          aspectRatio: "1:1",
          prompt: aiResponse.fluxPrompt,
          generationCost: g.costPerImage,
          generator: g.id,
        });
        return { imageId, imageUrl: r2Url, generator: g.id, cost: g.costPerImage };
      } catch (err) {
        console.error(`compareGenerators ${g.id} failed:`, err);
        return null;
      }
    })
  );

  const ok = results.filter((r): r is NonNullable<typeof r> => r !== null);
  if (ok.length === 0) throw new Error("All generators failed");

  // Summarize honestly: name the styles that didn't come back rather than
  // silently undercounting (#19 — "Compared 1 generators"). results is
  // index-aligned with the generators we ran.
  const gens = Object.values(GENERATORS);
  const succeeded = gens.filter((_, i) => results[i] !== null).map((g) => g.label);
  const failed = gens.filter((_, i) => results[i] === null).map((g) => g.label);
  const summary = compareSummary(succeeded, failed);
  if (userMessage) {
    await insertChatMessage({ designId, role: "user", content: userMessage });
  }
  await insertChatMessage({
    designId,
    role: "assistant",
    content: summary,
  });

  // Advance the counter past every slot we *reserved* (one per attempted
  // adapter), not just the successes — each parallel branch used
  // generationCount+1+i as its R2 key, so a future generation must start
  // beyond all of them or it would overwrite a surviving compare image.
  await db
    .update(designTable)
    .set({
      generationCount: found.generationCount + Object.values(GENERATORS).length,
      generationCost: found.generationCost + ok.reduce((sum, r) => sum + r.cost, 0),
      updatedAt: new Date(),
    })
    .where(eq(designTable.id, designId));

  return { message: summary, images: ok, readyToGenerate: true };
}

/**
 * Adopt a compared image: set the design's active generator to that
 * image's generator and make it the primary image. Owner-auth.
 */
export async function adoptGenerator(designId: string, imageId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const found = await db.query.design.findFirst({ where: eq(designTable.id, designId) });
  if (!found || found.userId !== session.user.id) throw new Error("Unauthorized");

  const image = await db.query.designImage.findFirst({
    where: eq(designImageTable.id, imageId),
  });
  if (!image || image.designId !== designId) throw new Error("Image not found");

  await db
    .update(designTable)
    .set({
      activeGeneratorId: image.generator ?? DEFAULT_GENERATOR_ID,
      primaryImageId: imageId,
      updatedAt: new Date(),
    })
    .where(eq(designTable.id, designId));

  return { activeGeneratorId: image.generator ?? DEFAULT_GENERATOR_ID };
}
