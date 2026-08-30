"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { auth, isAnonymousUser } from "@/lib/auth";
import {
  consumeGenerationQuota,
  refundGenerationQuota,
} from "@/lib/generation-quota";
import { db } from "@/lib/db";
import {
  design as designTable,
  chatMessage as chatMessageTable,
  orderItem as orderItemTable,
  image as imageTable,
  conversationImage as conversationImageTable,
  listing as listingTable,
} from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { buildImageRow, buildOutputLinkRow } from "@/lib/model-b-writes";
import { chatAboutDesign, constructFluxPrompt, assessReadiness } from "@/lib/ai";
import { uploadImageObject, deleteImageObject } from "@/lib/r2";
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
  getConversationSeedProvenance,
  type SourceImage,
  type ProductVersionGroup,
} from "@/lib/design-images";
import { imageReferencedByOrders, canStartFromImage } from "@/lib/design-publish";
import {
  getDesignThreadData,
  type DesignThreadData,
} from "@/lib/design-thread";
import { dedupeById, assertConversationOpen } from "@/lib/design-view";
import { isClarificationOnly } from "@/lib/design-prompt";
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

  const found = await getOrCreateDesign(designId, session.user.id);
  // Closed conversation = read-only thread (slice 3): no chat turns.
  assertConversationOpen(found);
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
  // Refuse before the quota spend — a closed thread must not burn a unit.
  assertConversationOpen(found);
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

  const generateOpts = {
    aspect: "1:1" as const,
    referenceImageUrl: anchorUrl,
    negativePrompt: aiResponse.negativePrompt,
  };
  const generationCost = generator.costFor(generateOpts);

  let imageUrl: string;
  try {
    imageUrl = await generator.generate(generator.adaptPrompt(aiResponse.fluxPrompt), generateOpts);
  } catch (err) {
    console.error("generateDesign image generation failed:", err);
    throw new Error("Image generation failed");
  }

  // The image id is minted before upload and doubles as the R2 key
  // (images/{id}.png, slice 4 §6) — concurrent generates can't collide on ids.
  // The generation number survives purely as the display counter (atomic so
  // concurrent generates don't undercount).
  const newImageId = crypto.randomUUID();
  const [newGeneration] = await reserveGenerationNumbers(designId, 1);
  const response = await fetch(imageUrl);
  const buffer = Buffer.from(await response.arrayBuffer());
  const r2Url = await uploadImageObject(newImageId, buffer);

  try {
    // Anchor provenance on the latest image the user's request was built from,
    // not a "latest by createdAt" re-read that a racing generate could shift.
    // Seeds are excluded: the within-thread parent chain is between outputs —
    // a seeded thread's first generation records parent null + seed lineage
    // (slice 3 §5).
    const outputs = images.filter((img) => img.role !== "seed");
    const parentImageId = outputs[outputs.length - 1]?.id ?? null;
    // Seed lineage (slice 3): a fresh-start thread stamps its seed +
    // attribution root onto every artifact it generates. Replaces the
    // design.forkedFromImageId/originalDesignerId mirror dropped in slice 5.
    const seed = await getConversationSeedProvenance(designId);

    // Commit the writes atomically (db.batch) so a mid-sequence crash can't
    // leave an image with no assistant message, or an orphaned user turn.
    // Aspect is "1:1" — chat-driven generations are always square; product
    // regenerations happen in preview/actions.ts. generationCost is an atomic
    // increment so a concurrent generate's cost isn't clobbered.
    // found.userId is the verified design owner.
    await db.batch([
      db.insert(imageTable).values(
        buildImageRow({
          id: newImageId,
          ownerId: found.userId,
          designId,
          imageUrl: r2Url,
          aspectRatio: "1:1",
          prompt: aiResponse.fluxPrompt,
          generator: generator.id,
          generationCost,
          parentImageId,
          seedImageId: seed?.seedImageId ?? null,
          originalDesignerId: seed?.originalDesignerId ?? null,
        })
      ),
      db.insert(conversationImageTable).values(buildOutputLinkRow(designId, newImageId)),
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
          generationCost: sql`${designTable.generationCost} + ${generationCost}`,
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
    // the id-keyed upload doesn't strand a file nothing references. Best-effort.
    await deleteImageObject(newImageId).catch(() => {});
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

  const found = await getOrCreateDesign(designId, session.user.id);
  // Closed conversation = read-only thread (slice 3): no uploads.
  assertConversationOpen(found);

  // Upload under the pre-minted image id (images/{id}.png, slice 4 §6).
  const newImageId = crypto.randomUUID();
  const buffer = Buffer.from(base64Data, "base64");
  const r2Url = await uploadImageObject(newImageId, buffer);

  // Record as an image row so the gallery picks it up and the
  // AI gallery context can reference it.
  await insertDesignImage({
    id: newImageId,
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
 * Delete an image from a design. Refuses when any order line pins the
 * image via placements (e.g. order_item.placements.front references this id),
 * so a deletion can't orphan an order's recorded thumbnail. Other references
 * (seed link, shop product, cart) downgrade the delete to a link-detach —
 * ref-counted in deleteDesignImageRow. Recomputes primary_image_id to the
 * most recent remaining source image when the delete proceeds.
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
  // state — only on real order references. Refuse if an order line depends on
  // this image (pinned in placements, or the primary a legacy line with no
  // placements falls back to); deleting would orphan the order's print.
  const orderLines = await db
    .select({ placements: orderItemTable.placements })
    .from(orderItemTable)
    .where(eq(orderItemTable.designId, designId));

  // Another design's order line can pin this image too — a back design picked
  // from My Designs/Shop (#72/#95) lands in that order's placements while its
  // line design_id stays the order's own design. Image ids are UUIDs, so the
  // substring match can't false-positive.
  const pinnedElsewhere = await db
    .select({ id: orderItemTable.id })
    .from(orderItemTable)
    .where(sql`${orderItemTable.placements} LIKE ${"%" + imageId + "%"}`)
    .limit(1);

  if (
    pinnedElsewhere.length > 0 ||
    imageReferencedByOrders(imageId, found.primaryImageId, orderLines)
  ) {
    throw new Error(
      "Can't delete this image — it's referenced by an order."
    );
  }

  // A seed image (fresh-start, slice 3) belongs to another conversation:
  // "deleting" it here only detaches the link from this thread — the image
  // row and its home thread are untouched. Checked before the row delete so
  // a seed id can never reach deleteDesignImageRow's global deletes.
  const [seedLink] = await db
    .select({ id: conversationImageTable.id })
    .from(conversationImageTable)
    .where(
      and(
        eq(conversationImageTable.designId, designId),
        eq(conversationImageTable.imageId, imageId),
        eq(conversationImageTable.role, "seed")
      )
    )
    .limit(1);
  if (seedLink) {
    await db
      .delete(conversationImageTable)
      .where(eq(conversationImageTable.id, seedLink.id));
    if (found.primaryImageId === imageId) {
      const remaining = await getDesignSourceImages(designId);
      await db
        .update(designTable)
        .set({
          primaryImageId: remaining[remaining.length - 1]?.id ?? null,
          updatedAt: new Date(),
        })
        .where(eq(designTable.id, designId));
    }
    return;
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

/**
 * Close a conversation (slice 3): the thread becomes read-only — chat,
 * generation and uploads are refused — while its history stays viewable and
 * its images stay fully usable elsewhere (orders, back picker, fresh starts).
 * Explicit-only (nothing auto-closes) and reversible via reopenConversation.
 */
export async function closeConversation(designId: string) {
  const found = await requireOwnedDesign(designId);
  if (found.closedAt) return;
  await db
    .update(designTable)
    .set({ closedAt: new Date(), updatedAt: new Date() })
    .where(eq(designTable.id, designId));
}

/** Reverse of closeConversation — nulls the timestamp, thread writable again. */
export async function reopenConversation(designId: string) {
  const found = await requireOwnedDesign(designId);
  if (!found.closedAt) return;
  await db
    .update(designTable)
    .set({ closedAt: null, updatedAt: new Date() })
    .where(eq(designTable.id, designId));
}

/**
 * Set which of a conversation's images is its primary (#136 slice 3, Q5).
 * The primary is what My Designs, /preview and the AI context treat as the
 * design's current artwork, so without an explicit action the newest
 * generation always wins and a user who prefers an earlier variant has no way
 * to say so.
 *
 * Allowed on a closed conversation: this curates the record, it doesn't write
 * to the thread (no chat, generation or upload), so assertConversationOpen
 * deliberately isn't applied.
 */
export async function setPrimaryImage(designId: string, imageId: string) {
  await requireOwnedDesign(designId);

  // The image must actually belong to this conversation — either a generation
  // of its own or a seed it was started from. Without this an owner could
  // point their design at any image id they can name.
  const [link] = await db
    .select({ id: conversationImageTable.id })
    .from(conversationImageTable)
    .where(
      and(
        eq(conversationImageTable.designId, designId),
        eq(conversationImageTable.imageId, imageId)
      )
    )
    .limit(1);
  if (!link) throw new Error("Image is not part of this design");

  await db
    .update(designTable)
    .set({ primaryImageId: imageId, updatedAt: new Date() })
    .where(eq(designTable.id, designId));

  revalidatePath("/designs");
  revalidatePath(`/d/${imageId}`);
}

async function requireOwnedDesign(designId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");
  const found = await db.query.design.findFirst({
    where: eq(designTable.id, designId),
  });
  if (!found) throw new Error("Design not found");
  if (found.userId !== session.user.id) throw new Error("Unauthorized");
  return found;
}

/**
 * Fresh-start-from-image (slice 3 §5): open a NEW conversation seeded by an
 * existing image. The seed is a `conversation_image(role=seed)` link — no R2
 * copy, no new image row (replaces the retired copy-based forkImage). The
 * seed becomes the thread's initial primary/anchor so /designs, /preview and
 * the AI context see it immediately; the first generation records
 * parent_image_id = null with seed_image_id + original_designer_id looked up
 * from this seed link (getConversationSeedProvenance in design-images.ts).
 *
 * Visibility: own image, or published + not hidden (canStartFromImage) — a
 * forged private cross-owner id is rejected. Artifacts only; placement
 * renders are cache, not seedable.
 */
export async function startConversationFromImage(
  imageId: string
): Promise<{ designId: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const [seed] = await db
    .select({
      ownerId: imageTable.ownerId,
      publishedAt: listingTable.publishedAt,
      isHidden: listingTable.isHidden,
    })
    .from(imageTable)
    .leftJoin(listingTable, eq(listingTable.imageId, imageTable.id))
    .where(eq(imageTable.id, imageId))
    .limit(1);
  if (!seed) throw new Error("Image not found");

  if (
    !canStartFromImage({
      image: {
        publishedAt: seed.publishedAt,
        // No listing row = not published (and not hidden).
        isHidden: seed.isHidden ?? false,
      },
      imageOwnerId: seed.ownerId,
      userId: session.user.id,
    })
  ) {
    throw new Error("Image is not available");
  }

  const designId = crypto.randomUUID();
  await db.batch([
    db.insert(designTable).values({
      id: designId,
      userId: session.user.id,
      // The seed is the thread's starting anchor.
      primaryImageId: imageId,
    }),
    db.insert(conversationImageTable).values({
      id: crypto.randomUUID(),
      designId,
      imageId,
      role: "seed",
    }),
  ]);

  return { designId };
}

/**
 * Whole-thread fetch for warm prefetch (#87) and any client path that needs
 * chat + gallery in one invocation (so they can never hydrate out of step).
 * Null covers missing AND foreign designs — same view either way.
 */
export async function getDesignThread(
  designId: string
): Promise<DesignThreadData | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");
  return await getDesignThreadData(designId, session.user.id);
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

  // Primary image's pinned backdrop color (#16) — /preview's color default
  // (§3): the design was published on this color, so show it on it.
  // Read from the listing — it exists only while the image is published,
  // which is exactly when the pinned backdrop applies.
  let backgroundColor: string | null = null;
  if (found.primaryImageId) {
    const [primary] = await db
      .select({ backgroundColor: listingTable.backgroundColor })
      .from(listingTable)
      .where(eq(listingTable.imageId, found.primaryImageId))
      .limit(1);
    backgroundColor = primary?.backgroundColor ?? null;
  }

  return { ...found, displayImageUrl, backgroundColor };
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
    // Seeds included (slice 3): a fresh-start thread opens showing its
    // starting image in the gallery/strip, referenceable and orderable.
    getDesignSourceImages(designId, { includeSeeds: true }),
    getDesignPlacementRenders(designId),
  ]);
  // Guard against a duplicate row ever reaching the gallery — the header
  // count and the mobile FAB badge both derive from this list, so a dupe
  // would make them disagree (#19).
  return { sources: dedupeById(sources), productGroups };
}

