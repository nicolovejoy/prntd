/**
 * Shop feed visibility parity — the before-and-after read for moving the
 * feed's filter from `product.status = 'listed'` to
 * `image_publication.is_hidden = 0` (`getPublishedFeed`,
 * src/lib/discover-feed.ts). Logic lives in
 * `src/lib/feed-visibility-parity.ts` (typechecked, real-DB tested); this is
 * the CLI.
 *
 * Prints:
 *   - counts of publication rows and compositions by status;
 *   - every row where `image_publication` and `product.status` disagree: a
 *     publication whose composition is missing or has the wrong status
 *     (is_hidden=1 ⇒ hidden, is_hidden=0 ⇒ listed), and a non-draft
 *     composition whose front image has no publication row;
 *   - the image ids the feed's joins return under the old filter and under
 *     the new one, and the ids in only one of the two.
 *
 * Exits 0 and prints PARITY CLEAN when the two lists are identical, so the
 * filter change leaves the feed as it was. Exits 1 when they differ, or on
 * any error. A disagreement that does not change the feed (a hidden
 * publication on a draft composition, say) is printed but does not fail.
 *
 * Read-only (SELECTs). Safe on prod. Not run by CI. Run it on Production
 * before the change merges and again after it deploys.
 *
 * Usage (dev via .env.local; prod/preview via inline creds as for db:migrate):
 *   npx tsx --env-file=.env.local scripts/check-feed-visibility-parity.ts
 *   DATABASE_URL=libsql://prntd-nicolovejoy.aws-us-west-2.turso.io DATABASE_AUTH_TOKEN=$(turso db tokens create prntd) npx tsx scripts/check-feed-visibility-parity.ts
 */
import { createClient } from "@libsql/client";
import { checkFeedVisibilityParity } from "../src/lib/feed-visibility-parity";

const url = process.env.DATABASE_URL;
const authToken = process.env.DATABASE_AUTH_TOKEN;
if (!url) throw new Error("DATABASE_URL required");

async function main() {
  const client = createClient({ url: url!, authToken });
  console.log("host:", new URL(url!.replace("libsql://", "https://")).host);

  const report = await checkFeedVisibilityParity(client);

  console.log("\ncounts:");
  for (const [key, value] of Object.entries(report.counts)) {
    console.log(`  ${key}: ${value}`);
  }

  console.log(`\ndisagreements (${report.disagreements.length}):`);
  for (const d of report.disagreements) {
    console.log(
      `  [${d.kind}] image ${d.imageId}  product ${d.productId ?? "—"}  status ${d.productStatus ?? "—"}  is_hidden ${d.isHidden === null ? "—" : d.isHidden ? 1 : 0}  ${d.reason}`
    );
  }

  console.log(`\nold feed (product.status = 'listed'): ${report.oldFeedImageIds.length}`);
  for (const id of report.oldFeedImageIds) console.log(`  ${id}`);
  console.log(`\nnew feed (image_publication.is_hidden = 0): ${report.newFeedImageIds.length}`);
  for (const id of report.newFeedImageIds) console.log(`  ${id}`);

  console.log(`\nonly in the old feed (${report.onlyOld.length}):`);
  for (const id of report.onlyOld) console.log(`  ${id}`);
  console.log(`only in the new feed (${report.onlyNew.length}):`);
  for (const id of report.onlyNew) console.log(`  ${id}`);

  if (!report.clean) {
    console.error(
      `\nPARITY FAILED: the feed lists differ (${report.onlyOld.length} only under the old filter, ${report.onlyNew.length} only under the new one). Resolve the disagreements above before relying on image_publication for the feed.`
    );
    process.exit(1);
  }

  console.log("\nPARITY CLEAN");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
