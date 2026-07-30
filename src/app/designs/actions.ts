"use server";

import { headers } from "next/headers";
import { auth, isAnonymousUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  design as designTable,
  designImage as designImageTable,
  chatMessage as chatMessageTable,
  order as orderTable,
  orderItem as orderItemTable,
  cartItem as cartItemTable,
  product as productTable,
  image as imageTable,
  conversationImage as conversationImageTable,
  placementRender as placementRenderTable,
  listing as listingTable,
} from "@/lib/db/schema";
import { eq, desc, and, not, ne, count, inArray, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { resolveDesignDisplayImageUrls } from "@/lib/design-images";
import { listingSyncStatement, type ListingUpdate } from "@/lib/model-b-writes";
import { generatePublishedNaming } from "@/lib/ai";
import { DEFAULT_PUBLISH_BACKGROUND } from "@/lib/blanks";

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
      closedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const imageUrls = await resolveDesignDisplayImageUrls(
    designs.map((d) => d.id)
  );

  // Look up publish state (+ chosen storefront backdrop) for each primary
  // image so the cards can show Publish vs Published correctly and render
  // published designs over their backdrop color. Best-effort: if this query
  // fails the cards just hide the publish badge — the design list
  // itself must still render.
  const primaryIds = designs
    .map((d) => d.primaryImageId)
    .filter((id): id is string => id !== null);
  let primaryById = new Map<
    string,
    { publishedAt: Date | null; backgroundColor: string | null }
  >();
  if (primaryIds.length) {
    try {
      // Publish state lives in `listing` now — a row exists iff published, so
      // an unpublished primary is simply absent from the map.
      const primaryRows = await db
        .select({
          id: listingTable.imageId,
          publishedAt: listingTable.publishedAt,
          backgroundColor: listingTable.backgroundColor,
        })
        .from(listingTable)
        .where(inArray(listingTable.imageId, primaryIds));
      primaryById = new Map(
        primaryRows.map((r) => [
          r.id,
          { publishedAt: r.publishedAt, backgroundColor: r.backgroundColor },
        ])
      );
    } catch (err) {
      console.error("getUserDesigns: publish-state lookup failed", err);
    }
  }

  return designs.map((d) => {
    const primary = d.primaryImageId
      ? primaryById.get(d.primaryImageId)
      : undefined;
    return {
      ...d,
      imageUrl: imageUrls.get(d.id) ?? null,
      primaryImagePublishedAt: primary?.publishedAt ?? null,
      primaryImageBackgroundColor: primary?.backgroundColor ?? null,
    };
  });
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
export async function deleteDesign(
  designId: string
): Promise<{ error?: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const found = await db.query.design.findFirst({
    where: eq(designTable.id, designId),
  });

  if (!found) throw new Error("Design not found");
  if (found.userId !== session.user.id) throw new Error("Unauthorized");

  const imageIds = (
    await db
      .select({ id: designImageTable.id })
      .from(designImageTable)
      .where(eq(designImageTable.designId, designId))
  ).map((r) => r.id);

  // Orders are financial records and never cascade. Since Phase 1c the lines
  // are authoritative, so an order can reference this design three ways: the
  // header design_id, an order_item line (a cart order's non-head designs
  // appear ONLY there), or an image id pinned inside a line's placements (a
  // back design picked from another thread, #72/#95). The old header-only
  // count missed the last two and the hard delete below died on the
  // order_item FK — the masked prod error in #121.
  if (await designReferencedByOrders(designId, imageIds)) {
    await db
      .update(designTable)
      .set({ status: "archived", updatedAt: new Date() })
      .where(eq(designTable.id, designId));
    return {};
  }

  // product.design_id FKs this design; deleting would break the organizer's
  // sellable. Surface it instead of dying on the constraint (server-action
  // throws are masked in prod).
  const [{ c: productCount }] = await db
    .select({ c: count() })
    .from(productTable)
    .where(eq(productTable.designId, designId));
  if (productCount > 0) {
    return {
      error: "This design is used by a shop product. Delete the product first.",
    };
  }

  // Also clear the Model B mirrors keyed to this design (slice 1). Images and
  // their output links / listings key on the design's image ids; placement
  // renders and conversation links key on design_id directly. An image that
  // another conversation links (a seed carried from a fork/backfill) survives
  // with its listing — the link belongs to the other design, and deleting the
  // artifact would blank that thread (slice-4 ref-count semantics, early).
  const sharedRows = imageIds.length
    ? await db
        .select({ imageId: conversationImageTable.imageId })
        .from(conversationImageTable)
        .where(
          and(
            inArray(conversationImageTable.imageId, imageIds),
            ne(conversationImageTable.designId, designId)
          )
        )
    : [];
  const shared = new Set(sharedRows.map((r) => r.imageId));
  const removableImageIds = imageIds.filter((id) => !shared.has(id));

  await db.batch([
    db.delete(chatMessageTable).where(eq(chatMessageTable.designId, designId)),
    db
      .delete(conversationImageTable)
      .where(eq(conversationImageTable.designId, designId)),
    db
      .delete(placementRenderTable)
      .where(eq(placementRenderTable.designId, designId)),
    // Cart lines FK design_id too; a deleted design can't be fulfilled, so
    // drop them (any user's cart — the line is dead either way).
    db.delete(cartItemTable).where(eq(cartItemTable.designId, designId)),
    ...(removableImageIds.length
      ? [
          db.delete(imageTable).where(inArray(imageTable.id, removableImageIds)),
          db
            .delete(listingTable)
            .where(inArray(listingTable.imageId, removableImageIds)),
        ]
      : []),
    db.delete(designImageTable).where(eq(designImageTable.designId, designId)),
    db.delete(designTable).where(eq(designTable.id, designId)),
  ]);
  return {};
}

/** Any order reference: header design_id, an order_item line, or one of the
 * design's image ids pinned in a line's placements JSON (image ids are UUIDs,
 * so a substring match can't false-positive). */
async function designReferencedByOrders(
  designId: string,
  imageIds: string[]
): Promise<boolean> {
  const [{ c: headerCount }] = await db
    .select({ c: count() })
    .from(orderTable)
    .where(eq(orderTable.designId, designId));
  if (headerCount > 0) return true;

  const [{ c: lineCount }] = await db
    .select({ c: count() })
    .from(orderItemTable)
    .where(eq(orderItemTable.designId, designId));
  if (lineCount > 0) return true;

  if (imageIds.length === 0) return false;
  const pinned = await db
    .select({ id: orderItemTable.id })
    .from(orderItemTable)
    .where(
      or(
        ...imageIds.map(
          (id) => sql`${orderItemTable.placements} LIKE ${"%" + id + "%"}`
        )
      )
    )
    .limit(1);
  return pinned.length > 0;
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
 * Publish an image to the discover feed. Auto-generates the title via
 * Claude on first publish when the owner left it blank (editable later
 * via updatePublishedNaming). Descriptions are never auto-generated
 * (2026-07-29 review); only an explicit caller-supplied one is stored.
 * Sets published_at — the row
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

  // The publish-family actions still read design_image: an unpublished image
  // has no listing row, so its is_hidden / feed_rank (which the new listing
  // must snapshot) live nowhere else until the slice-4 writer cutover.
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

  // The publish modal lets the owner supply name/backdrop up front.
  // Auto-generate via Claude only when the name was left blank, so the
  // legacy "just publish" path (no opts) still works.
  let title = opts.title?.trim();
  if (!title) {
    const gen = await generatePublishedNaming(image.imageUrl, image.prompt);
    title = gen.title;
  }
  // No auto-generated descriptions: store one only when the caller sent it
  // explicitly; otherwise leave whatever the row already carries (a
  // re-publish keeps the pre-unpublish value).
  const description = opts.description?.trim();

  const publishedAt = new Date();
  const backgroundColor = opts.backgroundColor ?? DEFAULT_PUBLISH_BACKGROUND;
  // Publish never leaves the backdrop transparent (#73): no pick — or an
  // explicit null from a legacy caller — persists as White.
  await db.batch([
    db
      .update(designImageTable)
      .set({
        publishedAt,
        title,
        backgroundColor,
        ...(description !== undefined ? { description } : {}),
      })
      .where(eq(designImageTable.id, imageId)),
    // Model B dual-write (slice 1): the listing carries the image's current
    // hidden/feed-rank so it's a faithful snapshot of the publish state.
    listingSyncStatement(db, imageId, {
      kind: "publish",
      publishedAt,
      isHidden: image.isHidden,
      title: title ?? null,
      // Mirror what design_image ends up holding so the listing snapshot
      // stays in lockstep.
      description: description ?? image.description ?? null,
      backgroundColor,
      feedRank: image.feedRank,
    }),
  ]);

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
  // sends title + description. The picker no longer offers a transparent
  // option (#73); a legacy null still displays as White via
  // publishedBackdrop, so the guard stays `!== undefined`, not truthiness.
  const set: ListingUpdate = {};
  if (title !== undefined) set.title = title.trim();
  if (description !== undefined) set.description = description.trim();
  if (backgroundColor !== undefined) set.backgroundColor = backgroundColor;

  // Model B dual-write (slice 1): the same partial keeps the listing in
  // lockstep. The listing update no-ops when the image predates its listing row.
  await db.batch([
    db.update(designImageTable).set(set).where(eq(designImageTable.id, imageId)),
    listingSyncStatement(db, imageId, { kind: "update", set }),
  ]);

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

  // Model B dual-write (slice 1): unpublish = delete the listing row, matching
  // the reversible semantics (title/backdrop stay on design_image for re-publish).
  await db.batch([
    db
      .update(designImageTable)
      .set({ publishedAt: null })
      .where(eq(designImageTable.id, imageId)),
    listingSyncStatement(db, imageId, { kind: "unpublish" }),
  ]);

  revalidatePath("/");
  revalidatePath("/prints");
  revalidatePath(`/d/${imageId}`);
}
