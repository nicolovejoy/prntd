/**
 * Pre-flight for Model B slice 5 (migration 0009, which DROPS design_image).
 *
 * Slice 1 dual-wrote with id reuse, so every legacy design_image row should
 * have a Model B counterpart carrying the same id: a plain artifact lands in
 * `image`, a placement-render row (product_id + placement_id set) lands in
 * `placement_render`, and a published row additionally lands in `listing`.
 *
 * Run this BEFORE applying 0009. A non-zero orphan count means the drop would
 * lose rows that nothing else records — stop and re-run the backfill (it is on
 * main until #160 merges; recover from git history after).
 *
 * Read-only. Safe on prod.
 *
 * Usage:
 *   DATABASE_URL=... DATABASE_AUTH_TOKEN=... npx tsx scripts/check-model-b-parity.ts
 */
import { createClient } from "@libsql/client";

const url = process.env.DATABASE_URL;
const authToken = process.env.DATABASE_AUTH_TOKEN;
if (!url) throw new Error("DATABASE_URL required");

async function main() {
  const client = createClient({ url: url!, authToken });
  console.log("host:", new URL(url!.replace("libsql://", "https://")).host);

  const tables = await client.execute(
    "select name from sqlite_master where type='table' and name in ('design_image','image','listing','placement_render')"
  );
  const present = new Set(tables.rows.map((r) => String(r.name)));
  if (!present.has("design_image")) {
    console.log("\ndesign_image is already gone — 0009 has been applied here.");
    return;
  }
  for (const t of ["image", "listing", "placement_render"]) {
    if (!present.has(t)) {
      console.error(`MISSING table ${t} — slice 1 never ran on this DB. Stop.`);
      process.exit(2);
    }
  }

  const count = async (sql: string) =>
    Number((await client.execute(sql)).rows[0].n);

  const total = await count("select count(*) as n from design_image");

  // Artifacts: no product/placement pair. Must exist in `image` under the same id.
  const orphanArtifacts = await count(`
    select count(*) as n from design_image di
    where (di.product_id is null or di.placement_id is null)
      and not exists (select 1 from image i where i.id = di.id)
  `);

  // Placement renders: product_id + placement_id both set. Slice 1 moved these
  // to placement_render, which mints its own ids, so match on the tuple that
  // identifies the render rather than on id.
  const orphanRenders = await count(`
    select count(*) as n from design_image di
    where di.product_id is not null and di.placement_id is not null
      and not exists (
        select 1 from placement_render pr
        where pr.design_id = di.design_id
          and pr.blank_id = di.product_id
          and pr.placement_id = di.placement_id
          and pr.image_url = di.image_url
      )
      and not exists (select 1 from image i where i.id = di.id)
  `);

  // Published rows must have a listing keyed by the same image id.
  const orphanListings = await count(`
    select count(*) as n from design_image di
    where di.published_at is not null
      and not exists (select 1 from listing l where l.image_id = di.id)
  `);

  console.log(`\ndesign_image rows:        ${total}`);
  console.log(`orphan artifacts:         ${orphanArtifacts}`);
  console.log(`orphan placement renders: ${orphanRenders}`);
  console.log(`orphan listings:          ${orphanListings}`);

  const bad = orphanArtifacts + orphanRenders + orphanListings;
  if (bad > 0) {
    console.error(
      `\n❌ ${bad} design_image row(s) have no Model B counterpart. Do NOT apply 0009 — the drop would lose them.`
    );
    process.exit(1);
  }
  console.log("\n✅ parity OK — every design_image row is represented. Safe to apply 0009.");
}

main();
