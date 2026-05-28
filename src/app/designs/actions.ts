"use server";

import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  design as designTable,
  designImage as designImageTable,
  order as orderTable,
} from "@/lib/db/schema";
import { eq, desc, and, not, count, inArray } from "drizzle-orm";
import { resolveDesignDisplayImageUrls } from "@/lib/design-images";
import { generatePublishedNaming } from "@/lib/ai";

export async function getUserDesigns() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

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
 * Wrapped in a transaction so a failure on the parent delete doesn't
 * leave behind a design row with its design_image children already
 * nuked.
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

  await db.transaction(async (tx) => {
    await tx
      .delete(designImageTable)
      .where(eq(designImageTable.designId, designId));
    await tx.delete(designTable).where(eq(designTable.id, designId));
  });
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
export async function publishImage(imageId: string) {
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

  const { title, description } = await generatePublishedNaming(
    image.imageUrl,
    image.prompt
  );

  await db
    .update(designImageTable)
    .set({
      publishedAt: new Date(),
      title,
      description,
    })
    .where(eq(designImageTable.id, imageId));
}

/**
 * Owner edits the public listing on an already-published image.
 * Refuses if the image hasn't been published yet — listing only
 * exists for published images. published_at is never touched.
 */
export async function updatePublishedNaming(
  imageId: string,
  { title, description }: { title: string; description: string }
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

  await db
    .update(designImageTable)
    .set({ title: title.trim(), description: description.trim() })
    .where(eq(designImageTable.id, imageId));
}
