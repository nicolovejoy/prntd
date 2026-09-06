/**
 * Composition parity check — dual mode around migration 0013 (composition
 * slice 5 + organizer-storefront retirement step 2, #191). Logic lives in
 * `src/lib/composition-parity.ts` (typechecked, real-DB tested); this is the
 * CLI. The mode is detected from the database's tables:
 *
 * PRE-0013 (`listing` present) — Nico's PRE-CHECK before applying 0013. Proves
 * the migration will run and will delete only what it is meant to:
 *   - the guard's two stop conditions are reported as problems: any `order`
 *     with a `store_id`, and any order whose `store_product_id` points at an
 *     organizer product (design_id or store_id set). Either makes the guard
 *     fail and the whole batch roll back — this check names the rows first.
 *   - two surviving Shop compositions pinning the same front image: the new
 *     unique index `product_front_image_unique` could not be built.
 *   - the standing structural parity: every listing has exactly one Shop
 *     composition (store_id + design_id NULL, keyed on placements.front),
 *     is_hidden ⇔ status = 'hidden' (never 'draft'), listed_at = published_at,
 *     and no non-draft composition without a listing.
 *   - as NOTES (not failures): the organizer product rows the migration WILL
 *     DELETE, one line each; compositions with no front slot.
 *
 * POST-0013 (`image_publication` present) — Nico's VERIFY after applying.
 * Problems if `store`, `product_offering`, `listing`, `__slice5_guard` or
 * `__new_product` still exist; `image_publication` is not exactly its four
 * columns; `order.store_id` or `product.store_id`/`design_id` survive;
 * `product.front_image_id` (VIRTUAL generated) or its unique index is
 * missing; `__drizzle_migrations` has no row at or after 0013's journal
 * `when`; or the same structural parity fails against `front_image_id`.
 *
 * `scripts/migration-smoke.ts` exits 1 on ANY dropped table, so it cannot
 * verify a drop migration — this script is the verify step for 0013.
 *
 * Read-only. Safe on prod. Not run by CI. Exits 1 on any problem.
 *
 * Usage (dev via .env.local; prod/preview via inline creds as for db:migrate):
 *   npx tsx --env-file=.env.local scripts/check-composition-read-parity.ts
 *   DATABASE_URL=libsql://prntd-nicolovejoy.aws-us-west-2.turso.io DATABASE_AUTH_TOKEN=$(turso db tokens create prntd) npx tsx scripts/check-composition-read-parity.ts
 */
import { createClient } from "@libsql/client";
import { checkCompositionParity } from "../src/lib/composition-parity";

const url = process.env.DATABASE_URL;
const authToken = process.env.DATABASE_AUTH_TOKEN;
if (!url) throw new Error("DATABASE_URL required");

async function main() {
  const client = createClient({ url: url!, authToken });
  console.log("host:", new URL(url!.replace("libsql://", "https://")).host);

  const report = await checkCompositionParity(client);
  console.log(`mode: ${report.mode}`);

  console.log("\ncounts:");
  for (const [key, value] of Object.entries(report.counts)) {
    console.log(`  ${key}: ${value}`);
  }

  if (report.notes.length) {
    console.log("\nnotes:");
    for (const note of report.notes) console.log(`  ${note}`);
  }

  if (report.problems.length) {
    console.error(`\n${report.problems.length} PROBLEM(S):`);
    for (const p of report.problems) console.error(`  - ${p}`);
    console.error(
      report.mode === "pre-0013"
        ? "\nDo NOT apply migration 0013 until every problem above is resolved."
        : "\nMigration 0013 did not land as written — stop and compare against drizzle/0013_flat_mentor.sql."
    );
    process.exit(1);
  }

  console.log(
    report.mode === "pre-0013"
      ? "\nPRE-0013 CHECK CLEAN — safe to apply migration 0013"
      : "\nPOST-0013 VERIFY CLEAN"
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
