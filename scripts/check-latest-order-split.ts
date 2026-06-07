/**
 * Read-only: print the price split on the most recent order(s) so a manual
 * checkout smoke test can confirm Phase 1B persisted item/shipping/total.
 *
 *   npx tsx --env-file .env.local scripts/check-latest-order-split.ts [N]
 *
 * N = how many recent orders to show (default 3). No writes, no secrets.
 */
import { createClient } from "@libsql/client";

const client = createClient({
  url: process.env.DATABASE_URL!,
  authToken: process.env.DATABASE_AUTH_TOKEN,
});

async function main() {
  const limit = Number(process.argv[2] ?? 3);
  const res = await client.execute({
    sql: `SELECT id, status, size, color, item_price, shipping_price, tax_collected,
                 total_price, discount_code, discount_amount, created_at
          FROM "order"
          ORDER BY created_at DESC
          LIMIT ?`,
    args: [limit],
  });

  for (const r of res.rows) {
    const row = r as Record<string, unknown>;
    console.log("─".repeat(48));
    console.log(`order   ${String(row.id).slice(0, 8)}  [${row.status}]  ${row.size} / ${row.color}`);
    console.log(`item    ${fmt(row.item_price)}`);
    console.log(`ship    ${fmt(row.shipping_price)}`);
    console.log(`tax     ${fmt(row.tax_collected)}`);
    console.log(`total   ${fmt(row.total_price)}`);
    if (row.discount_code) console.log(`promo   ${row.discount_code}  -${fmt(row.discount_amount)}`);
  }
  console.log("─".repeat(48));
  const host = (process.env.DATABASE_URL || "").replace(/^libsql:\/\//, "").split("?")[0];
  console.log(`DB: ${host}`);
}

function fmt(v: unknown): string {
  return v == null ? "(null)" : `$${Number(v).toFixed(2)}`;
}

main();
