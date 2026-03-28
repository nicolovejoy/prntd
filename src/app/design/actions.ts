"use server";

import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { design as designTable } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { constructFluxPrompt } from "@/lib/ai";
import { generateImage, removeBackground } from "@/lib/replicate";
import { uploadDesignImage } from "@/lib/r2";
import type { ChatMessage } from "@/lib/db/schema";

const COST_PER_GENERATION = 0.03;

export async function sendMessage(designId: string, userMessage: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  // Get or create design
  let found = await db.query.design.findFirst({
    where: eq(designTable.id, designId),
  });

  if (!found) {
    const [created] = await db
      .insert(designTable)
      .values({
        id: designId,
        userId: session.user.id,
        chatHistory: [],
      })
      .returning();
    found = created;
  }

  if (found.userId !== session.user.id) throw new Error("Unauthorized");

  const chatHistory: ChatMessage[] = (found.chatHistory as ChatMessage[]) ?? [];

  // Get Claude to construct the image prompt
  const aiResponse = await constructFluxPrompt(userMessage, chatHistory);

  // Generate image and attempt background removal
  const replicateUrl = await generateImage(aiResponse.fluxPrompt);
  let finalUrl = replicateUrl;
  try {
    finalUrl = await removeBackground(replicateUrl);
  } catch (err) {
    console.error("Background removal failed, using original image:", err);
  }

  // Download and upload to R2
  const newGeneration = found.generationCount + 1;
  const response = await fetch(finalUrl);
  const buffer = Buffer.from(await response.arrayBuffer());
  const r2Url = await uploadDesignImage(designId, newGeneration, buffer);

  // Update chat history
  const updatedHistory: ChatMessage[] = [
    ...chatHistory,
    { role: "user", content: userMessage },
    {
      role: "assistant",
      content: aiResponse.message,
      imageUrl: r2Url,
      fluxPrompt: aiResponse.fluxPrompt,
    },
  ];

  await db
    .update(designTable)
    .set({
      chatHistory: updatedHistory,
      currentImageUrl: r2Url,
      generationCount: newGeneration,
      generationCost: found.generationCost + COST_PER_GENERATION,
      updatedAt: new Date(),
    })
    .where(eq(designTable.id, designId));

  return {
    message: aiResponse.message,
    imageUrl: r2Url,
    generationCount: newGeneration,
  };
}

export async function getDesign(designId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const found = await db.query.design.findFirst({
    where: eq(designTable.id, designId),
  });

  if (found && found.userId !== session.user.id) throw new Error("Unauthorized");

  return found ?? null;
}

export async function approveDesign(designId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  await db
    .update(designTable)
    .set({ status: "approved", updatedAt: new Date() })
    .where(eq(designTable.id, designId));
}
