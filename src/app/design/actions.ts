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
  discardCancelledJobStatement,
  insertIfJobSucceededStatement,
  countRunningJobsForUser,
  getRunningJobsForDesign,
  sweepStaleJobs,
  cancelGenerationJob,
  GENERATION_CONCURRENCY_CAP,
  CONTINUATION_DEADLINE_MS,
} from "@/lib/generation-job";
import { db } from "@/lib/db";
import {
  design as designTable,
  chatMessage as chatMessageTable,
  image as imageTable,
  conversationImage as conversationImageTable,
  imagePublication as imagePublicationTable,
  product as productTable,
  imageGeneration as imageGenerationTable,
} from "@/lib/db/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import {
  isPublishedShopMirror,
  mirrorFrontImageId,
} from "@/lib/composition-reads";
import { buildImageRow, buildOutputLinkRow } from "@/lib/model-b-writes";
import { chatAboutDesign, constructDesignBrief } from "@/lib/ai";
import { uploadImageObject, deleteImageObject } from "@/lib/r2";
import { getGenerator } from "@/lib/generators/registry";
import type { GenerateOperation } from "@/lib/generators/types";
import {
  insertDesignImage,
  reserveGenerationNumbers,
  findDesignImageByUrl,
  getDesignSourceImages,
  getDesignPlacementRenders,
  getDesignDisplayImageUrl,
  getDesignMessages,
  insertChatMessage,
  getDesignImagesForAIContext,
  getConversationSeedProvenance,
  type SourceImage,
  type ProductVersionGroup,
} from "@/lib/design-images";
import { canStartFromImage } from "@/lib/design-publish";
import {
  planImageDeletion,
  executeImageDeletion,
} from "@/lib/delete-image";
import {
  getDesignThreadData,
  type DesignThreadData,
} from "@/lib/design-thread";
import { dedupeById, assertConversationOpen } from "@/lib/design-view";
import {
  classifyGenerationFailure,
  type GenerationFailure,
} from "@/lib/generation-poll";
import { renderSpecSummary, fallbackSpec } from "@/lib/design-spec";
import { latestUserText } from "@/lib/design-prompt";
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
  // Now only reachable when a generate turn has no words at all behind it —
  // every other turn renders (studio slice 1). No options ride along: the
  // brief's clarify has no chip channel, and this exit is a dead end, not a
  // question worth answering with a tap.
  | { kind: "clarification"; message: string; readyToGenerate: false }
  | { kind: "limit"; message: string }
  | { kind: "at_capacity"; message: string };

/** Copy shown when the user already holds the max concurrent generations. */
const AT_CAPACITY_MESSAGE = `You have ${GENERATION_CONCURRENCY_CAP} designs generating already — give them a moment.`;

