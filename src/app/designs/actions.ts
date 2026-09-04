"use server";

import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  design as designTable,
  chatMessage as chatMessageTable,
  order as orderTable,
  orderItem as orderItemTable,
  cartItem as cartItemTable,
  product as productTable,
  image as imageTable,
  conversationImage as conversationImageTable,
  placementRender as placementRenderTable,
  listing as listingTable,
  imageGeneration as imageGenerationTable,
} from "@/lib/db/schema";
import { eq, and, ne, count, inArray, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { imageReferences } from "@/lib/design-publish";
import {
  listingSyncStatement,
  productMirrorStatement,
  findMirrorProduct,
  type ListingUpdate,
} from "@/lib/model-b-writes";
import { generatePublishedNaming } from "@/lib/ai";
import { getImageNamingContext } from "@/lib/design-images";
import { DEFAULT_PUBLISH_BACKGROUND } from "@/lib/blanks";

/**
 * Remove a design from the user's view. Hard-deletes when nothing else
 * references it; falls through to archive when orders are attached
 * (orders are financial records and never get cascaded). The UI button
 * stays "Delete" — the user's intent is "make this go away", and either
 * outcome satisfies that.
 *
 * Clears every child that foreign-keys design.id — chat_message,
 * conversation_image, placement_render, cart_item, image_generation — before the design row
 * itself. All reference design.id with no ON DELETE cascade, so skipping any
 * of them makes the parent delete fail the FK constraint (this is why
 * deleting a chatted-in draft used to error out).
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

  // Every id this design minted: output-linked artifacts + placement renders
  // (both can be pinned in order placements). Seeds are excluded: a seed
  // link points at another design's image, never one of ours to delete.
  const [outputRows, renderRows] = await Promise.all([
    db
      .select({ id: conversationImageTable.imageId })
      .from(conversationImageTable)
      .where(
        and(
          eq(conversationImageTable.designId, designId),
          eq(conversationImageTable.role, "output")
        )
      ),
    db
      .select({ id: placementRenderTable.id })
      .from(placementRenderTable)
      .where(eq(placementRenderTable.designId, designId)),
  ]);
  const imageIds = [
    ...new Set([...outputRows, ...renderRows].map((r) => r.id)),
  ];

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

  // Ref-count (slice 4, plan §7): an image referenced elsewhere survives the
  // thread delete — a conversation link from another design (seed carried
  // into a fresh-start thread), a shop product's placements, or a cart line's
  // placements. Order references were handled above (whole design archives).
  // Image ids are UUIDs, so the JSON substring matches can't false-positive.
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
  const linkedElsewhere = new Set(sharedRows.map((r) => r.imageId));
  const productPinned = new Set<string>();
  const cartPinned = new Set<string>();
  // Mirror product rows (composition slice 1): a published image's own Shop
  // composition (storeId+designId NULL, placements exactly {front: imageId}).
  // A mirror must not keep its image alive — it exists BECAUSE of the image —
  // so mirrors are excluded from the pin probe and deleted alongside the
  // image row + listing below, the same lifecycle the listing row already had.
  const mirrorIdByImage = new Map<string, string>();
  if (imageIds.length) {
    const [productPins, cartPins] = await Promise.all([
      db
        .select({
          id: productTable.id,
          storeId: productTable.storeId,
          designId: productTable.designId,
          placements: productTable.placements,
        })
        .from(productTable)
        .where(
          or(
            ...imageIds.map(
              (id) => sql`${productTable.placements} LIKE ${"%" + id + "%"}`
            )
          )
        ),
      db
        .select({ placements: cartItemTable.placements })
        .from(cartItemTable)
        .where(
          and(
            // This design's own cart lines are deleted below; only lines for
            // OTHER designs pin an image worth keeping alive.
            ne(cartItemTable.designId, designId),
            or(
              ...imageIds.map(
                (id) => sql`${cartItemTable.placements} LIKE ${"%" + id + "%"}`
              )
            )
          )
        ),
    ]);
    const imageIdSet = new Set(imageIds);
    for (const row of productPins) {
      const placements = row.placements ?? {};
      const entries = Object.entries(placements);
      const isOwnMirror =
        row.storeId === null &&
        row.designId === null &&
        entries.length === 1 &&
        entries[0][0] === "front" &&
        imageIdSet.has(entries[0][1]);
      if (isOwnMirror) {
        mirrorIdByImage.set(entries[0][1], row.id);
        continue;
      }
      for (const id of Object.values(placements)) productPinned.add(id);
    }
    for (const row of cartPins) {
      for (const id of Object.values(row.placements ?? {})) cartPinned.add(id);
    }
  }
  const removableImageIds = imageIds.filter(
    (id) =>
      imageReferences({
        order: false, // handled above — any order ref archived the design
        otherConversation: linkedElsewhere.has(id),
        product: productPinned.has(id),
        cart: cartPinned.has(id),
      }) === "delete"
  );
  const removableMirrorIds = removableImageIds
    .map((id) => mirrorIdByImage.get(id))
    .filter((id): id is string => id !== undefined);

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
    // Generation job rows FK design_id as well (#124's class again: a table
    // added later that the delete batch doesn't know about takes the whole
    // delete down on the constraint). A RUNNING job goes too, and what happens
    // to its in-flight continuation is: the completion batch's image /
    // conversation_image / chat_message inserts are unconditional and die on
    // the FK, the continuation catches that and cleans up the R2 object, then
    // failGenerationJob finds no row — so the quota unit is silently lost.
    // Acceptable: the user deleted the thread the render was for.
    db
      .delete(imageGenerationTable)
      .where(eq(imageGenerationTable.designId, designId)),
    ...(removableImageIds.length
      ? [
          db.delete(imageTable).where(inArray(imageTable.id, removableImageIds)),
          db
            .delete(listingTable)
            .where(inArray(listingTable.imageId, removableImageIds)),
        ]
      : []),
    // Mirror products of deleted images go with them (a detached image —
    // referenced elsewhere — keeps its listing AND its mirror).
    ...(removableMirrorIds.length
      ? [
          db
            .delete(productTable)
            .where(inArray(productTable.id, removableMirrorIds)),
        ]
      : []),
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
 * Publish an image to the discover feed: insert its `listing` row.
 * Auto-generates the title via Claude when the owner left it blank
 * (editable later via updatePublishedNaming). Descriptions are never
 * auto-generated (2026-07-29 review); only an explicit caller-supplied
 * one is stored. Subsequent calls are a no-op on already-published
 * images. Reversible via unpublishImage; admin moderation via the
 * listing's is_hidden removes from the feed.
 *
 * Authorizes via image.ownerId (the design owner, denormalized).
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

  // Slice-4 writer cutover: publish state lives ONLY in `listing`. The image
  // row carries ownership (denormalized ownerId), so no design join needed.
  const [image] = await db
    .select({
      id: imageTable.id,
      ownerId: imageTable.ownerId,
      imageUrl: imageTable.imageUrl,
      prompt: imageTable.prompt,
      publishedAt: listingTable.publishedAt,
    })
    .from(imageTable)
    .leftJoin(listingTable, eq(listingTable.imageId, imageTable.id))
    .where(eq(imageTable.id, imageId))
    .limit(1);
  if (!image) throw new Error("Image not found");
  if (image.ownerId !== session.user.id) throw new Error("Unauthorized");

  if (image.publishedAt) return;

  // The publish modal lets the owner supply name/backdrop up front.
  // Auto-generate via Claude only when the name was left blank, so the
  // legacy "just publish" path (no opts) still works.
  let title = opts.title?.trim();
  if (!title) {
    // #169: an edit's `prompt` is an instruction ("make the bear larger"),
    // not a description of the picture — resolve the full provenance text.
    const namingContext = await getImageNamingContext(imageId);
    const gen = await generatePublishedNaming(image.imageUrl, namingContext);
    title = gen.title;
  }
  // No auto-generated descriptions: store one only when the caller sent it
  // explicitly. Since unpublish deletes the listing row, a re-publish is a
  // fresh listing — prior title/backdrop/hidden/feed-rank don't carry over
  // (cutover judgment call; nothing persists them once design_image is gone).
  const description = opts.description?.trim();

  const publishedAt = new Date();
  const backgroundColor = opts.backgroundColor ?? DEFAULT_PUBLISH_BACKGROUND;
  // Composition slice 1 dual-write: publish also creates (or revives) the
  // image's mirror product row — the Shop composition. Lookup-before-insert
  // keeps a re-publish from minting a second mirror.
  const existingMirrorId = await findMirrorProduct(db, imageId);
  // Publish never leaves the backdrop transparent (#73): no pick — or an
  // explicit null from a legacy caller — persists as White.
  await db.batch([
    listingSyncStatement(db, imageId, {
      kind: "publish",
      publishedAt,
      isHidden: false,
      title: title ?? null,
      description: description ?? null,
      backgroundColor,
      feedRank: null,
    }),
    productMirrorStatement(db, imageId, {
      kind: "publish",
      ownerId: image.ownerId,
      publishedAt,
      title: title ?? null,
      description: description ?? null,
      backdropColor: backgroundColor,
      existingMirrorId,
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

  const [image] = await db
    .select({
      id: imageTable.id,
      ownerId: imageTable.ownerId,
      publishedAt: listingTable.publishedAt,
    })
    .from(imageTable)
    .leftJoin(listingTable, eq(listingTable.imageId, imageTable.id))
    .where(eq(imageTable.id, imageId))
    .limit(1);
  if (!image) throw new Error("Image not found");
  if (image.ownerId !== session.user.id) throw new Error("Unauthorized");
  if (!image.publishedAt) throw new Error("Image is not published");

  // Partial update: only touch fields the caller actually sent. The
  // background control persists backgroundColor alone; the naming editor
  // sends title + description. The picker no longer offers a transparent
  // option (#73); a legacy null still displays as White via
  // publishedBackdrop, so the guard stays `!== undefined`, not truthiness.
  const set: ListingUpdate = {};
  if (title !== undefined) set.title = title.trim();
  if (description !== undefined) set.description = description.trim();
  if (backgroundColor !== undefined) set.backgroundColor = backgroundColor;

  // Composition slice 1 dual-write: mirror the edit onto the product row
  // (backdropColor is the product-side name for backgroundColor).
  await db.batch([
    listingSyncStatement(db, imageId, { kind: "update", set }),
    productMirrorStatement(db, imageId, {
      kind: "update",
      set: {
        ...(set.title !== undefined ? { title: set.title } : {}),
        ...(set.description !== undefined
          ? { description: set.description }
          : {}),
        ...(set.backgroundColor !== undefined
          ? { backdropColor: set.backgroundColor }
          : {}),
      },
    }),
  ]);

  revalidatePath("/");
  revalidatePath("/prints");
  revalidatePath(`/d/${imageId}`);
}

/**
 * Owner takes a published image back down — the reverse of publishImage.
 * Deletes the listing row, so the image leaves the discover feed (`/`,
 * `/prints`), stops being buyable (canBuyPublishedImage), and
 * /d/[imageId] 404s for everyone but the owner, who still reaches it as
 * their own private image (#136 slice 1). Re-publishing
 * creates a fresh listing: new published_at (sorts as newly published),
 * title re-proposed if not supplied, backdrop defaulted. No-op if
 * already unpublished.
 */
export async function unpublishImage(imageId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const [image] = await db
    .select({
      id: imageTable.id,
      ownerId: imageTable.ownerId,
      publishedAt: listingTable.publishedAt,
    })
    .from(imageTable)
    .leftJoin(listingTable, eq(listingTable.imageId, imageTable.id))
    .where(eq(imageTable.id, imageId))
    .limit(1);
  if (!image) throw new Error("Image not found");
  if (image.ownerId !== session.user.id) throw new Error("Unauthorized");

  if (!image.publishedAt) return;

  // Unpublish = delete the listing row. Re-publish creates a fresh listing
  // (title re-proposed, backdrop defaulted) — see publishImage. The mirror
  // product flips to draft (row kept — a later re-publish revives it with a
  // fresh listedAt, matching the listing's fresh-row semantics).
  await db.batch([
    listingSyncStatement(db, imageId, { kind: "unpublish" }),
    productMirrorStatement(db, imageId, { kind: "unpublish" }),
  ]);

  revalidatePath("/");
  revalidatePath("/prints");
  revalidatePath(`/d/${imageId}`);
}
