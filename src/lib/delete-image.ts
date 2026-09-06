/**
 * DB-level core of "delete one image" — the plan/execute split behind the
 * `deleteDesignImage` server action (src/app/design/actions.ts), the
 * bulk `deleteImages` action on My Designs (src/app/designs/actions.ts).
 * Mirrors src/lib/delete-design.ts, one object down: the caller supplies the
 * session gate and decides what a non-deletable plan turns into, this layer
 * owns the rules.
 *
 * Rules (Model B slice 4, plan §7 — same vocabulary as delete-design.ts):
 *  - An order reference blocks: the image pinned in ANY order line's
 *    placements, or the legacy-fallback case (a pre-placements line whose
 *    design has this image as its primary). Orders are financial records.
 *  - A reference from another conversation (a seed carried into a fresh-start
 *    thread), a shop product's placements, or a cart line's placements
 *    downgrades the delete to a link-detach: the image row, its publication row and
 *    its mirror product survive.
 *  - Otherwise the image row, its publication row, its mirror `product` row, its
 *    placement_render row (id reuse) and its conversation links go.
 *
 * Two scopes, one plan:
 *  - design-scoped (`designId`): "remove this image from this thread". A
 *    detach removes THIS design's link only, and a `role='seed'` link is a
 *    detach by construction — the image belongs to another thread (possibly
 *    another user), so ownership is the caller's design check, not ours.
 *  - image-scoped (`userId`): "delete this image from my library". Ownership
 *    is image.owner_id, so a legacy row with no source design is still its
 *    owner's to delete; the scope design is the image's home thread. A
 *    detach here would be a silent no-op (the library lists by owner, not by
 *    conversation), so the bulk caller reports it as kept instead.
 */
import { and, desc, eq, ne, sql } from "drizzle-orm";
import type { db as appDb } from "@/lib/db";
import {
  design as designTable,
  orderItem as orderItemTable,
  cartItem as cartItemTable,
  product as productTable,
  image as imageTable,
  conversationImage as conversationImageTable,
  placementRender as placementRenderTable,
  imagePublication as imagePublicationTable,
} from "@/lib/db/schema";
import { imageReferences, imageReferencedByOrders } from "@/lib/design-publish";
import { findMirrorProduct } from "@/lib/model-b-writes";
import type { ImageDeletionOutcome } from "@/lib/delete-design";

type Db = typeof appDb;

/** delete-design.ts's per-image vocabulary plus the two image-scoped
 * refusals (the design-scoped callers validated the design instead). */
export type ImagePlanOutcome =
  | ImageDeletionOutcome
  | "not-owned"
  | "not-found";

export interface ImageDeletionPlan {
  imageId: string;
  outcome: ImagePlanOutcome;
  /** The conversation a detach unlinks from, and whose primary_image_id
   * moves. Null for a legacy row with no source design. */
  designId: string | null;
  /** False when `designId` names a row that is already gone — the primary
   * update is then skipped. */
  designExists: boolean;
  ownerId: string | null;
  imageUrl: string | null;
  r2Key: string | null;
  /** The image's own mirror `product` row (its Shop composition), deleted
   * with the image the way its publication row always was. */
  mirrorProductId: string | null;
  /** `designId` currently points primary_image_id at this image. */
  wasPrimary: boolean;
  /** The link being removed is a `role='seed'` link of `designId`. */
  seedLink: boolean;
}

/** Only a "delete" plan writes the image row away; every other outcome is
 * either a refusal or a link-detach the caller opts into. */
export function isImageDeletable(plan: ImageDeletionPlan): boolean {
  return plan.outcome === "delete";
}

/** Whether an order line references this image: pinned in any line's
 * placements, or the legacy fallback (a line with no placements whose design
 * displays this image as its primary). Image ids are UUIDs, so the JSON
 * substring prefilter can't false-positive, and the values are re-checked. */
async function orderReferencesImage(
  db: Db,
  imageId: string,
  designId: string | null,
  designPrimaryImageId: string | null
): Promise<boolean> {
  const [pinnedRows, ownLines] = await Promise.all([
    db
      .select({ placements: orderItemTable.placements })
      .from(orderItemTable)
      .where(sql`${orderItemTable.placements} LIKE ${"%" + imageId + "%"}`),
    designId
      ? db
          .select({ placements: orderItemTable.placements })
          .from(orderItemTable)
          .where(eq(orderItemTable.designId, designId))
      : Promise.resolve([] as { placements: Record<string, string> | null }[]),
  ]);

  for (const row of pinnedRows) {
    if (Object.values(row.placements ?? {}).includes(imageId)) return true;
  }
  return imageReferencedByOrders(imageId, designPrimaryImageId, ownLines);
}

