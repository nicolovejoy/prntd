/**
 * DB-level core of "delete a conversation" — the plan/execute split behind the
 * `deleteDesign` server action (src/app/designs/actions.ts) and the
 * `delete-designs-since` ops script. The action adds the session + ownership
 * check and decides what to do with a blocked plan (archive / error); the
 * script reports the plan per conversation and skips blocked ones. Both apply
 * exactly these rules, so there is one place to extend when a new table starts
 * FK-ing design.id (#124's class).
 *
 * Rules (Model B slice 4, plan §7):
 *  - Any order reference — header design_id, an order_item line, or one of the
 *    design's image ids pinned inside a line's placements — blocks the whole
 *    delete. Orders are financial records and never cascade.
 *  - A `product` row whose design_id FKs the design blocks too (an organizer
 *    sellable; delete the product first).
 *  - Per image: a conversation link from ANOTHER design (a seed carried into a
 *    fresh-start thread), a shop product's placements, or another design's
 *    cart line's placements downgrade the delete to a link-detach — the image
 *    row survives, only this design's link goes. Otherwise the image row, its
 *    listing and its mirror product are deleted.
 *  - Everything else that FKs design.id (chat_message, conversation_image,
 *    placement_render, cart_item, image_generation) goes with the design row,
 *    in one db.batch.
 */
import { and, count, eq, inArray, ne, or, sql } from "drizzle-orm";
import type { db as appDb } from "@/lib/db";
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
import { imageReferences } from "@/lib/design-publish";

type Db = typeof appDb;

export type ImageDeletionOutcome =
  | "delete"
  | "detach-seed"
  | "detach-product-pin"
  | "detach-cart-pin"
  | "blocked-by-order";

export interface PlannedImage {
  imageId: string;
  /** Null for a placement-render id (no `image` row) — nothing to report. */
  imageUrl: string | null;
  r2Key: string | null;
  outcome: ImageDeletionOutcome;
}

export interface DesignDeletionPlan {
  designId: string;
  /** Header, line, or pinned-image order reference — the delete is blocked. */
  orderReferenced: boolean;
  /** `product` rows FK-ing design_id (organizer sellables) — also blocked. */
  productCount: number;
  /** Every image id the design minted (output links + placement renders). */
  imageIds: string[];
  /** Per-image decision for the `image` rows among `imageIds`. */
  images: PlannedImage[];
  /** Placement renders the design owns; deleted with it (derived, never shared). */
  placementRenders: { id: string; imageUrl: string }[];
  removableImageIds: string[];
  removableMirrorIds: string[];
}

export function isDeletionBlocked(plan: DesignDeletionPlan): boolean {
  return plan.orderReferenced || plan.productCount > 0;
}

/** Any order reference: header design_id, an order_item line, or one of the
 * design's image ids pinned in a line's placements JSON (image ids are UUIDs,
 * so a substring match can't false-positive). Returns the pinned image ids so
 * callers can say which image is the blocker. */
async function orderReferences(
  db: Db,
  designId: string,
  imageIds: string[]
): Promise<{ header: boolean; line: boolean; pinned: Set<string> }> {
  const [[{ c: headerCount }], [{ c: lineCount }]] = await Promise.all([
    db
      .select({ c: count() })
      .from(orderTable)
      .where(eq(orderTable.designId, designId)),
    db
      .select({ c: count() })
      .from(orderItemTable)
      .where(eq(orderItemTable.designId, designId)),
  ]);

  const pinned = new Set<string>();
  if (imageIds.length > 0) {
    const rows = await db
      .select({ placements: orderItemTable.placements })
      .from(orderItemTable)
      .where(
        or(
          ...imageIds.map(
            (id) => sql`${orderItemTable.placements} LIKE ${"%" + id + "%"}`
          )
        )
      );
    const idSet = new Set(imageIds);
    for (const row of rows) {
      for (const id of Object.values(row.placements ?? {})) {
        if (idSet.has(id)) pinned.add(id);
      }
    }
  }

  return { header: headerCount > 0, line: lineCount > 0, pinned };
}

/**
 * Read-only: decide what deleting `designId` would do. Does not check
 * ownership — the caller does (the action against the session, the script
 * against the `--user` email).
 */
