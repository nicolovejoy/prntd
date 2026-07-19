"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import { auth, isAnonymousUser } from "@/lib/auth";
import {
  consumeGenerationQuota,
  refundGenerationQuota,
} from "@/lib/generation-quota";
import { db } from "@/lib/db";
import {
  design as designTable,
  designImage as designImageTable,
  chatMessage as chatMessageTable,
  order as orderTable,
} from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { chatAboutDesign, constructFluxPrompt, assessReadiness } from "@/lib/ai";
import { uploadDesignImage, deleteDesignImageObject } from "@/lib/r2";
import { getGenerator } from "@/lib/generators/registry";
import {
  insertDesignImage,
  reserveGenerationNumbers,
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
import { dedupeById } from "@/lib/design-view";
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
    options: aiResponse.options,
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
  const ip = clientIp(hdrs);

  // Abuse guard (#26 A3): count this generation against the daily caps before
  // any paid model call. Over the cap → nudge to sign in, no API spend.
  const quota = await consumeGenerationQuota({
    userId: session.user.id,
    isAnonymous: isAnonymousUser(session.user),
    ip,
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

  // Quota is consumed above; if the generation then throws, refund the unit so
  // a failed render doesn't cost the user a design (guests get only 8/day).
  // Clarification early-returns below aren't failures — they leave quota spent.
  try {
    return await runGenerate({ designId, found, userMessage });
  } catch (err) {
    await refundGenerationQuota({ userId: session.user.id, ip }).catch((e) =>
      console.error("refundGenerationQuota failed:", e)
    );
    throw err;
  }
}

async function runGenerate({
  designId,
  found,
  userMessage,
}: {
  designId: string;
  found: typeof designTable.$inferSelect;
  userMessage?: string;
}) {
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
      options: readiness.options,
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

  // Atomically reserve this generation's number so a concurrent generate can't
  // land on the same R2 key and overwrite our image (reserved once the render
  // succeeded, so a failed generate rarely leaves a gap).
  const [newGeneration] = await reserveGenerationNumbers(designId, 1);
  const response = await fetch(imageUrl);
  const buffer = Buffer.from(await response.arrayBuffer());
  const r2Url = await uploadDesignImage(designId, newGeneration, buffer);

  try {
    const newImageId = crypto.randomUUID();
    // Anchor provenance on the latest image the user's request was built from,
    // not a "latest by createdAt" re-read that a racing generate could shift.
    const parentImageId = images[images.length - 1]?.id ?? null;

    // Commit the four writes atomically (db.batch) so a mid-sequence crash can't
    // leave a design_image with no assistant message, or an orphaned user turn.
    // Aspect is "1:1" — chat-driven generations are always square; product
    // regenerations happen in preview/actions.ts. generationCost is an atomic
    // increment so a concurrent generate's cost isn't clobbered.
    await db.batch([
      db.insert(designImageTable).values({
        id: newImageId,
        designId,
        parentImageId,
        aspectRatio: "1:1",
        productId: null,
        placementId: null,
        imageUrl: r2Url,
        prompt: aiResponse.fluxPrompt,
        generationCost: generator.costPerImage,
        generator: generator.id,
        isApproved: false,
      }),
      ...(userMessage
        ? [
            db.insert(chatMessageTable).values({
              designId,
              role: "user" as const,
              content: userMessage,
            }),
          ]
        : []),
      db.insert(chatMessageTable).values({
        designId,
        role: "assistant" as const,
        content: aiResponse.message,
        imageId: newImageId,
      }),
      db
        .update(designTable)
        .set({
          primaryImageId: newImageId,
          generationCost: sql`${designTable.generationCost} + ${generator.costPerImage}`,
          mockupUrls: null,
          updatedAt: new Date(),
        })
        .where(eq(designTable.id, designId)),
    ]);

    return {
      message: aiResponse.message,
      imageUrl: r2Url,
      imageId: newImageId,
      generationNumber: newGeneration,
      readyToGenerate: true,
    };
  } catch (err) {
    // The DB writes failed after the R2 upload; drop the now-orphaned object so
    // the reserved key doesn't strand a file nothing references. Best-effort.
    await deleteDesignImageObject(designId, newGeneration).catch(() => {});
    throw err;
  }
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
