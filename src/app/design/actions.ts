"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  design as designTable,
  order as orderTable,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { chatAboutDesign, constructFluxPrompt } from "@/lib/ai";
import { generateTransparent } from "@/lib/ideogram";
import { generateAnchoredTransparent } from "@/lib/replicate";
import { uploadDesignImage } from "@/lib/r2";
import { extractImagesFromHistory } from "@/lib/chat-utils";
import {
  insertDesignImage,
  findDesignImageByUrl,
  getDesignSourceImages,
  getDesignPlacementRenders,
  deleteDesignImageRow,
  getDesignDisplayImageUrl,
  type SourceImage,
  type ProductVersionGroup,
} from "@/lib/design-images";
import { prefetchProductMockups } from "@/app/preview/actions";
import { DEFAULT_PRODUCT_ID } from "@/lib/products";
import type { ChatMessage } from "@/lib/db/schema";

const COST_PER_GENERATION = 0.03;

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
        chatHistory: [],
      })
      .returning();
    found = created;
  }

  if (found.userId !== userId) throw new Error("Unauthorized");
  return found;
}

export async function sendChatMessage(designId: string, userMessage: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const found = await getOrCreateDesign(designId, session.user.id);
  const chatHistory: ChatMessage[] =
    (found.chatHistory as ChatMessage[]) ?? [];
  const images = extractImagesFromHistory(chatHistory);

  const aiResponse = await chatAboutDesign(userMessage, chatHistory, images);

  const updatedHistory: ChatMessage[] = [
    ...chatHistory,
    { role: "user", content: userMessage },
    { role: "assistant", content: aiResponse.message },
  ];

  await db
    .update(designTable)
    .set({ chatHistory: updatedHistory, updatedAt: new Date() })
    .where(eq(designTable.id, designId));

  return { message: aiResponse.message };
}

export async function generateDesign(
  designId: string,
  userMessage?: string
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const found = await getOrCreateDesign(designId, session.user.id);
  const chatHistory: ChatMessage[] =
    (found.chatHistory as ChatMessage[]) ?? [];
  const images = extractImagesFromHistory(chatHistory);

  // If user typed a message with the generate action, add it to history for context
  const historyForPrompt = userMessage
    ? [...chatHistory, { role: "user" as const, content: userMessage }]
    : chatHistory;

  let aiResponse;
  try {
    aiResponse = await constructFluxPrompt(
      historyForPrompt,
      images,
      userMessage
    );
  } catch (err) {
    console.error("constructFluxPrompt failed:", err);
    throw new Error("Failed to construct prompt");
  }

  // When the AI flags a prior generation as the reference (the user is
  // refining/iterating, not starting fresh), anchor on it visually via
  // the Replicate path. First-pass generations have no anchor and use
  // the direct transparent endpoint (single call, native RGBA).
  const anchorUrl =
    aiResponse.referenceImage != null
      ? images.find((img) => img.number === aiResponse.referenceImage)?.url
      : undefined;

  let imageUrl: string;
  try {
    imageUrl = anchorUrl
      ? await generateAnchoredTransparent(
          aiResponse.fluxPrompt,
          anchorUrl,
          "1:1",
          aiResponse.negativePrompt ?? undefined
        )
      : await generateTransparent(aiResponse.fluxPrompt, "1:1", {
          negativePrompt: aiResponse.negativePrompt ?? undefined,
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
    generationCost: COST_PER_GENERATION,
  });

  // Build updated chat history
  const newMessages: ChatMessage[] = [];
  if (userMessage) {
    newMessages.push({ role: "user", content: userMessage });
  }
  newMessages.push({
    role: "assistant",
    content: aiResponse.message,
    imageUrl: r2Url,
    fluxPrompt: aiResponse.fluxPrompt,
    generationNumber: newGeneration,
  });

  const updatedHistory: ChatMessage[] = [...chatHistory, ...newMessages];

  await db
    .update(designTable)
    .set({
      chatHistory: updatedHistory,
      primaryImageId: newImageId,
      generationCount: newGeneration,
      generationCost: found.generationCost + COST_PER_GENERATION,
      mockupUrls: null,
      updatedAt: new Date(),
    })
    .where(eq(designTable.id, designId));

  return {
    message: aiResponse.message,
    imageUrl: r2Url,
    generationNumber: newGeneration,
  };
}

export async function uploadReferenceImage(
  designId: string,
  base64Data: string,
  fileName: string
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const found = await getOrCreateDesign(designId, session.user.id);
  const chatHistory: ChatMessage[] =
    (found.chatHistory as ChatMessage[]) ?? [];

  // Upload to R2 as an "upload" (not a generation)
  const uploadNumber = Date.now();
  const buffer = Buffer.from(base64Data, "base64");
  const r2Url = await uploadDesignImage(designId, uploadNumber, buffer, "upload");

  // Add to chat history as a user message with imageUrl
  const updatedHistory: ChatMessage[] = [
    ...chatHistory,
    {
      role: "user",
      content: `Uploaded reference image: ${fileName}`,
      imageUrl: r2Url,
    },
  ];

  await db
    .update(designTable)
    .set({ chatHistory: updatedHistory, updatedAt: new Date() })
    .where(eq(designTable.id, designId));

  return { imageUrl: r2Url };
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

  // Refuse if any order placement references this image — deleting
  // would leave the order's thumbnail broken on /orders and /admin.
  const orders = await db
    .select({ id: orderTable.id, placements: orderTable.placements })
    .from(orderTable)
    .where(eq(orderTable.designId, designId));

  const pinnedBy = orders.find(
    (o) => o.placements && Object.values(o.placements).includes(imageId)
  );
  if (pinnedBy) {
    throw new Error(
      "Can't delete this image — it's pinned to an order's thumbnail."
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
  return { sources, productGroups };
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
  after(() => prefetchProductMockups(designId, DEFAULT_PRODUCT_ID));
}
