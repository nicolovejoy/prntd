/**
 * Model B write builders (docs/model-b-migration-plan.md).
 *
 * These are the ONLY write shapes (`image`, `conversation_image`,
 * `image_publication`, `placement_render`) — `design_image` was dropped in
 * Model B slice 5. The builders
 * stay the single source of the column mapping: both insert sites (the inline
 * batch in generateDesign and insertDesignImage) and every publish-family
 * action route through here (risky spots §3, §5).
 *
 * Each builder returns a plain row/values object; the caller splices the
 * corresponding `db.insert(...).values(row)` / `db.update(...)` into its
 * existing `db.batch`. Keeping the batching at the call site (rather than
 * returning query builders) avoids leaking drizzle's batch-item types through
 * this module and keeps each site's atomicity explicit.
 *
 * Immutability guardrail (§3): this module builds image INSERT rows only. It
 * deliberately exposes NO helper that updates image.imageUrl / r2Key / prompt.
 * A published composition points at an image row nothing mutates, so
 * publishing is a snapshot by construction. `model-b-writes.test.ts` locks this in.
 */
import { and, eq, ne } from "drizzle-orm";
import type { db as appDb } from "@/lib/db";
import type { DesignSpec } from "@/lib/design-spec";
import type { ImageOperation } from "@/lib/image-provenance";
import {
  image as imageTable,
  conversationImage as conversationImageTable,
  imagePublication as imagePublicationTable,
  placementRender as placementRenderTable,
  product as productTable,
} from "@/lib/db/schema";

type ImageRow = typeof imageTable.$inferInsert;
type ConversationImageRow = typeof conversationImageTable.$inferInsert;
type PublicationRow = typeof imagePublicationTable.$inferInsert;
type PlacementRenderRow = typeof placementRenderTable.$inferInsert;

/**
 * Best-effort R2 key for an image URL: the object key is the URL path minus
 * the leading slash (works for both the r2.dev host and a custom domain).
 * Returns null when the URL can't be parsed — imageUrl stays authoritative.
 */
