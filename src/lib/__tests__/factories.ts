/**
 * Shared seed helpers for real-DB integration tests (createTestDb). Kept
 * minimal — only what's duplicated verbatim across test files. Don't force
 * every integration test onto these; add a factory only when a second file
 * needs the exact same shape.
 */
import type { db as appDb } from "@/lib/db";
import * as schema from "@/lib/db/schema";

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
 * Seed a source image in the PRE-cutover shape: a legacy `design_image` row
 * plus the Model B rows (`image` + `conversation_image(role=output)`, and a
 * `listing` when published) under one shared id. Production stopped writing
 * design_image in slice 4, but prod data still holds those rows until slice 5
 * drops the table — seeding both keeps delete paths honest about legacy rows.
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
  }
): Promise<string> {
  const aspectRatio = params.aspectRatio ?? "1:1";
  const [row] = await db
    .insert(schema.designImage)
    .values({
      designId: params.designId,
      aspectRatio,
      imageUrl: params.imageUrl,
      prompt: params.prompt ?? null,
      generationCost: params.generationCost ?? 0,
      parentImageId: params.parentImageId ?? null,
      publishedAt: params.publishedAt ?? null,
      isHidden: params.isHidden ?? false,
      title: params.title ?? null,
      description: params.description ?? null,
      backgroundColor: params.backgroundColor ?? null,
      feedRank: params.feedRank ?? null,
      ...(params.createdAt ? { createdAt: params.createdAt } : {}),
    })
    .returning();

  await db.insert(schema.image).values({
    id: row.id,
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
    imageId: row.id,
    role: "output",
  });

  if (params.publishedAt) {
    await db.insert(schema.listing).values({
      imageId: row.id,
      publishedAt: params.publishedAt,
      isHidden: params.isHidden ?? false,
      title: params.title ?? null,
      description: params.description ?? null,
      backgroundColor: params.backgroundColor ?? null,
      feedRank: params.feedRank ?? null,
    });
  }
  return row.id;
}
