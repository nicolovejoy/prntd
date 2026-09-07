/**
 * Read-only: print the cached Printful mockup URLs for every visible Shop
 * listing, so real product photography can feed design mocks (the homepage
 * hero canvas asked for real shirts, not drawn garments).
 *
 * The buy page renders listing mockups anchored on the listed image
 * (`getListingMockup` passes `sourceImageId: imageId`), so the cache keys
 * under the source design's `mockup_urls` that carry `:<imageId>:` are the
 * exact renders a buyer sees. Only listings that someone has expanded
 * Order on will have any; the rest print "(no cached mockups)".
 *
 * Writes nothing. Safe against prod.
 *
 *   DATABASE_URL=libsql://prntd-nicolovejoy.aws-us-west-2.turso.io \
 *   DATABASE_AUTH_TOKEN=$(turso db tokens create prntd) \
 *   npx tsx scripts/dump-listing-mockups.ts
 */
import { createClient } from "@libsql/client";

async function main() {
  const url = process.env.DATABASE_URL;
  const authToken = process.env.DATABASE_AUTH_TOKEN;
  if (!url) throw new Error("DATABASE_URL is required");
  console.log(`target: ${new URL(url.replace("libsql://", "https://")).host}`);

  const client = createClient({ url, authToken });
  try {
    const { rows } = await client.execute(`
      select l.image_id, p.title, p.backdrop_color, i.image_url,
             d.id as design_id, d.mockup_urls
      from listing l
      join image i on i.id = l.image_id
      left join product p on json_extract(p.placements, '$.front') = l.image_id
        and p.store_id is null and p.design_id is null
      join conversation_image ci on ci.image_id = l.image_id
      join design d on d.id = ci.design_id
      where l.is_hidden = 0
      group by l.image_id
      order by p.feed_rank asc, l.published_at desc
    `);

    console.log(`visible listings: ${rows.length}\n`);
    for (const r of rows) {
      const imageId = String(r.image_id);
      console.log(`## ${r.title ?? "(untitled)"}  image ${imageId}  backdrop ${r.backdrop_color ?? "-"}`);
      console.log(`   artwork: ${r.image_url}`);
      let cache: Record<string, string> = {};
      try {
        cache = r.mockup_urls ? JSON.parse(String(r.mockup_urls)) : {};
      } catch {
        cache = {};
      }
      const hits = Object.entries(cache).filter(
        ([k]) => k.startsWith("v2:") && k.includes(`:${imageId}:`),
      );
      if (hits.length === 0) console.log("   (no cached mockups)");
      for (const [k, v] of hits) console.log(`   ${k}\n     ${v}`);
      console.log();
    }
  } finally {
    client.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
