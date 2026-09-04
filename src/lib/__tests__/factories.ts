/**
 * Shared seed helpers for real-DB integration tests (createTestDb). Kept
 * minimal — only what's duplicated verbatim across test files. Don't force
 * every integration test onto these; add a factory only when a second file
 * needs the exact same shape.
 */
import type { db as appDb } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { buildMirrorProductRow } from "@/lib/model-b-writes";
import { and, eq, isNull } from "drizzle-orm";

type Db = typeof appDb;

/** Insert a user row with a deterministic email/name derived from `id`. */
export async function makeUser(db: Db, id: string) {
  await db.insert(schema.user).values({ id, email: `${id}@example.com`, name: id });
}

/** Insert a bare design owned by `userId` and return the row. */
export async function makeDesign(db: Db, userId: string) {
  const [d] = await db.insert(schema.design).values({ userId }).returning();
  return d;
}

/**
 * Seed a source image the Model B way: `image` + `conversation_image
 * (role=output)`, plus a `listing` when published — the shape every write
 * path has produced since the slice-4 cutover (`design_image` is gone as of
 * slice 5).
 *
 * `ownerId` must be the design's owner — image.ownerId is the denormalized
 * copy the guards read.
 */
export async function makeSourceImage(
  db: Db,
  params: {
    designId: string;
    ownerId: string;
    imageUrl: string;
    aspectRatio?: string;
    prompt?: string | null;
    generationCost?: number;
    parentImageId?: string | null;
    seedImageId?: string | null;
    originalDesignerId?: string | null;
    createdAt?: Date;
    publishedAt?: Date | null;
    isHidden?: boolean;
    title?: string | null;
    description?: string | null;
    backgroundColor?: string | null;
    feedRank?: number | null;
    /** Set false to seed a listing with NO mirror product — the pre-slice-1
     * world (sellable fields still on the listing row), which only the
     * composition backfill test still needs. */
    mirror?: boolean;
  }
): Promise<string> {
  const aspectRatio = params.aspectRatio ?? "1:1";
  const id = crypto.randomUUID();

  await db.insert(schema.image).values({
    id,
    ownerId: params.ownerId,
    imageUrl: params.imageUrl,
    aspectRatio,
    prompt: params.prompt ?? null,
    generationCost: params.generationCost ?? 0,
    parentImageId: params.parentImageId ?? null,
    seedImageId: params.seedImageId ?? null,
    originalDesignerId: params.originalDesignerId ?? null,
    sourceDesignId: params.designId,
    ...(params.createdAt ? { createdAt: params.createdAt } : {}),
  });
  await db.insert(schema.conversationImage).values({
    designId: params.designId,
    imageId: id,
    role: "output",
  });

  if (params.publishedAt) {
    // Composition slice 4: the listing row is the image-visibility grant
    // only. The pre-slice-1 seed (`mirror: false`) still fills its sellable
    // columns, because that is exactly the legacy shape the backfill reads.
    const legacy = params.mirror === false;
    await db.insert(schema.listing).values({
      imageId: id,
      publishedAt: params.publishedAt,
      isHidden: params.isHidden ?? false,
      ...(legacy
        ? {
            title: params.title ?? null,
            description: params.description ?? null,
            backgroundColor: params.backgroundColor ?? null,
            feedRank: params.feedRank ?? null,
          }
        : {}),
    });
    if (legacy) return id;
    // A published image always has its mirror `product` row, and since slice 2
    // that row is what the sellable surfaces read. Seeding only the listing
    // would produce an image the feed, /d, the admin grid and order-line
    // titles can't see.
    await db.insert(schema.product).values(
      buildMirrorProductRow({
        imageId: id,
        ownerId: params.ownerId,
        listedAt: params.publishedAt,
        title: params.title ?? null,
        description: params.description ?? null,
        backdropColor: params.backgroundColor ?? null,
        feedRank: params.feedRank ?? null,
        status: params.isHidden ? "hidden" : "listed",
      })
    );
  }
  return id;
}

/**
 * Edit a published image's public state the way the publish-family actions
 * do since the slice-4 cutover: sellable fields (title / description /
 * backdrop / feed rank) go to the mirror `product` row alone; `isHidden`
 * goes to both, because it is simultaneously the visibility grant the pure
 * guards read (`listing`) and the composition's status (`product`).
 */
export async function setPublication(
  db: Db,
  imageId: string,
  fields: {
    title?: string | null;
    description?: string | null;
    backgroundColor?: string | null;
    isHidden?: boolean;
    feedRank?: number | null;
  }
) {
  const listingSet: Partial<typeof schema.listing.$inferInsert> = {};
  const productSet: Partial<typeof schema.product.$inferInsert> = {};
  if (fields.title !== undefined) productSet.title = fields.title;
  if (fields.description !== undefined) productSet.description = fields.description;
  if (fields.backgroundColor !== undefined) {
    productSet.backdropColor = fields.backgroundColor;
  }
  if (fields.feedRank !== undefined) productSet.feedRank = fields.feedRank;
  if (fields.isHidden !== undefined) {
    listingSet.isHidden = fields.isHidden;
    productSet.status = fields.isHidden ? "hidden" : "listed";
  }

  if (Object.keys(listingSet).length > 0) {
    await db
      .update(schema.listing)
      .set(listingSet)
      .where(eq(schema.listing.imageId, imageId));
  }

  const mirrors = await db
    .select({ id: schema.product.id, placements: schema.product.placements })
    .from(schema.product)
    .where(
      and(isNull(schema.product.storeId), isNull(schema.product.designId))
    );
  const mirror = mirrors.find((m) => (m.placements ?? {}).front === imageId);
  if (mirror && Object.keys(productSet).length > 0) {
    await db
      .update(schema.product)
      .set(productSet)
      .where(eq(schema.product.id, mirror.id));
  }
}
