/**
 * Pre-flight for composition slice 2 (the read swap: the Shop feed, the image
 * detail page, the admin published grid and order-line titles stop reading
 * `listing` and start reading the mirror `product` row).
 *
 * Slice 1 has been dual-writing since 2026-08-17 and the backfill converted
 * the pre-existing listings, so every `listing` row should have exactly one
 * mirror product carrying the same sellable state. If it doesn't, deploying
 * the read swap makes those images vanish from the Shop (or come back with
 * the wrong title / backdrop / rank / hidden state).
 *
 * Run this against prod BEFORE the swap deploys. Exits 1 on any mismatch.
 * Read-only. Safe on prod. Not run by CI.
 *
 * Usage:
 *   DATABASE_URL=... DATABASE_AUTH_TOKEN=... npx tsx scripts/check-composition-read-parity.ts
 */
import { createClient } from "@libsql/client";

const url = process.env.DATABASE_URL;
const authToken = process.env.DATABASE_AUTH_TOKEN;
if (!url) throw new Error("DATABASE_URL required");

type Row = Record<string, unknown>;

const str = (v: unknown): string | null =>
  v === null || v === undefined ? null : String(v);
const num = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

async function main() {
  const client = createClient({ url: url!, authToken });
  console.log("host:", new URL(url!.replace("libsql://", "https://")).host);

  const tables = await client.execute(
    "select name from sqlite_master where type='table' and name in ('listing','product')"
  );
  const present = new Set(tables.rows.map((r) => String(r.name)));
  for (const t of ["listing", "product"]) {
    if (!present.has(t)) {
      console.error(`MISSING table ${t}. Stop.`);
      process.exit(2);
    }
  }

  const listings = (
    await client.execute(
      `select image_id, published_at, is_hidden, title, description,
              background_color, feed_rank
         from listing`
    )
  ).rows as unknown as Row[];

  // Mirror rows: the PRNTD Shop compositions (no store, no design), keyed by
  // their front placement slot — exactly what the slice-2 readers join on.
  const mirrors = (
    await client.execute(
      `select json_extract(placements, '$.front') as front_image_id,
              id, status, title, description, backdrop_color, feed_rank,
              listed_at, owner_id, blank_id, price
         from product
        where store_id is null and design_id is null
          and json_extract(placements, '$.front') is not null`
    )
  ).rows as unknown as Row[];

  const byImage = new Map<string, Row[]>();
  for (const m of mirrors) {
    const key = String(m.front_image_id);
    const list = byImage.get(key) ?? [];
    list.push(m);
    byImage.set(key, list);
  }

  const problems: string[] = [];
  for (const l of listings) {
    const imageId = String(l.image_id);
    const found = byImage.get(imageId) ?? [];
    if (found.length === 0) {
      problems.push(`${imageId}: no mirror product — the read swap would hide it`);
      continue;
    }
    if (found.length > 1) {
      problems.push(`${imageId}: ${found.length} mirror products (expected 1)`);
      continue;
    }
    const m = found[0];
    const expectedStatus = Number(l.is_hidden) ? "hidden" : "listed";
    if (String(m.status) !== expectedStatus) {
      problems.push(
        `${imageId}: mirror status ${m.status}, expected ${expectedStatus}`
      );
    }
    if (str(m.title) !== str(l.title)) {
      problems.push(
        `${imageId}: title "${str(m.title)}" != listing "${str(l.title)}"`
      );
    }
    if (str(m.description) !== str(l.description)) {
      problems.push(`${imageId}: description mismatch`);
    }
    if (str(m.backdrop_color) !== str(l.background_color)) {
      problems.push(
        `${imageId}: backdrop "${str(m.backdrop_color)}" != listing "${str(l.background_color)}"`
      );
    }
    if (num(m.feed_rank) !== num(l.feed_rank)) {
      problems.push(
        `${imageId}: feedRank ${num(m.feed_rank)} != listing ${num(l.feed_rank)}`
      );
    }
    if (num(m.listed_at) === null) {
      problems.push(`${imageId}: mirror has no listed_at — the feed sort needs it`);
    }
  }

  // A published mirror with no listing would newly appear in the Shop.
  const listedImageIds = new Set(listings.map((l) => String(l.image_id)));
  for (const [imageId, rows] of byImage) {
    for (const m of rows) {
      if (String(m.status) !== "draft" && !listedImageIds.has(imageId)) {
        problems.push(
          `${imageId}: mirror is ${m.status} but the image has no listing — the swap would publish it`
        );
      }
    }
  }

  console.log(`\nlistings: ${listings.length}`);
  console.log(`shop mirrors: ${mirrors.length}`);

  if (problems.length) {
    console.error(`\n${problems.length} PROBLEM(S):`);
    for (const p of problems) console.error(`  - ${p}`);
    console.error(
      "\nRe-run scripts/backfill-composition-products.ts --apply, then re-check."
    );
    process.exit(1);
  }
  console.log("\nparity clean — safe to deploy the slice-2 read swap.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
