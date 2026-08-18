/**
 * Composition slice 1 backfill (docs/composition-first-class-plan.md §4–5).
 *
 * Creates a mirror `product` row for every `listing` that doesn't have one:
 * ownerId = image owner, storeId NULL, designId NULL, blankId NULL,
 * placements { front: imageId }, price NULL,
 * status = isHidden ? "hidden" : "listed", title/description/backdropColor/
 * feedRank carried over, listedAt = publishedAt.
 *
 * Idempotent: mirrors are identified by
 * storeId IS NULL AND designId IS NULL AND placements = {front: imageId};
 * a re-run finds them all and creates nothing. Prints a verification summary
 * either way. Requires migration 0010 on the target DB first.
 *
 * Dry-run by default:
 *   npx tsx --env-file=.env.local scripts/backfill-composition-products.ts
 * Mutate:
 *   npx tsx --env-file=.env.local scripts/backfill-composition-products.ts --apply
 * Prod: inject DATABASE_URL / DATABASE_AUTH_TOKEN inline (see CLAUDE.md
 * "Migration discipline").
 */
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "../src/lib/db/schema";
import {
  backfillCompositionMirrors,
  verifyCompositionMirrors,
} from "../src/lib/composition-backfill";
import type { db as appDb } from "../src/lib/db";

// Belt-and-braces .env.local load (works with or without --env-file).
config({ path: ".env.local" });

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(apply ? "APPLY — will insert product rows" : "DRY RUN — no writes");

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  console.log(`target: ${new URL(url).host}`);

  const db = drizzle(
    createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN }),
    { schema }
  ) as unknown as typeof appDb;

  const summary = await backfillCompositionMirrors(db, { apply });
  console.log(`listings scanned:   ${summary.listings}`);
  console.log(`mirrors found:      ${summary.mirrorsFound}`);
  console.log(
    `${apply ? "mirrors created:   " : "would create:      "} ${summary.mirrorsCreated}`
  );
  if (summary.missingImageIds.length > 0) {
    console.warn(
      `listings with no image row (skipped): ${summary.missingImageIds.length}`
    );
    for (const id of summary.missingImageIds) console.warn(`  ! ${id}`);
  }

  const problems = await verifyCompositionMirrors(db);
  if (problems.length === 0) {
    console.log(
      apply
        ? "verify: every listing has exactly one matching mirror ✓"
        : "verify (pre-apply state): see counts above"
    );
  } else {
    console.log(`verify: ${problems.length} mismatch(es)${apply ? "" : " (expected in dry run for listings not yet mirrored)"}`);
    for (const p of problems) console.log(`  - ${p}`);
  }
  if (apply && (problems.length > 0 || summary.missingImageIds.length > 0)) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
