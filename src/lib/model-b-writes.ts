/**
 * Model B write builders (docs/model-b-migration-plan.md).
 *
 * These are the ONLY write shapes (`image`, `conversation_image`, `listing`,
 * `placement_render`) — `design_image` was dropped in slice 5. The builders
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
 * A published listing points at an image row nothing mutates, so publishing is
 * a snapshot by construction. `model-b-writes.test.ts` locks this in.
 */
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import type { db as appDb } from "@/lib/db";
import type { DesignSpec } from "@/lib/design-spec";
import type { ImageOperation } from "@/lib/image-provenance";
import {
  image as imageTable,
  conversationImage as conversationImageTable,
  listing as listingTable,
  placementRender as placementRenderTable,
  product as productTable,
} from "@/lib/db/schema";

type ImageRow = typeof imageTable.$inferInsert;
type ConversationImageRow = typeof conversationImageTable.$inferInsert;
type ListingRow = typeof listingTable.$inferInsert;
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
 * Build the `listing` row for a freshly published image. The row is the full
 * publish state (publishImage no-ops if already published, so this is always
 * an insert of a new row; a re-publish after unpublish starts fresh).
 */
export function buildListingRow(params: {
  imageId: string;
  publishedAt: Date;
  isHidden: boolean;
  title: string | null;
  description: string | null;
  backgroundColor: string | null;
  feedRank: number | null;
}): ListingRow {
  return {
    imageId: params.imageId,
    publishedAt: params.publishedAt,
    isHidden: params.isHidden,
    title: params.title,
    description: params.description,
    backgroundColor: params.backgroundColor,
    feedRank: params.feedRank,
  };
}

/**
 * Fields a publish-family edit (naming / hidden / feed-rank) applies to an
 * existing listing. Undefined fields are left untouched. Update only — never
 * inserts — so editing an unpublished image (no listing row) is a natural
 * no-op.
 */
export type ListingUpdate = Partial<{
  title: string | null;
  description: string | null;
  backgroundColor: string | null;
  isHidden: boolean;
  feedRank: number | null;
}>;

export type ListingSyncOp =
  | {
      kind: "publish";
      publishedAt: Date;
      isHidden: boolean;
      title: string | null;
      description: string | null;
      backgroundColor: string | null;
      feedRank: number | null;
    }
  | { kind: "unpublish" }
  | { kind: "update"; set: ListingUpdate };

/**
 * The single choke point every publish-family action routes through (risky
 * spot §3): given the operation, return the one `listing` statement — since
 * the slice-4 cutover, publish state lives nowhere else.
 *
 *  - publish  → insert the listing (publishImage no-ops if already published).
 *  - unpublish→ delete it.
 *  - update   → partial update; no-op when the image has no listing (editing an
 *               unpublished image), so it never conjures a phantom listing.
 */
export function listingSyncStatement(
  db: typeof appDb,
  imageId: string,
  op: ListingSyncOp
) {
  if (op.kind === "publish") {
    return db.insert(listingTable).values(
      buildListingRow({
        imageId,
        publishedAt: op.publishedAt,
        isHidden: op.isHidden,
        title: op.title,
        description: op.description,
        backgroundColor: op.backgroundColor,
        feedRank: op.feedRank,
      })
    );
  }
  if (op.kind === "unpublish") {
    return db.delete(listingTable).where(eq(listingTable.imageId, imageId));
  }
  return db
    .update(listingTable)
    .set(op.set)
    .where(eq(listingTable.imageId, imageId));
}

// --- composition slice 1: the published image's mirror `product` row ---
// (docs/composition-first-class-plan.md §5.) Every publish-family action
// batches a product statement next to its listing statement, so a published
// image always has a composition row: storeId NULL (the PRNTD Shop),
// designId NULL, blankId NULL (buyer picks the garment), placements exactly
// { front: imageId }. Inert to all readers until the slice-2 read swap.

/** The exact placements object a mirror product row carries. */
export function mirrorPlacements(imageId: string): Record<string, string> {
  return { front: imageId };
}

/**
 * Predicate identifying the mirror product for an image. Exact-JSON match on
 * placements is sound because mirror rows are only ever written through this
 * module (insert-time serialization is JSON.stringify of mirrorPlacements and
 * placements are never updated afterwards). `designId IS NULL` distinguishes
 * mirrors from loose organizer products (which always carry a designId).
 * Uniqueness is enforced by lookup-before-insert in the publish path only —
 * a DB-level guarantee is deferred (noted in the slice-1 PR).
 */
function mirrorProductWhere(imageId: string) {
  return and(
    isNull(productTable.storeId),
    isNull(productTable.designId),
    sql`${productTable.placements} = ${JSON.stringify(mirrorPlacements(imageId))}`
  );
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
    storeId: null,
    designId: null,
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
       * (fresh listedAt, feedRank cleared — matching the listing's
       * fresh-row-on-republish semantics).
       */
      existingMirrorId: string | null;
    }
  | { kind: "unpublish" }
  | { kind: "update"; set: MirrorUpdate };

/**
 * The mirror-product counterpart of listingSyncStatement: one statement to
 * batch alongside the listing statement.
 *
 *  - publish  → insert the mirror, or revive the existing draft row.
 *  - unpublish→ status "draft" (row kept; re-publish revives it).
 *  - update   → partial update, guarded to non-draft rows so it no-ops
 *               exactly when the listing update does (an unpublished image
 *               has no listing; its mirror — if any — is a draft).
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
