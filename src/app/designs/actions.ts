"use server";

import { headers } from "next/headers";
import { auth, isAnonymousUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  design as designTable,
  designImage as designImageTable,
  chatMessage as chatMessageTable,
  order as orderTable,
} from "@/lib/db/schema";
import { eq, desc, and, not, count, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { resolveDesignDisplayImageUrls } from "@/lib/design-images";
import { generatePublishedNaming } from "@/lib/ai";

export async function getUserDesigns() {
  const session = await auth.api.getSession({ headers: await headers() });
  // Personal page — anonymous guests (#26) must sign in; their in-progress
  // drafts surface here only after they claim them by signing up.
  if (!session || isAnonymousUser(session.user)) throw new Error("Unauthorized");

  const designs = await db.query.design.findMany({
    where: and(
      eq(designTable.userId, session.user.id),
      not(eq(designTable.status, "archived"))
    ),
    orderBy: desc(designTable.updatedAt),
    columns: {
      id: true,
      status: true,
      generationCount: true,
      primaryImageId: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const imageUrls = await resolveDesignDisplayImageUrls(
    designs.map((d) => d.id)
  );

  // Look up publish state for each primary image so the cards can
  // show Publish vs Published correctly. Best-effort: if this query
  // fails the cards just hide the publish badge — the design list
  // itself must still render.
  const primaryIds = designs
    .map((d) => d.primaryImageId)
    .filter((id): id is string => id !== null);
  let publishedAtById = new Map<string, Date | null>();
  if (primaryIds.length) {
    try {
      const primaryRows = await db
        .select({
          id: designImageTable.id,
          publishedAt: designImageTable.publishedAt,
        })
        .from(designImageTable)
        .where(inArray(designImageTable.id, primaryIds));
      publishedAtById = new Map(primaryRows.map((r) => [r.id, r.publishedAt]));
    } catch (err) {
      console.error("getUserDesigns: publish-state lookup failed", err);
    }
  }

  return designs.map((d) => ({
    ...d,
    imageUrl: imageUrls.get(d.id) ?? null,
    primaryImagePublishedAt: d.primaryImageId
      ? publishedAtById.get(d.primaryImageId) ?? null
      : null,
  }));
}

/**
 * Remove a design from the user's view. Hard-deletes when nothing else
 * references it; falls through to archive when orders are attached
 * (orders are financial records and never get cascaded). The UI button
 * stays "Delete" — the user's intent is "make this go away", and either
 * outcome satisfies that.
 *
 * Clears every child that foreign-keys design.id — chat_message and
 * design_image — before the design row itself. Both reference design.id
 * with no ON DELETE cascade, so skipping either makes the parent delete
 * fail the FK constraint (this is why deleting a chatted-in draft used to
 * error out).
 *
 * Uses db.batch (not db.transaction): libSQL's interactive transactions
 * aren't supported over the serverless HTTP connection, but batch runs all
 * the deletes atomically — so we never leave a design row behind with its
 * children already nuked, or vice versa.
 */
export async function deleteDesign(designId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const found = await db.query.design.findFirst({
    where: eq(designTable.id, designId),
  });

  if (!found) throw new Error("Design not found");
  if (found.userId !== session.user.id) throw new Error("Unauthorized");

  const [{ c: orderCount }] = await db
    .select({ c: count() })
    .from(orderTable)
    .where(eq(orderTable.designId, designId));

  if (orderCount > 0) {
    await db
      .update(designTable)
      .set({ status: "archived", updatedAt: new Date() })
      .where(eq(designTable.id, designId));
    return;
  }

  await db.batch([
    db.delete(chatMessageTable).where(eq(chatMessageTable.designId, designId)),
    db.delete(designImageTable).where(eq(designImageTable.designId, designId)),
    db.delete(designTable).where(eq(designTable.id, designId)),
  ]);
}

export async function archiveDesign(designId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const found = await db.query.design.findFirst({
    where: eq(designTable.id, designId),
  });

  if (!found) throw new Error("Design not found");
  if (found.userId !== session.user.id) throw new Error("Unauthorized");

  await db
    .update(designTable)
    .set({ status: "archived", updatedAt: new Date() })
    .where(eq(designTable.id, designId));
}

/**
 * Publish an image to the discover feed. Auto-generates title +
 * description via Claude on first publish (the owner can edit them
 * later via updatePublishedNaming). Sets published_at — the row
 * becomes immortal (deleteDesignImage refuses) and appears in the
 * discover feed. Subsequent calls are a no-op on already-published
 * images. No self-unpublish; admin moderation via is_hidden removes
 * from the feed.
 *
 * Authorizes via the design's userId — the image's owner is the
 * design's owner.
 */
export async function publishImage(
  imageId: string,
  opts: {
    title?: string;
    description?: string;
    backgroundColor?: string | null;
  } = {}
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const image = await db.query.designImage.findFirst({
    where: eq(designImageTable.id, imageId),
  });
  if (!image) throw new Error("Image not found");

  const owner = await db.query.design.findFirst({
    where: eq(designTable.id, image.designId),
    columns: { userId: true },
  });
  if (!owner || owner.userId !== session.user.id) {
    throw new Error("Unauthorized");
  }

  if (image.publishedAt) return;

  // The publish modal lets the owner supply name/description/backdrop up
  // front. Auto-generate via Claude only for the fields left blank, so the
  // legacy "just publish" path (no opts) still works.
  let title = opts.title?.trim();
  let description = opts.description?.trim();
  if (!title || !description) {
    const gen = await generatePublishedNaming(image.imageUrl, image.prompt);
    title = title || gen.title;
    description = description || gen.description;
  }

  await db
    .update(designImageTable)
    .set({
      publishedAt: new Date(),
      title,
      description,
      ...(opts.backgroundColor !== undefined
        ? { backgroundColor: opts.backgroundColor }
        : {}),
    })
    .where(eq(designImageTable.id, imageId));

  revalidatePath("/");
  revalidatePath("/prints");
}

/**
 * Owner edits the public listing on an already-published image.
 * Refuses if the image hasn't been published yet — listing only
 * exists for published images. published_at is never touched.
 */
export async function updatePublishedNaming(
  imageId: string,
  {
    title,
    description,
    backgroundColor,
  }: {
    title?: string;
    description?: string;
    backgroundColor?: string | null;
  }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const image = await db.query.designImage.findFirst({
    where: eq(designImageTable.id, imageId),
  });
  if (!image) throw new Error("Image not found");
  if (!image.publishedAt) throw new Error("Image is not published");

  const owner = await db.query.design.findFirst({
    where: eq(designTable.id, image.designId),
    columns: { userId: true },
  });
  if (!owner || owner.userId !== session.user.id) {
    throw new Error("Unauthorized");
  }

  // Partial update: only touch fields the caller actually sent. The
  // background control persists backgroundColor alone; the naming editor
  // sends title + description. backgroundColor can be explicit null (clear
  // to checkerboard), so the guard is `!== undefined`, not truthiness.
  await db
    .update(designImageTable)
    .set({
      ...(title !== undefined ? { title: title.trim() } : {}),
      ...(description !== undefined ? { description: description.trim() } : {}),
      ...(backgroundColor !== undefined ? { backgroundColor } : {}),
    })
    .where(eq(designImageTable.id, imageId));

  revalidatePath("/");
  revalidatePath("/prints");
  revalidatePath(`/d/${imageId}`);
}

/**
 * Owner takes a published image back down — the reverse of publishImage.
 * Clears published_at, so the image leaves the discover feed (`/`,
 * `/prints`), stops being buyable (canBuyPublishedImage), and
 * /d/[imageId] 404s (getPublishedImage returns null). title /
 * description / background_color are left intact so re-publishing is one
 * click and reuses them. A re-published image gets a fresh published_at
 * and sorts as newly published. No-op if already unpublished.
 *
 * Authorizes via the design's userId — the image's owner is the
 * design's owner.
 */
export async function unpublishImage(imageId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const image = await db.query.designImage.findFirst({
    where: eq(designImageTable.id, imageId),
  });
  if (!image) throw new Error("Image not found");

  const owner = await db.query.design.findFirst({
    where: eq(designTable.id, image.designId),
    columns: { userId: true },
  });
  if (!owner || owner.userId !== session.user.id) {
    throw new Error("Unauthorized");
  }

  if (!image.publishedAt) return;

  await db
    .update(designImageTable)
    .set({ publishedAt: null })
    .where(eq(designImageTable.id, imageId));

  revalidatePath("/");
  revalidatePath("/prints");
  revalidatePath(`/d/${imageId}`);
}
