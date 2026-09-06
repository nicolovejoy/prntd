"use server";

import { headers } from "next/headers";
import { auth, isAnonymousUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  design as designTable,
  image as imageTable,
  imagePublication as imagePublicationTable,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { planDesignDeletion, executeDesignDeletion } from "@/lib/delete-design";
import {
  planImageDeletion,
  executeImageDeletion,
  r2KeyForImagePlan,
} from "@/lib/delete-image";
import { deleteObjectByKey, imageKeyFromUrl } from "@/lib/r2";
import type { ImageDeleteSkipReason } from "@/lib/library-view";
import {
  publicationSyncStatement,
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

  await executeDesignDeletion(db, plan);
  return {};
}


export interface BulkImageDeleteResult {
  deleted: string[];
  skipped: { imageId: string; reason: ImageDeleteSkipReason }[];
}

/**
 * Bulk delete from My Designs' select mode (#195). The library is a flat grid
 * of every image the user owns, so the rules are image-level and live in
 * src/lib/delete-image.ts — this wrapper adds the session gate, maps each
 * plan's outcome to something the grid can say, and cleans up R2.
 *
 *  - an id that is gone, or was never the caller's, is reported
 *    `not-found` / `not-owned` and never touched;
 *  - an image an order line pins — its own thread's line, or another order's
 *    placements (a back design picked from My Designs/Shop) — is kept and
 *    reported `order`. Orders are financial records; what was printed must
 *    stay resolvable;
 *  - an image something else still points at (a seed link in another
 *    conversation, a shop product, a cart line) is kept whole and reported
 *    `in-use`. A detach here would delete the link and leave the tile — the
 *    library lists by owner, not by conversation — so nothing is written at
 *    all. The user removes the other reference first, then deletes;
 *  - the rest are deleted one batch per image, never one batch across them:
 *    a failure mid-way leaves the earlier ones deleted and reports the failed
 *    one as `failed` — the row is still there, so the grid says so rather
 *    than claiming the image is gone.
 *
 * R2 objects are removed after each DB batch, best-effort: a failed object
 * delete is logged and never fails the action, because the row is already
 * gone and no sweep can find the object again — an orphaned object costs
 * storage, a thrown action costs the user a tile that is in fact deleted.
 */
export async function deleteImages(
  imageIds: string[]
): Promise<BulkImageDeleteResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || isAnonymousUser(session.user)) {
    throw new Error("Unauthorized");
  }
  const ids = [...new Set(imageIds)];
  const result: BulkImageDeleteResult = { deleted: [], skipped: [] };
  if (ids.length === 0) return result;

  let publishedRemoved = false;

  for (const imageId of ids) {
    const plan = await planImageDeletion(db, imageId, {
      userId: session.user.id,
    });
    if (plan.outcome !== "delete") {
      const reason: ImageDeleteSkipReason =
        plan.outcome === "blocked-by-order"
          ? "order"
          : plan.outcome === "not-owned"
            ? "not-owned"
            : plan.outcome === "not-found"
              ? "not-found"
              : "in-use";
      result.skipped.push({ imageId, reason });
      continue;
    }

    try {
      // One batch, including the primary_image_id move — nothing to follow up,
      // so a partial write can't leave the thread pointing at a deleted image.
      await executeImageDeletion(db, plan);
    } catch (err) {
      console.error(
        `[designs] deleteImages: ${imageId} failed: ${err instanceof Error ? err.message : String(err)}`
      );
      result.skipped.push({ imageId, reason: "failed" });
      continue;
    }
    result.deleted.push(imageId);
    if (plan.mirrorProductId) publishedRemoved = true;

    const key = r2KeyForImagePlan(plan, imageKeyFromUrl);
    if (key) {
      try {
        await deleteObjectByKey(key);
      } catch (err) {
        console.error(
          `[designs] deleteImages: R2 delete failed for ${imageId}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  revalidatePath("/designs");
  if (publishedRemoved) {
    revalidatePath("/");
    revalidatePath("/prints");
  }
  return result;
}


/**
 * Publish an image to the discover feed: insert its `image_publication`
 * visibility row and list its `product` row (the Shop composition, which
 * since the slice-4 cutover holds every sellable field).
 * Auto-generates the title via Claude when the owner left it blank
 * (editable later via updatePublishedNaming). Descriptions are never
 * auto-generated (2026-07-29 review); only an explicit caller-supplied
 * one is stored. Subsequent calls are a no-op on already-published
 * images. Reversible via unpublishImage; admin moderation via the
 * publication row's is_hidden removes from the feed.
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

  // Model B: whether the image is published lives in `image_publication`. The
  // image row carries ownership (denormalized ownerId), so no design join is
  // needed.
  const [image] = await db
    .select({
      id: imageTable.id,
      ownerId: imageTable.ownerId,
      imageUrl: imageTable.imageUrl,
      publishedAt: imagePublicationTable.publishedAt,
    })
    .from(imageTable)
    .leftJoin(imagePublicationTable, eq(imagePublicationTable.imageId, imageTable.id))
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
  // image's mirror product row — the Shop composition; the publication row
  // beside it carries publishedAt/isHidden and nothing else. Lookup-before-
  // insert keeps a re-publish from reviving nothing and hitting the unique
  // front-image index; the publication row's primary key (and that index)
  // roll the whole batch back if a concurrent publish races it.
  const existingMirrorId = await findMirrorProduct(db, imageId);
  // Publish never leaves the backdrop transparent (#73): no pick — or an
  // explicit null from a legacy caller — persists as White.
  await db.batch([
    publicationSyncStatement(db, imageId, {
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
 * publication row) is never touched.
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
      publishedAt: imagePublicationTable.publishedAt,
    })
    .from(imageTable)
    .leftJoin(imagePublicationTable, eq(imagePublicationTable.imageId, imageTable.id))
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
  // the mirror product row only — the publication row holds no sellable
  // fields. `backdropColor` is the product-side name for backgroundColor.
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
 * Deletes the publication row and drafts the mirror product, so the image leaves
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
      publishedAt: imagePublicationTable.publishedAt,
    })
    .from(imageTable)
    .leftJoin(imagePublicationTable, eq(imagePublicationTable.imageId, imageTable.id))
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
    publicationSyncStatement(db, imageId, { kind: "unpublish" }),
    productMirrorStatement(db, imageId, { kind: "unpublish" }),
  ]);

  revalidatePath("/");
  revalidatePath("/prints");
  revalidatePath(`/d/${imageId}`);
}
