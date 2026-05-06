"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { design as designTable } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { chatAboutDesign, constructFluxPrompt } from "@/lib/ai";
import { generateTransparent } from "@/lib/ideogram";
import { generateAnchoredTransparent } from "@/lib/replicate";
import { uploadDesignImage } from "@/lib/r2";
import { extractImagesFromHistory } from "@/lib/chat-utils";
import { insertDesignImage, findDesignImageByUrl } from "@/lib/design-images";
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
      currentImageUrl: r2Url,
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
      currentImageUrl: imageUrl,
      primaryImageId,
      mockupUrls: null,
      updatedAt: new Date(),
    })
    .where(eq(designTable.id, designId));
}

export async function deleteGeneration(
  designId: string,
  generationNumber: number
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const found = await db.query.design.findFirst({
    where: eq(designTable.id, designId),
  });
  if (!found || found.userId !== session.user.id)
    throw new Error("Unauthorized");

  const chatHistory: ChatMessage[] =
    (found.chatHistory as ChatMessage[]) ?? [];

  // Remove the image reference from the assistant message
  const updatedHistory = chatHistory.map((msg) => {
    if (
      msg.role === "assistant" &&
      msg.generationNumber === generationNumber
    ) {
      return {
        role: msg.role,
        content: `${msg.content} (image deleted)`,
      } as ChatMessage;
    }
    return msg;
  });

  // If deleted image was the current one, pick the latest remaining
  const remainingImages = extractImagesFromHistory(updatedHistory);
  const newCurrentUrl =
    remainingImages.length > 0
      ? remainingImages[remainingImages.length - 1].url
      : null;
  const newPrimaryImageId = newCurrentUrl
    ? await findDesignImageByUrl(designId, newCurrentUrl)
    : null;

  await db
    .update(designTable)
    .set({
      chatHistory: updatedHistory,
      currentImageUrl: newCurrentUrl,
      primaryImageId: newPrimaryImageId,
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

  return found ?? null;
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
