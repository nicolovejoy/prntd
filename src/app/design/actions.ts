"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { auth, isAnonymousUser } from "@/lib/auth";
import {
  consumeGenerationQuota,
  refundGenerationQuota,
  dayKeyUTC,
} from "@/lib/generation-quota";
import {
  insertGenerationJob,
  failGenerationJob,
  succeedJobStatement,
  countRunningJobsForUser,
  GENERATION_CONCURRENCY_CAP,
  STALE_JOB_MS,
} from "@/lib/generation-job";
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
import { chatAboutDesign, constructDesignBrief, assessReadiness } from "@/lib/ai";
import type { ChatOption } from "@/lib/ai";
import { uploadImageObject, deleteImageObject } from "@/lib/r2";
import { getGenerator } from "@/lib/generators/registry";
import type { GenerateOperation } from "@/lib/generators/types";
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
import { renderSpecSummary } from "@/lib/design-spec";
import type { ChatMessage } from "@/lib/db/schema";
import type { DesignImage } from "@/lib/design-images";
import type { ImageGenerator } from "@/lib/generators/types";

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

/**
 * Persist the assistant's clarifying turn. The user's own turn is written up
 * front by `generateDesign` (async generation means their words must appear
 * immediately, whichever way the turn resolves), so this writes only the
 * assistant side — writing it here too would double the user's message.
 */
async function persistClarification(designId: string, message: string) {
  await insertChatMessage({ designId, role: "assistant", content: message });
  await db
    .update(designTable)
    .set({ updatedAt: new Date() })
    .where(eq(designTable.id, designId));
}

/**
 * What a generate turn resolved to. A discriminated union because generation
 * is now durable: the common outcome is "queued" — the job row exists and the
 * render finishes in an `after()` continuation, after this action returned.
 */
export type GenerateResult =
  | { kind: "queued"; jobId: string; generationNumber: number; imageId: string }
  | {
      kind: "clarification";
      message: string;
      readyToGenerate: false;
      options?: ChatOption[];
    }
  | { kind: "limit"; message: string }
  | { kind: "at_capacity"; message: string };

/** Copy shown when the user already holds the max concurrent generations. */
const AT_CAPACITY_MESSAGE = `You have ${GENERATION_CONCURRENCY_CAP} designs generating already — give them a moment.`;

export async function generateDesign(
  designId: string,
  userMessage?: string
): Promise<GenerateResult> {
  const hdrs = await headers();
  const session = await auth.api.getSession({ headers: hdrs });
  if (!session) throw new Error("Unauthorized");

  const found = await getOrCreateDesign(designId, session.user.id);
  // Refuse before the quota spend — a closed thread must not burn a unit.
  assertConversationOpen(found);
  const ip = clientIp(hdrs);
  const userId = session.user.id;
  const now = new Date();
  // The day the unit is spent on, captured once. Every refund below (and the
  // job row) carries it, so a failure noticed after midnight UTC credits the
  // bucket the spend actually came out of.
  const dayKey = dayKeyUTC(now);

  // Abuse guard (#26 A3): count this generation against the daily caps before
  // any paid model call. Over the cap → nudge to sign in, no API spend.
  const quota = await consumeGenerationQuota({
    userId,
    isAnonymous: isAnonymousUser(session.user),
    ip,
    now,
  });
  if (!quota.allowed) {
    return { kind: "limit", message: generationLimitMessage(quota.reason) };
  }

  // The user's turn lands NOW, not when the render completes. The action
  // returns before the image exists, so their own words have to be in the
  // thread immediately or the chat looks like it swallowed them. Every exit
  // below leaves this exactly one row — persistClarification writes only the
  // assistant side, and the completion batch only the assistant side.
  if (userMessage) {
    await insertChatMessage({ designId, role: "user", content: userMessage });
    await db
      .update(designTable)
      .set({ updatedAt: new Date() })
      .where(eq(designTable.id, designId));
  }

  // Advisory pre-check, not the authority: refusing here avoids paying for a
  // brief call whose job row would be rejected anyway. insertGenerationJob's
  // INSERT…WHERE is what actually enforces the cap under a race.
  // `db` is passed explicitly to every job-lifecycle call: the module's own
  // lazy `import("./db")` would otherwise construct a second client.
  const running = await countRunningJobsForUser(userId, db);
  if (running >= GENERATION_CONCURRENCY_CAP) {
    await refundGenerationQuota({ userId, ip, day: dayKey }).catch((e) =>
      console.error("refundGenerationQuota failed:", e)
    );
    return { kind: "at_capacity", message: AT_CAPACITY_MESSAGE };
  }

  // Everything up to the job insert runs inside the request. A throw there has
  // no job row to gate a refund on, so it refunds directly; once the row
  // exists, failGenerationJob owns the refund (transition + refund together,
  // so a sweeper and a live failure can't both give the unit back).
  try {
    return await runGenerate({ designId, found, userMessage, userId, ip, dayKey });
  } catch (err) {
    await refundGenerationQuota({ userId, ip, day: dayKey }).catch((e) =>
      console.error("refundGenerationQuota failed:", e)
    );
    throw err;
  }
}

