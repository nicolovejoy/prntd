/**
 * Model B dual-write builders (docs/model-b-migration-plan.md, slice 1).
 *
 * Slice 1 keeps `design_image` authoritative but mirrors every write into the
 * new tables (`image`, `conversation_image`, `listing`, `placement_render`) so
 * slice 2 can flip readers over with the data already present. These builders
 * are the single source of the column mapping — both design_image insert sites
 * (the inline batch in generateDesign and insertDesignImage) and every
 * publish-family action route through here, so the two shapes can't drift
 * (risky spots §3, §5).
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
}): ImageRow {
  return {
    id: params.id,
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
}): PlacementRenderRow {
  return {
    id: params.id,
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
 * Build the `listing` row for a freshly published image. Mirrors the full
 * publish state so the row is self-contained; feed-rank/hidden carry the
 * image's current values (publishImage no-ops if already published, so this is
 * always an insert of a new row).
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
 * existing listing. Undefined fields are left untouched; the caller passes the
 * same partial it applies to design_image so the two stay in lockstep. Update
 * only — never inserts — so editing an unpublished image (no listing row)
 * is a natural no-op.
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
 * spot §3): given the operation, return the one `listing` statement to splice
 * into the same `db.batch` as the `design_image` publish-column write, so the
 * two shapes stay in lockstep.
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
