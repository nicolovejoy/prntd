/**
 * Read-only check: inspect the most recent order(s) to verify the #25 back
 * placement went through end-to-end. Prints status, classification, the
 * placements JSON (expect front+back), the price split, the Printful order id,
 * and the ledger rows. Writes the same to /tmp/back-order-check.json.
 *
 *   npx tsx --env-file .env.local scripts/check-back-order.ts
 */
import { createClient } from "@libsql/client";
import { writeFileSync } from "node:fs";

const client = createClient({
  url: process.env.DATABASE_URL!,
  authToken: process.env.DATABASE_AUTH_TOKEN,
});

async function main() {
  const host = (process.env.DATABASE_URL || "").replace(/^libsql:\/\//, "").split(".")[0];
  const orders = await client.execute(
    `SELECT id, status, classification, placements, item_price, shipping_price,
            total_price, printful_order_id, design_id, created_at
       FROM "order" ORDER BY created_at DESC LIMIT 3`
  );

  const out: Record<string, unknown> = { db_host: host, orders: [] };
  for (const o of orders.rows) {
    const row = o as Record<string, unknown>;
    const ledger = await client.execute({
      sql: `SELECT type, amount, description FROM ledger_entry WHERE order_id = ? ORDER BY created_at`,
      args: [row.id as string],
    });
    (out.orders as unknown[]).push({
      id: row.id,
      status: row.status,
      classification: row.classification,
      placements: row.placements,
      item_price: row.item_price,
      shipping_price: row.shipping_price,
      total_price: row.total_price,
      printful_order_id: row.printful_order_id,
      created_at: row.created_at,
      ledger: ledger.rows.map((l) => {
        const r = l as Record<string, unknown>;
        return { type: r.type, amount: r.amount, description: r.description };
      }),
    });
  }

  const json = JSON.stringify(out, null, 2);
  console.log(json);
  writeFileSync("/tmp/back-order-check.json", json);
  console.log("\nWrote /tmp/back-order-check.json");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
