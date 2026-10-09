/**
 * Fill image.luminance (#139) for rows older than the column. Idempotent:
 * only NULL rows are selected and the UPDATE is guarded on NULL again, so a
 * value the continuation wrote in between is never overwritten.
 *
 *   npx tsx scripts/backfill-image-luminance.ts              # every NULL row
 *   npx tsx scripts/backfill-image-luminance.ts --limit 50
 *   npx tsx scripts/backfill-image-luminance.ts --dry-run    # compute, print, write nothing
 *
 * Env: .env.local (prntd-dev) by default; prod/preview by setting
 * DATABASE_URL and DATABASE_AUTH_TOKEN inline, like db:migrate. Reads PNGs
 * over NEXT_PUBLIC_R2_PUBLIC_URL (images/{id}.png, falling back to the row's
 * image_url for legacy keys). A 404 or an undecodable file leaves NULL.
 */
import { config } from "dotenv";
import { createClient } from "@libsql/client";
import { meanLuminance } from "../src/lib/image-luminance";

config({ path: ".env.local" });

const USAGE = "usage: npx tsx scripts/backfill-image-luminance.ts [--dry-run] [--limit N]";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limitIdx = args.indexOf("--limit");
let limit = Infinity;
if (limitIdx >= 0) {
  const raw = args[limitIdx + 1];
  if (!raw || !/^[1-9]\d*$/.test(raw)) {
    console.error(`--limit needs a positive integer\n${USAGE}`);
    process.exit(1);
  }
  limit = Number(raw);
}

const url = process.env.DATABASE_URL;
const authToken = process.env.DATABASE_AUTH_TOKEN;
const publicUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_URL?.replace(/\/$/, "");
if (!url || !publicUrl) {
  console.error("DATABASE_URL and NEXT_PUBLIC_R2_PUBLIC_URL are required");
  process.exit(1);
}
console.log(`database: ${new URL(url).host}`);
const client = createClient({ url, authToken });

async function fetchPng(id: string, imageUrl: string): Promise<Buffer | null> {
  for (const candidate of [`${publicUrl}/images/${id}.png`, imageUrl]) {
    const res = await fetch(candidate, { signal: AbortSignal.timeout(30_000) });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (res.status !== 404) console.warn(`  ${candidate}: HTTP ${res.status}`);
  }
  return null;
}

async function main() {
  const rows = await client.execute({
    sql: "SELECT id, image_url FROM image WHERE luminance IS NULL ORDER BY created_at ASC, rowid ASC LIMIT ?",
    args: [Number.isFinite(limit) ? limit : -1],
  });
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of rows.rows) {
    const id = String(row.id);
    try {
      const png = await fetchPng(id, String(row.image_url));
      if (!png) {
        failed++;
        console.warn(`${id}: no object`);
        continue;
      }
      const lum = await meanLuminance(png);
      if (lum === null) {
        skipped++;
        console.warn(`${id}: no opaque pixel or undecodable`);
        continue;
      }
      if (dryRun) {
        console.log(`${id}: ${lum.toFixed(4)} (dry run)`);
        updated++;
        continue;
      }
      const res = await client.execute({
        sql: "UPDATE image SET luminance = ? WHERE id = ? AND luminance IS NULL",
        args: [lum, id],
      });
      if (res.rowsAffected === 1) updated++;
      else skipped++;
    } catch (err) {
      failed++;
      console.warn(`${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(`${dryRun ? "would update" : "updated"} ${updated}, skipped ${skipped}, failed ${failed}, of ${rows.rows.length} NULL rows`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