/**
 * Read-only: decide what deleting `imageId` would do.
 *
 * Pass `designId` for the design-scoped path (the caller has already checked
 * that design's ownership) or `userId` for the image-scoped one (ownership is
 * checked here, against image.owner_id). Passing both scopes the detach to
 * `designId` and still checks ownership.
 */
export async function planImageDeletion(
  db: Db,
  imageId: string,
  opts: { designId?: string; userId?: string } = {}
): Promise<ImageDeletionPlan> {
  const [row] = await db
    .select({
      id: imageTable.id,
      ownerId: imageTable.ownerId,
      imageUrl: imageTable.imageUrl,
      r2Key: imageTable.r2Key,
      sourceDesignId: imageTable.sourceDesignId,
    })
    .from(imageTable)
    .where(eq(imageTable.id, imageId))
    .limit(1);

  const base: ImageDeletionPlan = {
    imageId,
    outcome: "delete",
    designId: opts.designId ?? row?.sourceDesignId ?? null,
    designExists: false,
    ownerId: row?.ownerId ?? null,
    imageUrl: row?.imageUrl ?? null,
    r2Key: row?.r2Key ?? null,
    mirrorProductId: null,
    wasPrimary: false,
    seedLink: false,
  };

  // No image row: nothing to report to a library caller. A design-scoped
  // caller still gets a "delete" plan — its execute is a set of no-op deletes
  // plus the placement_render delete, which is how a render id (no `image`
  // row, id reused) has always been removed.
  if (!row && !opts.designId) return { ...base, outcome: "not-found" };
  if (row && opts.userId && row.ownerId !== opts.userId) {
    return { ...base, outcome: "not-owned" };
  }

  const scopeId = base.designId;
  const scope = scopeId
    ? await db.query.design.findFirst({ where: eq(designTable.id, scopeId) })
    : undefined;
  const plan: ImageDeletionPlan = {
    ...base,
    designExists: scope !== undefined,
    wasPrimary: scope?.primaryImageId === imageId,
  };

  // Design-scoped reachability. The caller proved it owns `designId`, not the
  // image — so without this, an id that is no longer linked to ANY thread (its
  // owner detached it, or the conversation that seeded it was deleted) could
  // be deleted from any design at all, and any user's placement_render row
  // could be dropped by id. Ownership of a design only authorises the images
  // that design can actually see: a conversation link of either role, or a
  // render this design produced.
  if (opts.designId) {
    const [links, renders] = await Promise.all([
      db
        .select({ role: conversationImageTable.role })
        .from(conversationImageTable)
        .where(
          and(
            eq(conversationImageTable.designId, opts.designId),
            eq(conversationImageTable.imageId, imageId)
          )
        ),
      db
        .select({ id: placementRenderTable.id })
        .from(placementRenderTable)
        .where(
          and(
            eq(placementRenderTable.id, imageId),
            eq(placementRenderTable.designId, opts.designId)
          )
        )
        .limit(1),
    ]);
    if (links.length === 0 && renders.length === 0) {
      return { ...plan, outcome: "not-found" };
    }
    // A seed link means the image lives in another conversation: "deleting" it
    // from this one is a link-detach. Recorded now so a seed id can never
    // reach the global deletes below; applied after the order check, which
    // refuses either way.
    plan.seedLink = links.some((l) => l.role === "seed");
  }

  if (
    await orderReferencesImage(db, imageId, scopeId, scope?.primaryImageId ?? null)
  ) {
    return { ...plan, outcome: "blocked-by-order" };
  }

  if (plan.seedLink) return { ...plan, outcome: "detach-seed" };

  const mirrorProductId = await findMirrorProduct(db, imageId);
  const [linkedElsewhere, productPins, cartPins] = await Promise.all([
    db
      .select({ id: conversationImageTable.id })
      .from(conversationImageTable)
      .where(
        and(
          eq(conversationImageTable.imageId, imageId),
          // With no scope design (a legacy row) every link is another
          // conversation's.
          ...(scopeId ? [ne(conversationImageTable.designId, scopeId)] : [])
        )
      )
      .limit(1),
    // The image's own mirror product exists BECAUSE of the image, so it never
    // keeps it alive — it is excluded here and deleted alongside it.
    db
      .select({ id: productTable.id })
      .from(productTable)
      .where(
        and(
          sql`${productTable.placements} LIKE ${"%" + imageId + "%"}`,
          ...(mirrorProductId ? [ne(productTable.id, mirrorProductId)] : [])
        )
      )
      .limit(1),
    db
      .select({ id: cartItemTable.id })
      .from(cartItemTable)
      .where(sql`${cartItemTable.placements} LIKE ${"%" + imageId + "%"}`)
      .limit(1),
  ]);

  const flags = {
    order: false, // decided above
    otherConversation: linkedElsewhere.length > 0,
    product: productPins.length > 0,
    cart: cartPins.length > 0,
  };
  const decision = imageReferences(flags);
  let outcome: ImageDeletionOutcome;
  if (decision === "delete") outcome = "delete";
  else if (flags.otherConversation) outcome = "detach-seed";
  else if (flags.product) outcome = "detach-product-pin";
  else outcome = "detach-cart-pin";

  return { ...plan, outcome, mirrorProductId };
}