export async function generateDesign(
  designId: string,
  userMessage?: string,
  opts: {
    /**
     * Explicit anchor (studio slice 3): the image the user tapped before
     * typing. Deterministic — the turn becomes an edit of exactly this image,
     * whatever the brief would have classified. Must be one of the
     * conversation's own images or the whole turn is refused.
     */
    anchorImageId?: string;
  } = {}
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

  // ADVISORY capacity check, before anything is written. Refusing here avoids
  // paying for a brief call whose job row would be rejected anyway, and —
  // because it runs ahead of the user-turn persist — the common over-capacity
  // refusal leaves no trace in the thread, exactly like the quota-denied path
  // above. insertGenerationJob's INSERT…WHERE is the actual authority.
  // `db` is passed explicitly to every job-lifecycle call: the module's own
  // lazy `import("./db")` would otherwise construct a second client.
  const running = await countRunningJobsForUser(userId, db);
  if (running >= GENERATION_CONCURRENCY_CAP) {
    await refundGenerationQuota({ userId, ip, day: dayKey }).catch((e) =>
      console.error("refundGenerationQuota failed:", e)
    );
    return { kind: "at_capacity", message: AT_CAPACITY_MESSAGE };
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

  // The direct-refund catch covers the pre-job span ONLY. A throw here has no
  // job row to gate a refund on, so it refunds inline; the moment a row exists,
  // failGenerationJob (transition + refund together) is the sole refunder, and
  // a direct refund overlapping that span would let a sweeper refund the same
  // unit a second time. `prepareGeneration` therefore RETURNS the inserted job
  // rather than scheduling the continuation itself — everything past the insert
  // happens below, outside the try.
  let prepared: PreparedGeneration;
  try {
    prepared = await prepareGeneration({
      designId,
      found,
      userMessage,
      userId,
      ip,
      dayKey,
      explicitAnchorId: opts.anchorImageId ?? null,
    });
  } catch (err) {
    await refundGenerationQuota({ userId, ip, day: dayKey }).catch((e) =>
      console.error("refundGenerationQuota failed:", e)
    );
    throw err;
  }
  if (prepared.kind !== "prepared") {
    // No job row was created, so nothing owns the unit spent above — give it
    // back. Only the clarification exit needs this: `at_capacity` refunds
    // inside prepareGeneration (it is raised by the insert itself), and a
    // second refund here would credit the same unit twice.
    if (prepared.kind === "clarification") {
      await refundGenerationQuota({ userId, ip, day: dayKey }).catch((e) =>
        console.error("refundGenerationQuota failed:", e)
      );
    }
    return prepared;
  }

  // Past this line a job row exists and owns its own quota unit. Hand the
  // render to the background: `after` keeps the function instance alive past
  // the response for up to the route's maxDuration (see design/page.tsx —
  // server actions inherit the RENDERING route's segment config), and the
  // continuation never throws past that boundary; an unhandled rejection can
  // take down the shared Fluid instance and with it other users' work.
  after(() => runGenerationJob(prepared.continuation));

  return {
    kind: "queued",
    jobId: prepared.jobId,
    generationNumber: prepared.generationNumber,
    imageId: prepared.imageId,
  };
}

/**
 * What `prepareGeneration` hands back. "prepared" means the job row exists —
 * the caller must schedule the continuation and must NOT refund on its own.
 */
type PreparedGeneration =
  | Exclude<GenerateResult, { kind: "queued" } | { kind: "limit" }>
  | {
      kind: "prepared";
      jobId: string;
      generationNumber: number;
      imageId: string;
      continuation: GenerationJobParams;
    };

async function prepareGeneration({
  designId,
  found,
  userMessage,
  userId,
  ip,
  dayKey,
  explicitAnchorId,
}: {
  designId: string;
  found: typeof designTable.$inferSelect;
  userMessage?: string;
  userId: string;
  ip: string | null;
  dayKey: string;
  explicitAnchorId: string | null;
}): Promise<PreparedGeneration> {
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

  // No readiness pre-check any more (studio slice 1): a generate request
  // always produces a generation, so there is nothing for a "render vs ask"
  // gate to decide. The brief below still asks its question — attached to the
  // image it renders, never instead of one.
  let brief;
  try {
    brief = await constructDesignBrief(messagesForPrompt, images, userMessage);
  } catch (err) {
    console.error("constructDesignBrief failed:", err);
    throw new Error("Failed to construct prompt");
  }

  const generator = getGenerator(found.activeGeneratorId);

  let generateOp: GenerateOperation | undefined;
  let anchorImageId: string | null = null;

  // Studio slice 3: a tapped-cell anchor is explicit and deterministic. The
  // brief still writes the best edit instruction it can, but it never picks a
  // different anchor and never downgrades the turn to a from-scratch generate
  // — what the user tapped is what gets edited. An id that isn't one of this
  // conversation's images is a stale tap or a forged id; refuse before any
  // row exists (the caller's direct-refund catch covers this span).
  const explicitAnchor = explicitAnchorId
    ? images.find((img) => img.id === explicitAnchorId)
    : undefined;
  if (explicitAnchorId && !explicitAnchor) {
    throw new Error("Anchor image is not part of this conversation");
  }
  if (explicitAnchor) {
    const instruction =
      brief.operation === "edit"
        ? brief.editInstruction
        : userMessage?.trim() || latestUserText(messagesForPrompt);
    // No words at all behind the turn → nothing to instruct the edit with;
    // fall through to the normal clarify handling below.
    if (instruction) {
      anchorImageId = explicitAnchor.id;
      generateOp = {
        kind: "edit",
        instruction,
        anchorImageUrl: explicitAnchor.url,
      };
    }
  }

  if (generateOp) {
    // explicit anchor resolved above
  } else if (brief.operation === "clarify") {
    // A clarify brief is no longer an exit. The user asked for a design, so
    // their literal request gets rendered and the brief's question rides along
    // as the assistant turn attached to that image — a question is an addition
    // to a result, never a substitute for one. Only a turn with no words at
    // all behind it has nothing to render.
    const spec = fallbackSpec(
      userMessage?.trim() || latestUserText(messagesForPrompt)
    );
    if (!spec) {
      await persistClarification(designId, brief.message);
      return { kind: "clarification", message: brief.message, readyToGenerate: false };
    }
    generateOp = { kind: "generate", spec };
  } else if (brief.operation === "edit") {
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
      // An edit classified on an imageless thread is a model error. There is
      // nothing to anchor on, but the instruction still describes a design —
      // render it from scratch rather than refusing the turn.
      const spec = fallbackSpec(brief.editInstruction);
      if (!spec) {
        const message =
          "There's no design to edit yet — tell me what you'd like on the shirt.";
        await persistClarification(designId, message);
        return { kind: "clarification", message, readyToGenerate: false };
      }
      generateOp = { kind: "generate", spec };
    } else {
      anchorImageId = anchor.id;
      generateOp = {
        kind: "edit",
        instruction: brief.editInstruction,
        anchorImageUrl: anchor.url,
      };
    }
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
  // Computed BEFORE the insert on purpose. Everything the caller's
  // direct-refund catch covers must happen while no job row exists; a throw in
  // here after a successful insert would refund inline AND leave a `running`
  // row for the sweeper to refund again. The insert is the last thing in this
  // function that can throw.
  // Keyed off the resolved operation, not the brief's: a clarify brief and an
  // anchorless edit both come out the far side as generates, and the stored
  // prompt has to describe what was actually rendered.
  const storedPrompt =
    generateOp.kind === "edit"
      ? generateOp.instruction
      : renderSpecSummary(generateOp.spec);

  const inserted = await insertGenerationJob({
    designId,
    userId,
    operation: generateOp.kind,
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
    // The AUTHORITATIVE cap: the advisory check above passed and then lost a
    // race (a second tab starting a generation in between). Unlike the advisory
    // refusal this is not dead code, and the user's turn is already in the
    // thread — so answer it, rather than leaving their message hanging.
    await refundGenerationQuota({ userId, ip, day: dayKey }).catch((e) =>
      console.error("refundGenerationQuota failed:", e)
    );
    // Swallowed rather than thrown: the refund above already happened, so a
    // throw from here would reach the caller's direct-refund catch and give
    // the same unit back twice. A missing assistant turn is the smaller loss.
    await persistClarification(designId, AT_CAPACITY_MESSAGE).catch((e) =>
      console.error("persistClarification failed:", e)
    );
    return { kind: "at_capacity", message: AT_CAPACITY_MESSAGE };
  }

  const job = inserted.job;

  // Return the continuation rather than scheduling it: the caller schedules it
  // outside its direct-refund try, so no span where this job row exists is also
  // covered by an inline refund (that overlap is the double-refund the
  // hardening contract exists to prevent).
  return {
    kind: "prepared",
    jobId: job.id,
    generationNumber,
    imageId: newImageId,
    continuation: {
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
      anchorImageId,
      startedAt: job.startedAt,
    },
  };
}

type GenerationJobParams = {
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
  /** The image this render anchored on (edits), mirroring the job row. */
  anchorImageId: string | null;
  startedAt: Date;
};

/**
 * Best-effort delete of an orphaned R2 object, LOGGED on failure. A
 * `cancelled` row is terminal and never swept, so a delete that fails here
 * has no second chance — a silent catch would make it a permanent orphan
 * nobody can find. Never throws: every caller is on a path that must not
 * reject.
 */
async function deleteOrphanedObject(jobId: string, imageId: string) {
  await deleteImageObject(imageId).catch((e) =>
    console.warn("[generation] orphan delete failed", {
      jobId,
      imageId,
      error: e instanceof Error ? e.message : String(e),
    })
  );
}

/** Accrue a render's cost on the design (internal accounting, never priced). */
async function bookGenerationCost(designId: string, generationCost: number) {
  await db
    .update(designTable)
    .set({ generationCost: sql`${designTable.generationCost} + ${generationCost}` })
    .where(eq(designTable.id, designId));
}

/**
 * The background half of a generation: provider call → R2 → one atomic batch
 * of writes. Runs inside `after()`, so it must never reject.
 *
 * Cancellation (#187): a cancelled job discards its result. The request is
 * checked twice. Once right after the provider returns, BEFORE the fetch and
 * the R2 upload — the flow allows it because the provider hands back a URL,
 * nothing of ours exists yet, so the common case never uploads an object it
 * would only delete. And once more inside the write batch, where the check
 * is not a read but the conditional succeed transition itself: every row the
 * batch lands is `INSERT … SELECT … WHERE status = 'succeeded'` against the
 * job row that the batch's first statement just updated (or did not), all in
 * one transaction. A cancel that commits between the early check and the
 * batch is therefore caught by the batch; one that commits after the batch
 * finds a settled row and does nothing. Either way the cost is booked — the
 * render was paid for — and quota is never refunded for a cancel.
 *
 * Accepted edge case: a continuation slower than CONTINUATION_DEADLINE_MS can
 * come back after the lazy sweeper already failed and refunded this job. The
 * deadline check below closes the common case (skip the write, drop the
 * object); a continuation that clears it and still loses the transition
 * (neither succeed nor discard matched) lands nothing and drops the object
 * too — the sweep's refund stands and the user simply gets no image.
 */
async function runGenerationJob(params: GenerationJobParams): Promise<void> {
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

    // Early discard: the cheapest place to honour a cancel is before we own
    // any bytes. The conditional transition (running AND cancel requested) is
    // the decision; it matches at most once for the row's lifetime, so the
    // cost is booked exactly once and never for a job the sweep already
    // failed. A crash between the two statements loses only the internal
    // cost line, never a user-visible row.
    const early = await discardCancelledJobStatement(db, jobId, new Date());
    if (early.rowsAffected === 1) {
      await bookGenerationCost(designId, generationCost);
      console.info("[generation] discarded a cancelled job before upload", {
        jobId,
        designId,
      });
      return;
    }

    const response = await fetch(sourceUrl);
    const buffer = Buffer.from(await response.arrayBuffer());
    const r2Url = await uploadImageObject(imageId, buffer);

    // Self-fail against the deadline BEFORE writing: past the cutoff a sweeper
    // may already have failed and refunded this job, and succeedJobStatement
    // would then match zero rows while the image row landed anyway. Skip the
    // write and drop the orphaned object.
    //
    // The deadline is CONTINUATION_DEADLINE_MS, strictly below the sweep's
    // STALE_JOB_MS, so the two can never overlap — with no margin, a
    // continuation clearing this check at 4:59.9 could still be mid-batch when
    // the cron sweep fails the row and reclaims its R2 object.
    if (Date.now() - params.startedAt.getTime() > CONTINUATION_DEADLINE_MS) {
      console.warn("[generation] continuation finished past the deadline", {
        jobId,
        designId,
      });
      await deleteOrphanedObject(jobId, imageId);
      return;
    }

    // Anchor provenance on the images the request was built from. Seeds are
    // excluded: the within-thread parent chain is between outputs — a seeded
    // thread's first generation records parent null + seed lineage (slice 3 §5).
    // An edit that anchored on a specific OUTPUT records that output as its
    // parent (studio slice 3 — "try it three ways" fans out from one image, so
    // "latest output" would chain the fan into a line); seed anchors and
    // from-scratch generates keep the latest-output fallback.
    const outputs = images.filter((img) => img.role !== "seed");
    const anchorOutput = params.anchorImageId
      ? outputs.find((img) => img.id === params.anchorImageId)
      : undefined;
    const parentImageId =
      anchorOutput?.id ?? outputs[outputs.length - 1]?.id ?? null;
    const seed = await getConversationSeedProvenance(designId);
    const now = new Date();

    // One batch (one libSQL transaction) so a mid-sequence crash can't leave an
    // image with no assistant message, and so the cancel decision and the
    // rows it governs commit together. Order matters:
    //  1. the two job transitions go FIRST — succeed (running, not cancelled)
    //     and discard (running, cancelled). At most one matches; a job the
    //     sweep already failed matches neither.
    //  2. the image row, the conversation link and the chat turn are
    //     `INSERT … SELECT … WHERE status = 'succeeded'` against the job row
    //     as updated by step 1 in this same transaction. No read of
    //     `cancelled_at` is involved, so a cancel cannot slip in between a
    //     check and the insert: it either committed before this transaction
    //     (discard matches, nothing lands) or it waits behind it and then
    //     finds a settled row (cancelGenerationJob reports false).
    //  3. cost accrues UNCONDITIONALLY — the render was paid for either way,
    //     cancelled included. Folding it into a guarded statement would
    //     silently drop the cost whenever the claim was skipped.
    //  4. the primary-image claim is guarded: only a job that just succeeded
    //     claims, and only if no newer succeeded generation already holds the
    //     hero. The subquery skips newer generations that are not succeeded
    //     (cancelled ones since #187; historical cancelled-but-succeeded rows
    //     via `cancelled_at is null`) so a generation the user walked away
    //     from never blocks an older, still-wanted one from becoming the hero.
    const [succeeded, discarded] = await db.batch([
      succeedJobStatement(db, jobId, now),
      discardCancelledJobStatement(db, jobId, now),
      insertIfJobSucceededStatement(
        db,
        jobId,
        imageTable,
        buildImageRow({
          id: imageId,
          ownerId: params.ownerId,
          designId,
          imageUrl: r2Url,
          aspectRatio: "1:1",
          prompt: params.storedPrompt,
          // Keyed off the RESOLVED operation for the same reason storedPrompt
          // is (studio slice 1): a clarify brief and an anchorless edit both
          // come out the far side as generates. The spec rides along in the
          // continuation's closure, so no job-row column is needed — a
          // continuation that loses its instance never completes at all, it
          // gets swept and refunded.
          operation: params.generateOp.kind,
          designSpec:
            params.generateOp.kind === "generate" ? params.generateOp.spec : null,
          generator: params.generator.id,
          generationCost,
          parentImageId,
          seedImageId: seed?.seedImageId ?? null,
          originalDesignerId: seed?.originalDesignerId ?? null,
        })
      ),
      insertIfJobSucceededStatement(
        db,
        jobId,
        conversationImageTable,
        buildOutputLinkRow(designId, imageId)
      ),
      insertIfJobSucceededStatement(db, jobId, chatMessageTable, {
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
          and exists (
            select 1 from image_generation where id = ${jobId} and status = 'succeeded'
          )
          and not exists (
            select 1 from image_generation g
            where g.design_id = ${designId}
              and g.status = 'succeeded'
              and g.cancelled_at is null
              and g.generation_number > ${generationNumber}
          )
      `),
    ]);

    if (succeeded.rowsAffected === 1) return;

    // Nothing landed: either the cancel request won the race after the early
    // check (discard matched) or the sweep failed this job first (neither
    // matched — the refund stands). The object we uploaded is an orphan in
    // both cases.
    await deleteOrphanedObject(jobId, imageId);
    console.info(
      discarded.rowsAffected === 1
        ? "[generation] discarded a cancelled job after upload"
        : "[generation] continuation lost the transition; nothing landed",
      { jobId, designId }
    );
  } catch (err) {
    // Best-effort cleanup of the (possibly) uploaded object, then the one
    // transition that also refunds. Never rethrow: this runs detached.
    await deleteOrphanedObject(jobId, imageId);
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
    operation: "upload",
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
 * Delete an image from a design. The rules live in src/lib/delete-image.ts
 * (shared with the bulk library delete): an order reference refuses; a seed
 * link, a shop product pin or a cart pin downgrade the delete to a
 * link-detach; otherwise the image row, its listing and its mirror product
 * go. An id this thread can't reach is "Image not found" — owning the design
 * doesn't authorise deleting an image it never had. primary_image_id moves
 * inside the same batch when the deleted image was the primary.
 */
export async function deleteDesignImage(designId: string, imageId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const found = await db.query.design.findFirst({
    where: eq(designTable.id, designId),
  });
  if (!found || found.userId !== session.user.id)
    throw new Error("Unauthorized");

  // Ownership is the design check above — a seed image belongs to another
  // conversation (possibly another user), and detaching it from this thread
  // is the design owner's call. So the plan is design-scoped, not
  // image-scoped.
  const plan = await planImageDeletion(db, imageId, { designId });

  // Publishing is reversible, so deletion is no longer blocked on publish
  // state — only on real order references: an order line pinning this image
  // (any order's, since a back design can be picked from another thread —
  // #72/#95), or the legacy fallback where a line with no placements resolves
  // to the design's primary. Deleting would orphan the order's print.
  if (plan.outcome === "blocked-by-order") {
    throw new Error("Can't delete this image — it's referenced by an order.");
  }

  // Owning the design authorises only the images that design can see (a
  // conversation link of either role, or a render it produced). An id it
  // can't reach isn't this thread's to delete, whoever owns it.
  if (plan.outcome === "not-found") throw new Error("Image not found");

  // One batch, including the primary_image_id move when this image was the
  // thread's primary — no follow-up write to fail after the rows are gone.
  await executeImageDeletion(db, plan);
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

/**
 * Owner-gated. Sweeps this design's overdue rows, then reports state.
 *
 * The client passes the job ids it is currently tracking. An earlier draft
 * had the server report jobs "settled since the client last looked", which
 * is unimplementable without server-side per-client cursors — the client
 * already knows what it is waiting on, so it says so.
 *
 * A failure is reported as a CLASSIFIED `failure`, never the job row's raw
 * `error`: that string is provider or internal text (it can echo prompt
 * content or vendor moderation wording) and this data reaches a browser. The
 * raw string stays in the job row and the server logs.
 *
 * `running` excludes cancelled-but-running jobs on purpose:
 * getRunningJobsForDesign deliberately includes them (cancel doesn't stop
 * the render, so the row genuinely still holds its concurrency slot), but a
 * cancelled job is not something the UI should render as an active spinner
 * — the caller already knows it cancelled that job.
 *
 * A job that reached the terminal `cancelled` status (#187: the continuation
 * came back and discarded the result) is reported as settled with neither an
 * image nor a failure — it tells a tracking client (another tab, say) to stop
 * waiting, and nothing else.
 */
export async function getDesignJobs(
  designId: string,
  trackedJobIds: string[]
): Promise<{
  running: { jobId: string; generationNumber: number; startedAt: number }[];
  settled: {
    jobId: string;
    status: "succeeded" | "failed" | "cancelled";
    imageId: string | null;
    failure: GenerationFailure | null;
  }[];
}> {
  await requireOwnedDesign(designId);

  // Narrowest scope for this call site — only the cron sweeps scope: "all".
  await sweepStaleJobs({ scope: "design", designId, db });

  const jobs = await getRunningJobsForDesign(designId, db);
  const running = jobs
    .filter((job) => job.cancelledAt === null)
    .map((job) => ({
      jobId: job.id,
      generationNumber: job.generationNumber,
      startedAt: job.startedAt.getTime(),
    }));

  const runningIds = new Set(jobs.map((job) => job.id));
  const settledIds = trackedJobIds.filter((id) => !runningIds.has(id));

  let settled: {
    jobId: string;
    status: "succeeded" | "failed" | "cancelled";
    imageId: string | null;
    failure: GenerationFailure | null;
  }[] = [];
  if (settledIds.length > 0) {
    const rows = await db
      .select()
      .from(imageGenerationTable)
      .where(
        and(
          eq(imageGenerationTable.designId, designId),
          inArray(imageGenerationTable.id, settledIds)
        )
      );
    settled = rows
      .filter(
        (
          row
        ): row is typeof row & { status: "succeeded" | "failed" | "cancelled" } =>
          row.status === "succeeded" ||
          row.status === "failed" ||
          row.status === "cancelled"
      )
      .map((row) => ({
        jobId: row.id,
        status: row.status,
        // The id was minted before the provider call regardless of outcome
        // (it's also the R2 key stem); only report it once the image it
        // names actually exists.
        imageId: row.status === "succeeded" ? row.imageId : null,
        failure:
          row.status === "failed" ? classifyGenerationFailure(row.error) : null,
      }));
  }

  return { running, settled };
}

/**
 * Client-initiated cancel of one running generation (#59, now durable).
 *
 * Owner-gated in the lifecycle layer by matching `user_id`, so a forged job id
 * from another thread affects zero rows. Cancelling does NOT stop the provider
 * call — the render was paid for and will finish — but its result is
 * discarded when it comes back (#187): no image, no chat turn, no primary
 * claim; the cost is still booked and the quota unit is not refunded. Unlike
 * the old client-only ref this crosses tabs: the row is the state.
 *
 * Returns whether a row was actually cancelled; a false is not an error (the
 * job may have settled between the tap and the call — in which case its image
 * stays), so the UI drops the row either way.
 */
export async function cancelGeneration(jobId: string): Promise<boolean> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");
  return cancelGenerationJob({ jobId, userId: session.user.id, db });
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
      publishedAt: imagePublicationTable.publishedAt,
      isHidden: imagePublicationTable.isHidden,
    })
    .from(imageTable)
    .leftJoin(imagePublicationTable, eq(imagePublicationTable.imageId, imageTable.id))
    .where(eq(imageTable.id, imageId))
    .limit(1);
  if (!seed) throw new Error("Image not found");

  if (
    !canStartFromImage({
      image: {
        publishedAt: seed.publishedAt,
        // No publication row = not published (and not hidden).
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
  // Composition slice 2: read from the image's mirror `product` row, and only
  // while it is published (non-draft), which is exactly when the pinned
  // backdrop applies — the same condition the visibility row used to encode.
  let backgroundColor: string | null = null;
  if (found.primaryImageId) {
    const [primary] = await db
      .select({ backgroundColor: productTable.backdropColor })
      .from(productTable)
      .where(
        and(
          isPublishedShopMirror(),
          eq(mirrorFrontImageId, found.primaryImageId)
        )
      )
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

