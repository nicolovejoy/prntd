/**
 * Model B slice-1 backfill (docs/model-b-migration-plan.md). Populates the new
 * additive tables from the existing `design_image` / `design` rows so slice 2
 * can read from them. Additive-only — reads design_image, never mutates it.
 *
 * Split rule: a design_image with product_id IS NULL is a source artifact →
 * `image` (+ role=output link); with product_id set it's a placement render →
 * `placement_render`. Both keep the design_image id (id reuse §2/§5) so pinned
 * order/product placements resolve unchanged. Published rows (published_at NOT
 * NULL) also get a `listing`. A design with forked_from_image_id gets a
 * role=seed link, and its images carry seed_image_id / original_designer_id
 * from the design (provenance moves onto the image graph, item 4).
 *
 * Idempotent: every insert is ON CONFLICT DO NOTHING (PKs + the
 * conversation_image unique index), so re-runs are safe and chunked in bulk
 * statements (never db.transaction — libSQL serverless HTTP).
 *
 * Run dry first:
 *   source .env.local && npx tsx scripts/backfill-model-b.ts --dry-run
 * Then for real:
 *   source .env.local && npx tsx scripts/backfill-model-b.ts
 */
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { fileURLToPath } from "node:url";
import * as schema from "../src/lib/db/schema";
import type { db as appDb } from "../src/lib/db";
import {
  buildImageRow,
  buildOutputLinkRow,
  buildPlacementRenderRow,
  buildListingRow,
} from "../src/lib/model-b-writes";

const CHUNK = 100;

function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

export type BackfillCounts = {
  images: number;
  outputLinks: number;
  placementRenders: number;
  listings: number;
  seedLinks: number;
};

export async function backfillModelB(
  db: typeof appDb,
  opts: { dryRun?: boolean } = {}
): Promise<BackfillCounts> {
  const dryRun = opts.dryRun ?? false;

  const designs = await db
    .select({
      id: schema.design.id,
      userId: schema.design.userId,
      forkedFromImageId: schema.design.forkedFromImageId,
      originalDesignerId: schema.design.originalDesignerId,
    })
    .from(schema.design);
  const designById = new Map(designs.map((d) => [d.id, d]));

  const rows = await db.select().from(schema.designImage);

  const imageRows: (typeof schema.image.$inferInsert)[] = [];
  const outputLinks: (typeof schema.conversationImage.$inferInsert)[] = [];
  const renderRows: (typeof schema.placementRender.$inferInsert)[] = [];
  const listingRows: (typeof schema.listing.$inferInsert)[] = [];

  for (const r of rows) {
    const design = designById.get(r.designId);
    if (!design) continue; // orphaned design_image — skip, nothing owns it

    if (r.productId === null) {
      imageRows.push(
        buildImageRow({
          id: r.id,
          ownerId: design.userId,
          designId: r.designId,
          imageUrl: r.imageUrl,
          aspectRatio: r.aspectRatio,
          prompt: r.prompt,
          generator: r.generator,
          generationCost: r.generationCost,
          parentImageId: r.parentImageId,
          seedImageId: design.forkedFromImageId,
          originalDesignerId: design.originalDesignerId,
        })
      );
      outputLinks.push(buildOutputLinkRow(r.designId, r.id));
    } else {
      renderRows.push(
        buildPlacementRenderRow({
          id: r.id,
          designId: r.designId,
          sourceImageId: r.parentImageId,
          blankId: r.productId,
          placementId: r.placementId,
          imageUrl: r.imageUrl,
          aspectRatio: r.aspectRatio,
          generationCost: r.generationCost,
        })
      );
    }

    if (r.publishedAt !== null) {
      listingRows.push(
        buildListingRow({
          imageId: r.id,
          publishedAt: r.publishedAt,
          isHidden: r.isHidden,
          title: r.title,
          description: r.description,
          backgroundColor: r.backgroundColor,
          feedRank: r.feedRank,
        })
      );
    }
  }

  // One seed link per forked design.
  const seedLinks: (typeof schema.conversationImage.$inferInsert)[] = [];
  for (const d of designs) {
    if (d.forkedFromImageId) {
      seedLinks.push({
        id: crypto.randomUUID(),
        designId: d.id,
        imageId: d.forkedFromImageId,
        role: "seed",
      });
    }
  }

  const counts: BackfillCounts = {
    images: imageRows.length,
    outputLinks: outputLinks.length,
    placementRenders: renderRows.length,
    listings: listingRows.length,
    seedLinks: seedLinks.length,
  };

  if (dryRun) return counts;

  for (const c of chunk(imageRows, CHUNK)) {
    await db.insert(schema.image).values(c).onConflictDoNothing();
  }
  for (const c of chunk(renderRows, CHUNK)) {
    await db.insert(schema.placementRender).values(c).onConflictDoNothing();
  }
  for (const c of chunk(listingRows, CHUNK)) {
    await db.insert(schema.listing).values(c).onConflictDoNothing();
  }
  // Links go last so their image_ids already exist (opaque text, but keeps the
  // graph consistent at every intermediate point of a partial run).
  for (const c of chunk([...outputLinks, ...seedLinks], CHUNK)) {
    await db.insert(schema.conversationImage).values(c).onConflictDoNothing();
  }

  return counts;
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  process.argv[1] === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const dryRun = process.argv.includes("--dry-run");
  const db = drizzle(
    createClient({
      url: process.env.DATABASE_URL!,
      authToken: process.env.DATABASE_AUTH_TOKEN,
    }),
    { schema }
  ) as unknown as typeof appDb;

  console.log(dryRun ? "DRY RUN — no writes" : "LIVE RUN");
  backfillModelB(db, { dryRun })
    .then((c) => {
      console.log("---");
      console.log(`images:            ${c.images}`);
      console.log(`output links:      ${c.outputLinks}`);
      console.log(`placement renders: ${c.placementRenders}`);
      console.log(`listings:          ${c.listings}`);
      console.log(`seed links:        ${c.seedLinks}`);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
