/**
 * Step 1 of the design data model rework: populate
 * `design.primary_image_id` for every existing design.
 *
 * Strategy:
 *   1. For every design, ensure each `chat_history.imageUrl` has a
 *      corresponding `design_image` row (idempotent; skips ones already
 *      reified by the earlier Phase 2 backfill or normal flow).
 *   2. Set `design.primary_image_id` to whichever `design_image` row
 *      matches `currentImageUrl`. Falls back to the most recent
 *      design_image for the design if no URL match exists.
 *
 * Idempotent — designs that already have `primary_image_id` set are
 * skipped. Image-URL→row matching is exact, so re-running won't insert
 * duplicate rows.
 *
 * Run dry first:
 *   source .env.local && npx tsx scripts/backfill-primary-image.ts --dry-run
 * Then for real:
 *   source .env.local && npx tsx scripts/backfill-primary-image.ts
 */

import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { eq, and, desc, isNull } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";
import type { ChatMessage } from "../src/lib/db/schema";

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

  let alreadyHavePrimary = 0;
  let chatImagesReified = 0;
  let primarySetFromUrl = 0;
  let primarySetFromLatest = 0;
  let noImagesAtAll = 0;

  for (const d of designs) {
    if (d.primaryImageId) {
      alreadyHavePrimary++;
      continue;
    }

    // Reify any chat_history images that don't have a design_image row.
    const history = (d.chatHistory as ChatMessage[] | null) ?? [];
    const chatImageUrls = history
      .filter((m) => m.imageUrl)
      .map((m) => m.imageUrl!);

    const existingRows = await db
      .select({
        id: schema.designImage.id,
        imageUrl: schema.designImage.imageUrl,
      })
      .from(schema.designImage)
      .where(eq(schema.designImage.designId, d.id));
    const existingByUrl = new Map(existingRows.map((r) => [r.imageUrl, r.id]));

    for (const url of chatImageUrls) {
      if (existingByUrl.has(url)) continue;
      const newId = crypto.randomUUID();
      if (!DRY_RUN) {
        await db.insert(schema.designImage).values({
          id: newId,
          designId: d.id,
          parentImageId: null,
          aspectRatio: "1:1",
          productId: null,
          placementId: null,
          imageUrl: url,
          prompt: null,
          generationCost: 0,
          isApproved: false,
        });
      }
      existingByUrl.set(url, newId);
      chatImagesReified++;
    }

    // Pick the primary: prefer the row whose URL matches currentImageUrl.
    let primaryId: string | null = null;
    if (d.currentImageUrl && existingByUrl.has(d.currentImageUrl)) {
      primaryId = existingByUrl.get(d.currentImageUrl)!;
      primarySetFromUrl++;
    } else if (existingByUrl.size > 0) {
      // Fallback: latest design_image for this design.
      const latest = await db
        .select({ id: schema.designImage.id })
        .from(schema.designImage)
        .where(eq(schema.designImage.designId, d.id))
        .orderBy(desc(schema.designImage.createdAt))
        .limit(1);
      primaryId = latest[0]?.id ?? null;
      if (primaryId) primarySetFromLatest++;
    } else {
      noImagesAtAll++;
    }

    if (primaryId && !DRY_RUN) {
      await db
        .update(schema.design)
        .set({ primaryImageId: primaryId, updatedAt: new Date() })
        .where(eq(schema.design.id, d.id));
    }
  }

  console.log("---");
  console.log(`Designs already had primary_image_id (skipped): ${alreadyHavePrimary}`);
  console.log(`Chat-history images reified into design_image: ${chatImagesReified}`);
  console.log(`Primary set from currentImageUrl match: ${primarySetFromUrl}`);
  console.log(`Primary set from fallback (latest image): ${primarySetFromLatest}`);
  console.log(`Designs with no images at all (skipped): ${noImagesAtAll}`);

  // Sanity verification.
  const stillNull = await db
    .select({ id: schema.design.id })
    .from(schema.design)
    .where(and(isNull(schema.design.primaryImageId)));
  console.log("---");
  console.log(`Designs still missing primary_image_id: ${stillNull.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