/**
 * Apply a plan. Refuses every outcome the rules didn't allow — blocked,
 * unowned, or unreachable/missing — so nothing an unauthorised caller asked
 * for reaches a write in either mode, and the caller decides what to say
 * about it.
 *
 * One db.batch (not db.transaction: libSQL's interactive transactions aren't
 * supported over the serverless HTTP connection) carries the deletes AND, when
 * the deleted image was the design's primary, the primary_image_id update —
 * so the row and the pointer at it can never disagree. R2 objects are NOT
 * touched here; the plan carries `r2Key`/`imageUrl` for a caller that cleans
 * up. The return value reports the new primary; the caller writes nothing.
 */
export async function executeImageDeletion(
  db: Db,
  plan: ImageDeletionPlan
): Promise<{ primaryImageId: string | null; primaryChanged: boolean }> {
  if (
    plan.outcome === "blocked-by-order" ||
    plan.outcome === "not-owned" ||
    plan.outcome === "not-found"
  ) {
    throw new Error(
      `Refusing to delete image ${plan.imageId}: ${plan.outcome}`
    );
  }

  const { imageId, designId, seedLink } = plan;
  const linkFilter = and(
    eq(conversationImageTable.imageId, imageId),
    ...(designId ? [eq(conversationImageTable.designId, designId)] : []),
    ...(seedLink ? [eq(conversationImageTable.role, "seed" as const)] : [])
  );

  // The primary moves only when the image that just went WAS the primary.
  // Recomputing it for any delete would silently re-point a thread whose
  // primary the owner picked (setPrimaryImage, #149), and — worse — it moves
  // an order's legacy fallback target: a pre-placements order line resolves
  // to design.primary_image_id, so shifting the primary off image A makes A
  // deletable on the very next id in the same bulk call. Blocked stays
  // blocked because the fallback keeps pointing at A.
  const movePrimary = Boolean(designId && plan.designExists && plan.wasPrimary);

  // Resolved BEFORE the batch so the update can ride inside it: a follow-up
  // UPDATE could fail after the rows were already gone, leaving
  // primary_image_id pointing at a deleted id (the column is FK-less, so
  // nothing would catch it) and the caller reporting a failure for an image
  // that is in fact deleted. Excludes the image being deleted, since it is
  // still linked at select time.
  let newPrimaryId: string | null = null;
  if (movePrimary && designId) {
    const [remaining] = await db
      .select({ id: imageTable.id })
      .from(conversationImageTable)
      .innerJoin(imageTable, eq(imageTable.id, conversationImageTable.imageId))
      .where(
        and(
          eq(conversationImageTable.designId, designId),
          eq(conversationImageTable.role, "output"),
          ne(imageTable.id, imageId)
        )
      )
      .orderBy(desc(imageTable.createdAt), sql`image.rowid desc`)
      .limit(1);
    newPrimaryId = remaining?.id ?? null;
  }

  await db.batch([
    db.delete(conversationImageTable).where(linkFilter),
    ...(plan.outcome === "delete"
      ? [
          db.delete(imageTable).where(eq(imageTable.id, imageId)),
          db.delete(imagePublicationTable).where(eq(imagePublicationTable.imageId, imageId)),
          db
            .delete(placementRenderTable)
            .where(eq(placementRenderTable.id, imageId)),
          ...(plan.mirrorProductId
            ? [
                db
                  .delete(productTable)
                  .where(eq(productTable.id, plan.mirrorProductId)),
              ]
            : []),
        ]
      : []),
    ...(movePrimary && designId
      ? [
          db
            .update(designTable)
            .set({ primaryImageId: newPrimaryId, updatedAt: new Date() })
            .where(eq(designTable.id, designId)),
        ]
      : []),
  ]);

  return { primaryImageId: newPrimaryId, primaryChanged: movePrimary };
}

/** The R2 object key for a planned image, best-effort: the stored key, else
 * derived from the public URL. Null when neither resolves (a legacy URL from
 * another bucket). */
export function r2KeyForImagePlan(
  plan: ImageDeletionPlan,
  keyFromUrl: (url: string) => string | null
): string | null {
  if (plan.r2Key) return plan.r2Key;
  return plan.imageUrl ? keyFromUrl(plan.imageUrl) : null;
}