async function runGenerate({
  designId,
  found,
  userMessage,
  userId,
  ip,
  dayKey,
}: {
  designId: string;
  found: typeof designTable.$inferSelect;
  userMessage?: string;
  userId: string;
  ip: string | null;
  dayKey: string;
}): Promise<GenerateResult> {
  const messages = await getDesignMessages(designId);
  const images = await getDesignImagesForAIContext(designId);

  // The user's turn is already persisted (generateDesign writes it up front),
  // and buildMessages appends `userMessage` itself — so drop the trailing copy
  // rather than feeding the model the same sentence twice. Only the LAST row is
  // considered, so an identical message from an earlier turn stays in context.
  const last = messages[messages.length - 1];
  const messagesForPrompt: ChatMessage[] =
    userMessage && last?.role === "user" && last.content === userMessage
      ? messages.slice(0, -1)
      : messages;

  // Fast pre-check: if the idea is too thin to render, ask for the missing
  // piece in ~1s (Haiku) instead of paying the heavy constructDesignBrief
  // round-trip just to surface a clarifying question. Fails open.
  const readiness = await assessReadiness(messagesForPrompt, images, userMessage);
  if (!readiness.ready) {
    await persistClarification(designId, readiness.question);
    return {
      kind: "clarification",
      message: readiness.question,
      readyToGenerate: false,
      options: readiness.options,
    };
  }

  let brief;
  try {
    brief = await constructDesignBrief(messagesForPrompt, images, userMessage);
  } catch (err) {
    console.error("constructDesignBrief failed:", err);
    throw new Error("Failed to construct prompt");
  }

  if (brief.operation === "clarify") {
    await persistClarification(designId, brief.message);
    return { kind: "clarification", message: brief.message, readyToGenerate: false };
  }

  const generator = getGenerator(found.activeGeneratorId);

  let generateOp: GenerateOperation;
  let anchorImageId: string | null = null;
  if (brief.operation === "edit") {
    const referencedImage =
      brief.referenceImage != null
        ? images.find((img) => img.number === brief.referenceImage)
        : undefined;
    // No explicit reference → the latest OUTPUT is what "make it larger"
    // means. But a fresh-start thread may have only a seed (no outputs yet) —
    // that seed is still a legitimate, on-screen design to edit, so fall back
    // to the latest image of any role rather than refusing. (Provenance below
    // uses a separate, seed-excluding `outputs` lookup — parent lineage must
    // never point at a seed; this one is purely "what is the user looking at".)
    const anchorOutputs = images.filter((img) => img.role !== "seed");
    const anchor =
      referencedImage ??
      anchorOutputs[anchorOutputs.length - 1] ??
      images[images.length - 1];
    if (!anchor) {
      // An edit classified on an imageless thread is a model error; there is
      // nothing to edit, so ask instead of rendering.
      const message =
        "There's no design to edit yet — tell me what you'd like on the shirt.";
      await persistClarification(designId, message);
      return { kind: "clarification", message, readyToGenerate: false };
    }
    anchorImageId = anchor.id;
    generateOp = {
      kind: "edit",
      instruction: brief.editInstruction,
      anchorImageUrl: anchor.url,
    };
  } else {
    generateOp = { kind: "generate", spec: brief.spec };
  }

  const generationCost = generator.costFor(generateOp);

  // The image id is minted before the provider call and doubles as the R2 key
  // (images/{id}.png, slice 4 §6) — concurrent generates can't collide on ids.
  // The generation number is reserved HERE, ahead of the render, so numbering
  // is submit-order: two jobs started a second apart keep that order in the
  // strip no matter which provider call returns first.
  const newImageId = crypto.randomUUID();
  const [generationNumber] = await reserveGenerationNumbers(designId, 1);

  const inserted = await insertGenerationJob({
    designId,
    userId,
    operation: brief.operation === "edit" ? "edit" : "generate",
    imageId: newImageId,
    r2Key: `images/${newImageId}.png`,
    anchorImageId,
    generationNumber,
    dayKey,
    ip,
    cost: generationCost,
    db,
  });
  if (!inserted.ok) {
    // The authoritative cap. The advisory check above lost a race (two tabs),
    // so give the unit back and say so.
    await refundGenerationQuota({ userId, ip, day: dayKey }).catch((e) =>
      console.error("refundGenerationQuota failed:", e)
    );
    return { kind: "at_capacity", message: AT_CAPACITY_MESSAGE };
  }

  const job = inserted.job;
  const storedPrompt =
    brief.operation === "edit" ? brief.editInstruction : renderSpecSummary(brief.spec);

  // Hand the render to the background. `after` keeps the function instance
  // alive past the response for up to the route's maxDuration (see
  // design/page.tsx: server actions inherit the RENDERING route's segment
  // config), and the continuation never throws past this boundary — an
  // unhandled rejection can take down the shared Fluid instance and with it
  // other users' in-flight continuations.
  after(() =>
    runGenerationJob({
      jobId: job.id,
      designId,
      ownerId: found.userId,
      imageId: newImageId,
      generationNumber,
      generateOp,
      generator,
      generationCost,
      assistantMessage: brief.message,
      storedPrompt,
      images,
      startedAt: job.startedAt,
    })
  );

  return {
    kind: "queued",
    jobId: job.id,
    generationNumber,
    imageId: newImageId,
  };
}