export async function planDesignDeletion(
  db: Db,
  designId: string
): Promise<DesignDeletionPlan> {
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
      .select({
        id: placementRenderTable.id,
        imageUrl: placementRenderTable.imageUrl,
      })
      .from(placementRenderTable)
      .where(eq(placementRenderTable.designId, designId)),
  ]);
  const imageIds = [
    ...new Set([...outputRows, ...renderRows].map((r) => r.id)),
  ];

  const [orders, [{ c: productCount }]] = await Promise.all([
    orderReferences(db, designId, imageIds),
    db
      .select({ c: count() })
      .from(productTable)
      .where(eq(productTable.designId, designId)),
  ]);

  // Ref-count: an image referenced elsewhere survives the thread delete.
  // Image ids are UUIDs, so the JSON substring matches can't false-positive.
  const linkedElsewhere = new Set<string>();
  const productPinned = new Set<string>();
  const cartPinned = new Set<string>();
  // Mirror product rows (composition slice 1): a published image's own Shop
  // composition (storeId+designId NULL, placements exactly {front: imageId}).
  // A mirror must not keep its image alive — it exists BECAUSE of the image —
  // so mirrors are excluded from the pin probe and deleted alongside the
  // image row + listing, the same lifecycle the listing row already had.
  const mirrorIdByImage = new Map<string, string>();
  let imageRows: {
    id: string;
    imageUrl: string;
    r2Key: string | null;
  }[] = [];
  if (imageIds.length > 0) {
    const [sharedRows, productPins, cartPins, rows] = await Promise.all([
      db
        .select({ imageId: conversationImageTable.imageId })
        .from(conversationImageTable)
        .where(
          and(
            inArray(conversationImageTable.imageId, imageIds),
            ne(conversationImageTable.designId, designId)
          )
        ),
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
            // This design's own cart lines are deleted with it; only lines for
            // OTHER designs pin an image worth keeping alive.
            ne(cartItemTable.designId, designId),
            or(
              ...imageIds.map(
                (id) => sql`${cartItemTable.placements} LIKE ${"%" + id + "%"}`
              )
            )
          )
        ),
      db
        .select({
          id: imageTable.id,
          imageUrl: imageTable.imageUrl,
          r2Key: imageTable.r2Key,
        })
        .from(imageTable)
        .where(inArray(imageTable.id, imageIds)),
    ]);
    imageRows = rows;
    for (const r of sharedRows) linkedElsewhere.add(r.imageId);
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

  const imageRowById = new Map(imageRows.map((r) => [r.id, r]));
  const images: PlannedImage[] = [];
  const removableImageIds: string[] = [];
  for (const id of imageIds) {
    const flags = {
      order: orders.pinned.has(id),
      otherConversation: linkedElsewhere.has(id),
      product: productPinned.has(id),
      cart: cartPinned.has(id),
    };
    const decision = imageReferences(flags);
    let outcome: ImageDeletionOutcome;
    if (decision === "blocked") outcome = "blocked-by-order";
    else if (decision === "delete") outcome = "delete";
    else if (flags.otherConversation) outcome = "detach-seed";
    else if (flags.product) outcome = "detach-product-pin";
    else outcome = "detach-cart-pin";
    if (decision === "delete") removableImageIds.push(id);

    const row = imageRowById.get(id);
    // Placement-render ids have no image row; they're reported via
    // `placementRenders`, not here.
    if (!row) continue;
    images.push({
      imageId: id,
      imageUrl: row.imageUrl,
      r2Key: row.r2Key,
      outcome,
    });
  }
  const removableMirrorIds = removableImageIds
    .map((id) => mirrorIdByImage.get(id))
    .filter((id): id is string => id !== undefined);

  return {
    designId,
    orderReferenced: orders.header || orders.line || orders.pinned.size > 0,
    productCount,
    imageIds,
    images,
    placementRenders: renderRows,
    removableImageIds,
    removableMirrorIds,
  };
}

/**
 * Apply a plan. Refuses a blocked plan — the caller decides between archive
 * (the action) and skip (the script), never this layer.
 *
 * Uses db.batch (not db.transaction): libSQL's interactive transactions
 * aren't supported over the serverless HTTP connection, but batch runs all
 * the deletes atomically — so we never leave a design row behind with its
 * children already nuked, or vice versa. R2 objects are NOT touched here;
 * the plan's `images`/`placementRenders` carry what a caller may clean up.
 */
export async function executeDesignDeletion(
  db: Db,
  plan: DesignDeletionPlan
): Promise<void> {
  if (isDeletionBlocked(plan)) {
    throw new Error(
      `Refusing to delete design ${plan.designId}: referenced by an order or a shop product`
    );
  }
  const { designId, removableImageIds, removableMirrorIds } = plan;

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
}
