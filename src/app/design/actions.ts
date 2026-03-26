"use server";

import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { design as designTable } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { constructFluxPrompt } from "@/lib/ai";
import { generateImagePair } from "@/lib/replicate";
import { uploadDesignImage } from "@/lib/r2";
import type { ChatMessage } from "@/lib/db/schema";

const COST_PER_GENERATION = 0.06; // two models in parallel

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

  // Generate images with both models in parallel
  const pair = await generateImagePair(aiResponse.fluxPrompt);

  // Download and upload both to R2
  const newGeneration = found.generationCount + 1;
  const [responseA, responseB] = await Promise.all([
    fetch(pair.optionA),
    fetch(pair.optionB),
  ]);
  const [bufferA, bufferB] = await Promise.all([
    responseA.arrayBuffer().then((ab) => Buffer.from(ab)),
    responseB.arrayBuffer().then((ab) => Buffer.from(ab)),
  ]);
  const [r2UrlA, r2UrlB] = await Promise.all([
    uploadDesignImage(designId, newGeneration, bufferA, "a"),
    uploadDesignImage(designId, newGeneration, bufferB, "b"),
  ]);

  // Update chat history — user will pick one later
  const updatedHistory: ChatMessage[] = [
    ...chatHistory,
    { role: "user", content: userMessage },
    {
      role: "assistant",
      content: aiResponse.message,
      imageUrl: r2UrlA,
      imageUrlAlt: r2UrlB,
      modelA: pair.modelA,
      modelB: pair.modelB,
      fluxPrompt: aiResponse.fluxPrompt,
    },
  ];

  await db
    .update(designTable)
    .set({
      chatHistory: updatedHistory,
      currentImageUrl: r2UrlA,
      generationCount: newGeneration,
      generationCost: found.generationCost + COST_PER_GENERATION,
      updatedAt: new Date(),
    })
    .where(eq(designTable.id, designId));

  return {
    message: aiResponse.message,
    imageUrl: r2UrlA,
    imageUrlAlt: r2UrlB,
    modelA: pair.modelA,
    modelB: pair.modelB,
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

export async function chooseOption(
  designId: string,
  choice: "a" | "b"
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const found = await db.query.design.findFirst({
    where: eq(designTable.id, designId),
  });
  if (!found || found.userId !== session.user.id) throw new Error("Unauthorized");

  const chatHistory: ChatMessage[] = (found.chatHistory as ChatMessage[]) ?? [];
  const lastMsg = chatHistory[chatHistory.length - 1];

  if (lastMsg?.role !== "assistant" || !lastMsg.imageUrlAlt) return;

  const chosenUrl = choice === "a" ? lastMsg.imageUrl : lastMsg.imageUrlAlt;
  const chosenModel = choice === "a" ? lastMsg.modelA : lastMsg.modelB;

  // Record the choice in chat history
  lastMsg.modelChosen = chosenModel;

  // Set chosen image as current
  await db
    .update(designTable)
    .set({
      chatHistory,
      currentImageUrl: chosenUrl,
      updatedAt: new Date(),
    })
    .where(eq(designTable.id, designId));

  return { chosenUrl, chosenModel };
}

export async function approveDesign(designId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  await db
    .update(designTable)
    .set({ status: "approved", updatedAt: new Date() })
    .where(eq(designTable.id, designId));
}