/**
 * The background half of a generation: provider call → R2 → one atomic batch
 * of writes. Runs inside `after()`, so it must never reject.
 *
 * Accepted edge case: a continuation slower than STALE_JOB_MS can land after
 * the lazy sweeper already failed and refunded this job. The deadline check
 * below closes the common case (skip the write, drop the object); what remains
 * is a user who got both their image and their quota unit back. Generous,
 * rare, harmless — deliberately not engineered away.
 */
async function runGenerationJob(params: {
  jobId: string;
  designId: string;
  ownerId: string;
  imageId: string;
  generationNumber: number;
  generateOp: GenerateOperation;
  generator: ImageGenerator;
  generationCost: number;
  assistantMessage: string;
  storedPrompt: string;
  /** Thread images as of submit time — provenance anchors on these, never on
   * a later re-read a racing generation could have shifted. */
  images: DesignImage[];
  startedAt: Date;
}): Promise<void> {
  const {
    jobId,
    designId,
    imageId,
    generationNumber,
    generationCost,
    images,
  } = params;
  try {
    const sourceUrl = await params.generator.generate(params.generateOp, {
      aspect: "1:1",
    });
    const response = await fetch(sourceUrl);
    const buffer = Buffer.from(await response.arrayBuffer());
    const r2Url = await uploadImageObject(imageId, buffer);

    // Self-fail against the deadline BEFORE writing: past STALE_JOB_MS a
    // sweeper may already have failed and refunded this job, and
    // succeedJobStatement would then match zero rows while the image row
    // landed anyway. Skip the write and drop the orphaned object.
    if (Date.now() - params.startedAt.getTime() > STALE_JOB_MS) {
      console.warn("[generation] continuation finished past the deadline", {
        jobId,
        designId,
      });
      await deleteImageObject(imageId).catch(() => {});
      return;
    }

    // Anchor provenance on the images the request was built from. Seeds are
    // excluded: the within-thread parent chain is between outputs — a seeded
    // thread's first generation records parent null + seed lineage (slice 3 §5).
    const outputs = images.filter((img) => img.role !== "seed");
    const parentImageId = outputs[outputs.length - 1]?.id ?? null;
    const seed = await getConversationSeedProvenance(designId);
    const now = new Date();

    // One batch so a mid-sequence crash can't leave an image with no assistant
    // message. The two design updates are deliberately separate:
    //  - cost accrues UNCONDITIONALLY (the render was paid for either way);
    //  - the primary-image claim is guarded, so a newer succeeded generation
    //    keeps the hero, and a cancelled job appends its image without
    //    clobbering what the user moved on to.
    // Folding the cost increment into the guarded statement would silently
    // drop the cost whenever a newer job had already claimed primary.
    await db.batch([
      db.insert(imageTable).values(
        buildImageRow({
          id: imageId,
          ownerId: params.ownerId,
          designId,
          imageUrl: r2Url,
          aspectRatio: "1:1",
          prompt: params.storedPrompt,
          generator: params.generator.id,
          generationCost,
          parentImageId,
          seedImageId: seed?.seedImageId ?? null,
          originalDesignerId: seed?.originalDesignerId ?? null,
        })
      ),
      db.insert(conversationImageTable).values(buildOutputLinkRow(designId, imageId)),
      db.insert(chatMessageTable).values({
        designId,
        role: "assistant" as const,
        content: params.assistantMessage,
        imageId,
      }),
      db
        .update(designTable)
        .set({
          generationCost: sql`${designTable.generationCost} + ${generationCost}`,
          updatedAt: now,
        })
        .where(eq(designTable.id, designId)),
      db.run(sql`
        update design
        set primary_image_id = ${imageId}, mockup_urls = null
        where id = ${designId}
          and not exists (
            select 1 from image_generation g
            where g.design_id = ${designId}
              and g.status = 'succeeded'
              and g.generation_number > ${generationNumber}
          )
          and (select cancelled_at from image_generation where id = ${jobId}) is null
      `),
      // Runs whether or not the job was cancelled: this transition is what
      // releases the concurrency slot, and cancellation must only affect the
      // primary claim above (generation-job.ts, succeedJobStatement).
      succeedJobStatement(db, jobId, now),
    ]);
  } catch (err) {
    // Best-effort cleanup of the (possibly) uploaded object, then the one
    // transition that also refunds. Never rethrow: this runs detached.
    await deleteImageObject(imageId).catch(() => {});
    const message = err instanceof Error ? err.message : String(err);
    console.error("[generation] job failed", { jobId, designId, error: message });
    await failGenerationJob({ jobId, error: message, db }).catch((e) =>
      console.error("[generation] failGenerationJob failed", {
        jobId,
        error: e instanceof Error ? e.message : String(e),
      })
    );
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

