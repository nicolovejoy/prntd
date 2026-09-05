"use server";

import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  design as designTable,
  image as imageTable,
  listing as listingTable,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { planDesignDeletion, executeDesignDeletion } from "@/lib/delete-design";
import {
  listingSyncStatement,
  productMirrorStatement,
  findMirrorProduct,
  requireMirrorProduct,
  type MirrorUpdate,
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
 * The rules — which tables FK design.id, when an image detaches instead of
 * deleting, what blocks — live in src/lib/delete-design.ts, shared with the
 * delete-designs-since ops script. This wrapper adds the session + ownership
 * check and decides what a blocked plan turns into.
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

  const plan = await planDesignDeletion(db, designId);

  // Orders are financial records and never cascade. Since Phase 1c the lines
  // are authoritative, so an order can reference this design three ways: the
  // header design_id, an order_item line (a cart order's non-head designs
  // appear ONLY there), or an image id pinned inside a line's placements (a
  // back design picked from another thread, #72/#95). The old header-only
  // count missed the last two and the hard delete died on the order_item FK
  // — the masked prod error in #121.
  if (plan.orderReferenced) {
    await db
      .update(designTable)
      .set({ status: "archived", updatedAt: new Date() })
      .where(eq(designTable.id, designId));
    return {};
  }

  // product.design_id FKs this design; deleting would break the organizer's
  // sellable. Surface it instead of dying on the constraint (server-action
  // throws are masked in prod).
  if (plan.productCount > 0) {
    return {
      error: "This design is used by a shop product. Delete the product first.",
    };
  }

  await executeDesignDeletion(db, plan);
  return {};
}


/**
 * Publish an image to the discover feed: insert its `listing` visibility row
 * and list its mirror `product` row (the Shop composition, which since the
 * slice-4 cutover holds every sellable field).
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

  // Model B: whether the image is published lives in `listing`. The image row
  // carries ownership (denormalized ownerId), so no design join is needed.
  const [image] = await db
    .select({
      id: imageTable.id,
      ownerId: imageTable.ownerId,
      imageUrl: imageTable.imageUrl,
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
  // explicitly. A re-publish is a fresh listing — prior title/backdrop/
  // hidden/feed-rank don't carry over, they're overwritten on the revived
  // mirror product row.
  const description = opts.description?.trim();

  const publishedAt = new Date();
  const backgroundColor = opts.backgroundColor ?? DEFAULT_PUBLISH_BACKGROUND;
  // Composition slice 4 (writer cutover): the sellable state (title,
  // description, backdrop, feed rank, listed-at) is written ONLY to the
  // image's mirror product row — the Shop composition; the listing row beside
  // it carries publishedAt/isHidden and nothing else. Lookup-before-insert
  // keeps a re-publish from minting a second mirror, and the listing's
  // primary key rolls the whole batch back if a concurrent publish races it.
  const existingMirrorId = await findMirrorProduct(db, imageId);
  // Publish never leaves the backdrop transparent (#73): no pick — or an
  // explicit null from a legacy caller — persists as White.
  await db.batch([
    listingSyncStatement(db, imageId, {
      kind: "publish",
      publishedAt,
      isHidden: false,
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
 * Owner edits the public naming/backdrop of an already-published image.
 * Refuses if the image hasn't been published yet — the mirror product is a
 * draft then, and its update statement would no-op anyway. published_at (the
 * listing row) is never touched.
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
  // Composition slice 4: naming/backdrop are product state, so this writes
  // the mirror product row only — the listing row holds no sellable fields
  // any more. `backdropColor` is the product-side name for backgroundColor.
  const set: MirrorUpdate = {};
  if (title !== undefined) set.title = title.trim();
  if (description !== undefined) set.description = description.trim();
  if (backgroundColor !== undefined) set.backdropColor = backgroundColor;

  // The mirror update is a WHERE-guarded UPDATE: with no mirror row it
  // matches nothing and the edit would vanish with a success return. A
  // published image always has one, so assert it — same refusal as the Shop
  // sale (requireMirrorProduct).
  await requireMirrorProduct(db, imageId);
  await productMirrorStatement(db, imageId, { kind: "update", set });

  revalidatePath("/");
  revalidatePath("/prints");
  revalidatePath(`/d/${imageId}`);
}

/**
 * Owner takes a published image back down — the reverse of publishImage.
 * Deletes the listing row and drafts the mirror product, so the image leaves
 * the discover feed (`/`, `/prints`), stops being buyable
 * (canBuyPublishedImage), and /d/[imageId] 404s for everyone but the owner,
 * who still reaches it as their own private image (#136 slice 1).
 * Re-publishing is a fresh listing: new listed_at (sorts as newly published),
 * title re-proposed if not supplied, backdrop defaulted, feed rank cleared.
 * No-op if already unpublished.
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

  // Unpublish = mirror product → draft + delete the visibility row.
  // Re-publish revives the same mirror with a fresh listedAt, a re-proposed
  // title, a defaulted backdrop and no feed rank (the fresh-listing
  // semantics, now carried by the product row).
  await db.batch([
    listingSyncStatement(db, imageId, { kind: "unpublish" }),
    productMirrorStatement(db, imageId, { kind: "unpublish" }),
  ]);

  revalidatePath("/");
  revalidatePath("/prints");
  revalidatePath(`/d/${imageId}`);
}
