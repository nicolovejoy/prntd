/**
 * Model B write builders (docs/model-b-migration-plan.md).
 *
 * Introduced in slice 1 as the dual-write mirror; since the slice-4 writer
 * cutover these are the ONLY write shapes (`image`, `conversation_image`,
 * `listing`, `placement_render`) — `design_image` is no longer written. The
 * builders stay the single source of the column mapping: both insert sites
 * (the inline batch in generateDesign and insertDesignImage) and every
 * publish-family action route through here (risky spots §3, §5).
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
import { eq } from "drizzle-orm";
import type { db as appDb } from "@/lib/db";
import {
  image as imageTable,
  conversationImage as conversationImageTable,
  listing as listingTable,
  placementRender as placementRenderTable,
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
