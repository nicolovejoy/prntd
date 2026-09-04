/**
 * Structural parity between the image-visibility rows (`listing`) and the
 * Shop compositions (`product` mirrors).
 *
 * Written as the pre-flight for the slice-2 read swap, kept as the standing
 * invariant check — including as the gate before slice 5 drops the moved
 * columns and renames `listing` → `image_publication`.
 *
 * SCOPE, since the slice-4 writer cutover: the sellable fields (title,
 * description, background_color, feed_rank) are written to `product` ONLY.
 * The listing's copies are frozen at their pre-cutover values, so they
 * legitimately differ from the product on any row edited since — this script
 * deliberately does NOT compare them. What must still agree is the structure:
 *
 *   - every listing has exactly one mirror product (and vice versa)
 *   - hidden-state ↔ status (is_hidden ⇔ status = 'hidden', never 'draft')
 *   - listed_at = published_at (the feed sort)
 *
 * Exits 1 on any mismatch. Read-only. Safe on prod. Not run by CI.
 *
 * Usage:
 *   DATABASE_URL=... DATABASE_AUTH_TOKEN=... npx tsx scripts/check-composition-read-parity.ts
 */
import { createClient } from "@libsql/client";

const url = process.env.DATABASE_URL;
const authToken = process.env.DATABASE_AUTH_TOKEN;
if (!url) throw new Error("DATABASE_URL required");

type Row = Record<string, unknown>;

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
      `select image_id, published_at, is_hidden from listing`
    )
  ).rows as unknown as Row[];

  // Mirror rows: the PRNTD Shop compositions (no store, no design), keyed by
  // their front placement slot — exactly what the slice-2 readers join on.
  const mirrors = (
    await client.execute(
      `select json_extract(placements, '$.front') as front_image_id,
              id, status, listed_at
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
      problems.push(
        `${imageId}: published image with no composition — invisible in the Shop, and unbuyable since slice 4`
      );
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
        `${imageId}: mirror status ${m.status}, expected ${expectedStatus} (hidden-state disagrees)`
      );
    }
    if (num(m.listed_at) === null) {
      problems.push(`${imageId}: mirror has no listed_at — the feed sort needs it`);
    } else if (num(m.listed_at) !== num(l.published_at)) {
      problems.push(
        `${imageId}: listed_at ${num(m.listed_at)} != listing published_at ${num(l.published_at)}`
      );
    }
  }

  // A published mirror with no listing would newly appear in the Shop.
  const listedImageIds = new Set(listings.map((l) => String(l.image_id)));
  for (const [imageId, rows] of byImage) {
    for (const m of rows) {
      if (String(m.status) !== "draft" && !listedImageIds.has(imageId)) {
        problems.push(
          `${imageId}: mirror is ${m.status} but the image has no visibility row — listed in the Shop with no publish grant`
        );
      }
    }
  }

  console.log(`\nvisibility rows (listing): ${listings.length}`);
  console.log(`shop compositions (mirror products): ${mirrors.length}`);

  if (problems.length) {
    console.error(`\n${problems.length} PROBLEM(S):`);
    for (const p of problems) console.error(`  - ${p}`);
    console.error(
      "\nA missing composition is fixable with scripts/backfill-composition-products.ts --apply." +
        "\nA status / listed_at disagreement is not — investigate before re-running anything."
    );
    process.exit(1);
  }
  console.log(
    "\nstructural parity clean: every published image has exactly one composition, and they agree on visibility + listed_at."
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