export function r2KeyFromUrl(url: string): string | null {
  try {
    return new URL(url).pathname.replace(/^\//, "") || null;
  } catch {
    return null;
  }
}

/**
 * Build the `image` row for a source generation (an artifact — never a
 * placement render). `id` is reused from the design_image row so orders/
 * products that pin the id keep resolving after slice 2.
 */
export function buildImageRow(params: {
  id: string;
  ownerId: string;
  designId: string;
  imageUrl: string;
  aspectRatio: string;
  prompt?: string | null;
  /** What produced the row, so a reader can tell a scene summary from an edit
   * instruction (#169). Omitted only by tests/backfills → null (legacy). */
  operation?: ImageOperation | null;
  /** The structured brief a generate rendered — null for edits and uploads. */
  designSpec?: DesignSpec | null;
  generator?: string | null;
  generationCost: number;
  parentImageId?: string | null;
  seedImageId?: string | null;
  originalDesignerId?: string | null;
  /** Backfill only: carries the design_image timestamp across, so the
   * chronological reads (thread gallery order, latest-source fallback) keep
   * working on rows that predate the table. Live writes omit it → now. */
  createdAt?: Date;
}): ImageRow {
  return {
    id: params.id,
    ...(params.createdAt ? { createdAt: params.createdAt } : {}),
    ownerId: params.ownerId,
    r2Key: r2KeyFromUrl(params.imageUrl),
    imageUrl: params.imageUrl,
    aspectRatio: params.aspectRatio,
    prompt: params.prompt ?? null,
    operation: params.operation ?? null,
    designSpecJson: params.designSpec ?? null,
    generator: params.generator ?? null,
    generationCost: params.generationCost,
    parentImageId: params.parentImageId ?? null,
    seedImageId: params.seedImageId ?? null,
    originalDesignerId: params.originalDesignerId ?? null,
    sourceDesignId: params.designId,
  };
}

/** Build the `conversation_image` link row for a generation's output image. */
export function buildOutputLinkRow(
  designId: string,
  imageId: string
): ConversationImageRow {
  return {
    id: crypto.randomUUID(),
    designId,
    imageId,
    role: "output",
  };
}

/**
 * Build the `placement_render` row for a placement-targeted render. `id` is
 * reused from the design_image row. `placementId` coalesces to "default" —
 * legacy front renders stored a null placement, but the cache table requires
 * one and "default" is the established front fallback (getDesignPlacementRenders).
 */
export function buildPlacementRenderRow(params: {
  id: string;
  designId: string;
  sourceImageId?: string | null;
  blankId: string;
  placementId?: string | null;
  imageUrl: string;
  aspectRatio: string;
  generationCost: number;
  /** Backfill only — see buildImageRow. findPlacementRender takes the most
   * recent match, so the original timestamp has to survive. */
  createdAt?: Date;
}): PlacementRenderRow {
  return {
    id: params.id,
    ...(params.createdAt ? { createdAt: params.createdAt } : {}),
    designId: params.designId,
    sourceImageId: params.sourceImageId ?? null,
    blankId: params.blankId,
    placementId: params.placementId ?? "default",
    imageUrl: params.imageUrl,
    aspectRatio: params.aspectRatio,
    generationCost: params.generationCost,
  };
}

/**
 * Build the `image_publication` row for a freshly published image — the
 * image-visibility grant, `publishedAt` + `isHidden` and nothing else. The
 * sellable fields (title / description / backdrop / feed rank) live on the
 * image's `product` composition and are written there alone (composition
 * slice 4 cut the writers over; slice 5 dropped the frozen copies).
 */
export function buildPublicationRow(params: {
  imageId: string;
  publishedAt: Date;
  isHidden: boolean;
}): PublicationRow {
  return {
    imageId: params.imageId,
    publishedAt: params.publishedAt,
    isHidden: params.isHidden,
  };
}

/**
 * Fields a publish-family edit applies to an existing visibility row. Since
 * the slice-4 cutover that is `isHidden` alone — naming, backdrop and feed
 * rank are product state. Update only — never inserts — so editing an
 * unpublished image (no publication row) is a natural no-op.
 */
export type PublicationUpdate = Partial<{
  isHidden: boolean;
}>;

export type PublicationSyncOp =
  | {
      kind: "publish";
      publishedAt: Date;
      isHidden: boolean;
    }
  | { kind: "unpublish" }
  | { kind: "update"; set: PublicationUpdate };

/**
 * The single choke point every publish-family action routes through (risky
 * spot §3): given the operation, return the one `image_publication` statement.
 *
 *  - publish  → insert the visibility row (publishImage no-ops if already
 *               published). `imageId` is the primary key, so a racing second
 *               publish fails here and rolls its whole `db.batch` back —
 *               which is what keeps a second mirror product from being minted
 *               (the mirror statement is always batched with this one).
 *  - unpublish→ delete it.
 *  - update   → partial update; no-op when the image has no publication row
 *               (editing an unpublished image), so it never conjures one.
 */
export function publicationSyncStatement(
  db: typeof appDb,
  imageId: string,
  op: PublicationSyncOp
) {
  if (op.kind === "publish") {
    return db.insert(imagePublicationTable).values(
      buildPublicationRow({
        imageId,
        publishedAt: op.publishedAt,
        isHidden: op.isHidden,
      })
    );
  }
  if (op.kind === "unpublish") {
    return db.delete(imagePublicationTable).where(eq(imagePublicationTable.imageId, imageId));
  }
  return db
    .update(imagePublicationTable)
    .set(op.set)
    .where(eq(imagePublicationTable.imageId, imageId));
}

// --- the published image's `product` row: the Shop composition ---
// (docs/composition-first-class-plan.md §5.) Every publish-family action
// batches a product statement next to its publication statement, so a
// published image always has a composition row: blankId NULL (buyer picks the
// garment), price NULL (computed per pick), placements exactly
// { front: imageId }. "Mirror" in the names below is the slice-1 word for
// this row, from when it mirrored a listing; since slice 5 it is the only
// population `product` has.
//
// Slice 2 swapped every sellable reader onto this row; slice 4 (the writer
// cutover) made it the only place the sellable fields are written. The
// `image_publication` row beside it is the visibility grant and nothing else.

/** The exact placements object a mirror product row carries. */
export function mirrorPlacements(imageId: string): Record<string, string> {
  return { front: imageId };
}

/**
 * Predicate identifying the composition for an image: the row whose front
 * placement slot is that image. `front_image_id` is the generated column over
 * `placements.front`, and `product_front_image_unique` on it makes "one
 * composition per front image" a DB guarantee (composition slice 5) — the
 * publish path still looks up first (findMirrorProduct) so a re-publish
 * revives the draft row instead of failing on the index, and a
 * double-publish race now dies on this index as well as on the
 * `image_publication` primary key it is batched with.
 */
function mirrorProductWhere(imageId: string) {
  return eq(productTable.frontImageId, imageId);
}

/**
 * Find the image's mirror product row, if one exists (live or draft —
 * unpublish keeps the row as a draft). Returns its id, or null.
 */
export async function findMirrorProduct(
  db: typeof appDb,
  imageId: string
): Promise<string | null> {
  const [row] = await db
    .select({ id: productTable.id })
    .from(productTable)
    .where(mirrorProductWhere(imageId))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Error message for "this published image has no composition". Every
 * published image has a mirror (publish writes one; the slice-1 backfill
 * converted the pre-existing listings), so this is a broken invariant, not a
 * state a caller should paper over: the Shop sale and the naming edit both
 * refuse rather than book an order with no composition / silently discard the
 * owner's edit.
 */
export const MISSING_COMPOSITION_ERROR =
  "Published image has no composition";

/**
 * findMirrorProduct for callers that cannot proceed without one. Throws
 * MISSING_COMPOSITION_ERROR instead of returning null.
 */
export async function requireMirrorProduct(
  db: typeof appDb,
  imageId: string
): Promise<string> {
  const id = await findMirrorProduct(db, imageId);
  if (!id) throw new Error(MISSING_COMPOSITION_ERROR);
  return id;
}

/** Build the mirror `product` row for a publish (or the backfill). */
export function buildMirrorProductRow(params: {
  imageId: string;
  ownerId: string;
  listedAt: Date;
  title: string | null;
  description: string | null;
  backdropColor: string | null;
  feedRank?: number | null;
  status?: "listed" | "hidden";
}): typeof productTable.$inferInsert {
  return {
    ownerId: params.ownerId,
    blankId: null,
    placements: mirrorPlacements(params.imageId),
    price: null,
    status: params.status ?? "listed",
    position: 0,
    title: params.title,
    description: params.description,
    backdropColor: params.backdropColor,
    feedRank: params.feedRank ?? null,
    listedAt: params.listedAt,
  };
}

/**
 * Fields a publish-family edit mirrors onto the product row. `isHidden` maps
 * to the status enum (true → "hidden", false → "listed"); the other fields
 * copy over directly.
 */
export type MirrorUpdate = Partial<{
  title: string | null;
  description: string | null;
  backdropColor: string | null;
  feedRank: number | null;
  isHidden: boolean;
}>;

export type ProductMirrorOp =
  | {
      kind: "publish";
      /** Image owner — the mirror's seller. */
      ownerId: string;
      publishedAt: Date;
      title: string | null;
      description: string | null;
      backdropColor: string | null;
      /**
       * Result of findMirrorProduct, resolved by the caller before batching:
       * null → insert a fresh mirror; an id → revive that draft row
       * (fresh listedAt, feedRank cleared — the fresh-row-on-republish
       * semantics the visibility row has always had).
       */
      existingMirrorId: string | null;
    }
  | { kind: "unpublish" }
  | { kind: "update"; set: MirrorUpdate };

/**
 * The mirror-product counterpart of publicationSyncStatement: one statement to
 * batch alongside the publication statement.
 *
 *  - publish  → insert the mirror, or revive the existing draft row.
 *  - unpublish→ status "draft" (row kept; re-publish revives it).
 *  - update   → partial update, guarded to non-draft rows so it no-ops
 *               exactly when the publication update does (an unpublished
 *               image has no publication row; its mirror — if any — is a
 *               draft).
 */
export function productMirrorStatement(
  db: typeof appDb,
  imageId: string,
  op: ProductMirrorOp
) {
  if (op.kind === "publish") {
    if (op.existingMirrorId) {
      return db
        .update(productTable)
        .set({
          status: "listed",
          title: op.title,
          description: op.description,
          backdropColor: op.backdropColor,
          feedRank: null,
          listedAt: op.publishedAt,
          updatedAt: new Date(),
        })
        .where(eq(productTable.id, op.existingMirrorId));
    }
    return db.insert(productTable).values(
      buildMirrorProductRow({
        imageId,
        ownerId: op.ownerId,
        listedAt: op.publishedAt,
        title: op.title,
        description: op.description,
        backdropColor: op.backdropColor,
      })
    );
  }
  if (op.kind === "unpublish") {
    return db
      .update(productTable)
      .set({ status: "draft", updatedAt: new Date() })
      .where(mirrorProductWhere(imageId));
  }
  const set: Partial<typeof productTable.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (op.set.title !== undefined) set.title = op.set.title;
  if (op.set.description !== undefined) set.description = op.set.description;
  if (op.set.backdropColor !== undefined) set.backdropColor = op.set.backdropColor;
  if (op.set.feedRank !== undefined) set.feedRank = op.set.feedRank;
  if (op.set.isHidden !== undefined)
    set.status = op.set.isHidden ? "hidden" : "listed";
  return db
    .update(productTable)
    .set(set)
    .where(and(mirrorProductWhere(imageId), ne(productTable.status, "draft")));
}
