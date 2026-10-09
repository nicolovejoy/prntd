/**
 * Post-migration read-back for 0015 (#139): the column exists and how many
 * rows are scored. Exit 1 when the column is missing. Env as the backfill.
 *
 *   npx tsx scripts/check-luminance-column.ts
 */
import { config } from "dotenv";
import { createClient } from "@libsql/client";

config({ path: ".env.local" });
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
console.log(`database: ${new URL(url).host}`);
const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });

async function main() {
  const cols = await client.execute("PRAGMA table_info(image)");
  const col = cols.rows.find((r) => r.name === "luminance");
  if (!col) {
    console.error("FAIL: image.luminance is missing");
    process.exit(1);
  }
  console.log(`image.luminance: type ${col.type}, notnull ${col.notnull}`);
  const counts = await client.execute(
    "SELECT COUNT(*) AS total, SUM(luminance IS NOT NULL) AS scored, MIN(luminance) AS lo, MAX(luminance) AS hi FROM image"
  );
  const c = counts.rows[0];
  console.log(`rows ${c.total}, scored ${c.scored ?? 0}, range ${c.lo ?? "-"} … ${c.hi ?? "-"}`);
  const bad = await client.execute("SELECT COUNT(*) AS n FROM image WHERE luminance < 0 OR luminance > 1");
  if (Number(bad.rows[0].n) > 0) {
    console.error(`FAIL: ${bad.rows[0].n} rows outside 0..1`);
    process.exit(1);
  }
  console.log("VERIFY CLEAN");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
