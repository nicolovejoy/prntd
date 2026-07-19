/**
 * Read-only: why does the compose picker show fewer designs than exist?
 * Breaks the design table down by owner and by the picker's filters
 * (not archived + has a primary image). No writes, no secrets printed.
 *
 *   npx tsx scripts/check-composable-designs.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@libsql/client";

const client = createClient({
  url: process.env.DATABASE_URL!,
  authToken: process.env.DATABASE_AUTH_TOKEN,
});

async function main() {
  const total = await client.execute(`select count(*) as c from design`);
  console.log(`total designs: ${total.rows[0].c}\n`);

  // Per-owner breakdown with the picker's filters applied.
  const byUser = await client.execute(`
    select
      u.email as email,
      d.user_id as user_id,
      count(*) as total,
      sum(case when d.status = 'archived' then 1 else 0 end) as archived,
      sum(case when d.primary_image_id is null then 1 else 0 end) as no_primary,
      sum(case when d.status != 'archived' and d.primary_image_id is not null
               then 1 else 0 end) as composable
    from design d
    left join user u on u.id = d.user_id
    group by d.user_id
    order by total desc
  `);

  console.log("owner".padEnd(34), "total", "arch", "noImg", "→shows");
  for (const r of byUser.rows) {
    const who = String(r.email ?? r.user_id ?? "(null)").slice(0, 32);
    console.log(
      who.padEnd(34),
      String(r.total).padStart(5),
      String(r.archived).padStart(4),
      String(r.no_primary).padStart(5),
      String(r.composable).padStart(6)
    );
  }
  process.exit(0);
}

main();
