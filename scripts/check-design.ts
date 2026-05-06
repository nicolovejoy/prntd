import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { sql } from "drizzle-orm";

const id = process.argv[2];
if (!id) {
  console.error("Usage: node --env-file=.env.local --import tsx scripts/check-design.ts <design-id>");
  process.exit(1);
}

const db = drizzle(
  createClient({
    url: process.env.DATABASE_URL!,
    authToken: process.env.DATABASE_AUTH_TOKEN,
  })
);

async function main() {
  const r = await db.run(sql`
    SELECT
      id,
      status,
      current_image_url IS NOT NULL AS has_url,
      primary_image_id IS NOT NULL AS has_primary,
      generation_count,
      json_array_length(COALESCE(chat_history, '[]')) AS chat_len,
      datetime(created_at / 1000, 'unixepoch') AS created,
      datetime(updated_at / 1000, 'unixepoch') AS updated
    FROM design WHERE id = ${id}
  `);
  console.log(r.rows);

  const imgs = await db.run(sql`
    SELECT id, image_url, product_id, placement_id, datetime(created_at / 1000, 'unixepoch') AS created
    FROM design_image WHERE design_id = ${id} ORDER BY created_at
  `);
  console.log(`design_image rows: ${imgs.rows.length}`);
  for (const row of imgs.rows) console.log(row);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
