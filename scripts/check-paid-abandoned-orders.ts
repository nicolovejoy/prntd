/**
 * Read-only (#327): lists orders past pending that still carry abandoned_at,
 * the state a paid completion could leave before the claim cleared it.
 *
 *   npx tsx scripts/check-paid-abandoned-orders.ts
 *
 * Production:
 *   DATABASE_URL=libsql://prntd-nicolovejoy.aws-us-west-2.turso.io DATABASE_AUTH_TOKEN=$(turso db tokens create prntd) npx tsx scripts/check-paid-abandoned-orders.ts
 */
import { config } from "dotenv";
import { createClient } from "@libsql/client";

config({ path: ".env.local", quiet: true });
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
console.log(`database: ${new URL(url).host || url}`);
const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });

async function main() {
  const res = await client.execute(
    "SELECT id, status, created_at, abandoned_at, total_price FROM \"order\" WHERE status <> 'pending' AND abandoned_at IS NOT NULL ORDER BY created_at"
  );
  const iso = (v: unknown) =>
    v == null ? "-" : new Date(Number(v) * 1000).toISOString();
  console.log(`orders past pending with abandoned_at set: ${res.rows.length}`);
  for (const r of res.rows) {
    console.log(
      `${r.id}  ${r.status}  created ${iso(r.created_at)}  abandoned ${iso(r.abandoned_at)}  total ${r.total_price}`
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
