/**
 * Phase 2 backfill: every design with a currentImageUrl gets one
 * design_image row, and every order referencing that design gets
 * its placements.front pointed at the new row.
 *
 * Idempotent — designs that already have at least one design_image
 * row are skipped (so existing rows are never duplicated).
 *
 * Run dry first:
 *   npx dotenvx run --env-file=.env.local -- npx tsx scripts/backfill-design-image.ts --dry-run
 * Then for real:
 *   npx dotenvx run --env-file=.env.local -- npx tsx scripts/backfill-design-image.ts
 */

import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { eq, and, isNull } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";

const DRY_RUN = process.argv.includes("--dry-run");

const db = drizzle(
  createClient({
    url: process.env.DATABASE_URL!,
    authToken: process.env.DATABASE_AUTH_TOKEN,
  }),
  { schema }
);

async function main() {
  console.log(DRY_RUN ? "DRY RUN — no writes" : "LIVE RUN");

  const designs = await db.select().from(schema.design);
  console.log(`Designs total: ${designs.length}`);

  let designsWithExistingRows = 0;
  let designsBackfilled = 0;
  let designsSkippedNoImage = 0;
  let ordersUpdated = 0;
  let ordersSkippedHavePlacements = 0;

  for (const d of designs) {
    const existing = await db
      .select({ id: schema.designImage.id })
      .from(schema.designImage)
      .where(eq(schema.designImage.designId, d.id))
      .limit(1);

    if (existing.length > 0) {
      designsWithExistingRows++;
      continue;
    }

    if (!d.currentImageUrl) {
      designsSkippedNoImage++;
      continue;
    }

    const isApproved = d.status === "approved" || d.status === "ordered";
    const newImageId = crypto.randomUUID();

    if (!DRY_RUN) {
      await db.insert(schema.designImage).values({
        id: newImageId,
        designId: d.id,
        parentImageId: null,
        aspectRatio: "1:1",
        productId: null,
        placementId: null,
        imageUrl: d.currentImageUrl,
        prompt: null,
        generationCost: d.generationCost,
        isApproved,
      });
    }
    designsBackfilled++;

    // Point any orders for this design at the new image
    const orders = await db
      .select()
      .from(schema.order)
      .where(eq(schema.order.designId, d.id));

    for (const o of orders) {
      if (o.placements && Object.keys(o.placements).length > 0) {
        ordersSkippedHavePlacements++;
        continue;
      }

      if (!DRY_RUN) {
        await db
          .update(schema.order)
          .set({ placements: { front: newImageId } })
          .where(eq(schema.order.id, o.id));
      }
      ordersUpdated++;
    }
  }

  console.log("---");
  console.log(`Designs with existing rows (skipped): ${designsWithExistingRows}`);
  console.log(`Designs skipped (no currentImageUrl): ${designsSkippedNoImage}`);
  console.log(`Designs backfilled: ${designsBackfilled}`);
  console.log(`Orders updated with placements: ${ordersUpdated}`);
  console.log(`Orders skipped (already had placements): ${ordersSkippedHavePlacements}`);

  // Sanity verification — count rows in DB after the run
  const totalImages = await db.select({ id: schema.designImage.id }).from(schema.designImage);
  const ordersWithoutPlacements = await db
    .select({ id: schema.order.id })
    .from(schema.order)
    .where(and(isNull(schema.order.placements), isNull(schema.order.archivedAt)));
  console.log("---");
  console.log(`design_image rows in DB: ${totalImages.length}`);
  console.log(`Active orders still missing placements: ${ordersWithoutPlacements.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
