"use server";

import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  design as designTable,
  designImage as designImageTable,
  user as userTable,
} from "@/lib/db/schema";
import { eq, and, isNotNull, desc } from "drizzle-orm";
import { copyDesignImageByUrl } from "@/lib/r2";
import { canFork } from "@/lib/design-publish";

export type PublishedImage = {
  imageId: string;
  imageUrl: string;
  title: string | null;
  description: string | null;
  designerName: string;
  publishedAt: Date;
  /**
   * Set when this image's design was forked from another image AND
   * that source image is still published + visible. Null otherwise
   * (original work, or source has been admin-hidden).
   */
  forkedFrom: {
    imageId: string;
    title: string | null;
    designerName: string;
  } | null;
};

/**
 * Public discover feed. Returns published, non-hidden images, newest first.
 * No auth required.
 */
export async function getDiscoverFeed(limit = 60): Promise<PublishedImage[]> {
  const rows = await db
    .select({
      imageId: designImageTable.id,
      imageUrl: designImageTable.imageUrl,
      title: designImageTable.title,
      description: designImageTable.description,
      publishedAt: designImageTable.publishedAt,
      designerName: userTable.name,
    })
    .from(designImageTable)
    .innerJoin(designTable, eq(designTable.id, designImageTable.designId))
    .innerJoin(userTable, eq(userTable.id, designTable.userId))
    .where(
      and(
        isNotNull(designImageTable.publishedAt),
        eq(designImageTable.isHidden, false)
      )
    )
    .orderBy(desc(designImageTable.publishedAt))
    .limit(limit);

  return rows.map((r) => ({
    imageId: r.imageId,
    imageUrl: r.imageUrl,
    title: r.title,
    description: r.description,
    designerName: r.designerName,
    publishedAt: r.publishedAt!,
    forkedFrom: null,
  }));
}

/**
 * Public single-image page. Returns null on unpublished or hidden
 * images (the route 404s).
 */
export async function getPublishedImage(
  imageId: string
): Promise<PublishedImage | null> {
  const rows = await db
    .select({
      imageId: designImageTable.id,
      imageUrl: designImageTable.imageUrl,
      title: designImageTable.title,
      description: designImageTable.description,
      publishedAt: designImageTable.publishedAt,
      isHidden: designImageTable.isHidden,
      designerName: userTable.name,
      forkedFromImageId: designTable.forkedFromImageId,
    })
    .from(designImageTable)
    .innerJoin(designTable, eq(designTable.id, designImageTable.designId))
    .innerJoin(userTable, eq(userTable.id, designTable.userId))
    .where(eq(designImageTable.id, imageId))
    .limit(1);

  const r = rows[0];
  if (!r || !r.publishedAt || r.isHidden) return null;

  let forkedFrom: PublishedImage["forkedFrom"] = null;
  if (r.forkedFromImageId) {
    const parent = await db
      .select({
        imageId: designImageTable.id,
        title: designImageTable.title,
        publishedAt: designImageTable.publishedAt,
        isHidden: designImageTable.isHidden,
        designerName: userTable.name,
      })
      .from(designImageTable)
      .innerJoin(designTable, eq(designTable.id, designImageTable.designId))
      .innerJoin(userTable, eq(userTable.id, designTable.userId))
      .where(eq(designImageTable.id, r.forkedFromImageId))
      .limit(1);
    const p = parent[0];
    if (p && p.publishedAt && !p.isHidden) {
      forkedFrom = {
        imageId: p.imageId,
        title: p.title,
        designerName: p.designerName,
      };
    }
  }

  return {
    imageId: r.imageId,
    imageUrl: r.imageUrl,
    title: r.title,
    description: r.description,
    designerName: r.designerName,
    publishedAt: r.publishedAt,
    forkedFrom,
  };
}

/**
 * Fork an image into a new private design owned by the caller. Copies
 * the seed image into a fresh R2 key under the new design so each
 * design owns its R2 keys independently. The original image (locked
 * via publishedAt) is left untouched.
 *
 * Source must be either owned by the caller (self-fork — useful for
 * starting a new thread from one of your own past designs) or
 * published and not hidden.
 *
 * Returns the new designId. Caller redirects to /design?id=...
 */
export async function forkImage(imageId: string): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const sourceImage = await db.query.designImage.findFirst({
    where: eq(designImageTable.id, imageId),
  });
  if (!sourceImage) throw new Error("Image not found");

  const sourceDesign = await db.query.design.findFirst({
    where: eq(designTable.id, sourceImage.designId),
  });
  if (!sourceDesign) throw new Error("Source design missing");

  if (
    !canFork({
      sourceImage,
      sourceDesign,
      callerId: session.user.id,
    })
  ) {
    throw new Error("Image is not available to fork");
  }

  // Walk one level: if the source design is itself a fork, inherit its
  // root; otherwise the source design's owner IS the root.
  const originalDesignerId =
    sourceDesign.originalDesignerId ?? sourceDesign.userId;

  const newDesignId = crypto.randomUUID();
  await db.insert(designTable).values({
    id: newDesignId,
    userId: session.user.id,
    forkedFromImageId: imageId,
    originalDesignerId,
  });

  // Copy R2 object into the new design's namespace as generation #1.
  const newImageUrl = await copyDesignImageByUrl(
    sourceImage.imageUrl,
    newDesignId,
    1
  );

  const newImageId = crypto.randomUUID();
  await db.insert(designImageTable).values({
    id: newImageId,
    designId: newDesignId,
    parentImageId: null,
    aspectRatio: sourceImage.aspectRatio,
    imageUrl: newImageUrl,
    prompt: sourceImage.prompt,
    generationCost: 0,
    isApproved: false,
  });

  await db
    .update(designTable)
    .set({
      primaryImageId: newImageId,
      generationCount: 1,
      updatedAt: new Date(),
    })
    .where(eq(designTable.id, newDesignId));

  return newDesignId;
}
