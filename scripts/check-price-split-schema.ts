/**
 * Read-only check: does the target DB (whatever DATABASE_URL points at)
 * have the three nullable price-split columns Phase 1B/1C needs?
 *   - order.item_price
 *   - order.shipping_price
 *   - order.tax_collected
 *
 * Prints column presence only — no writes, no secrets.
 *
 *   npx tsx --env-file .env.local scripts/check-price-split-schema.ts
 */
import { createClient } from "@libsql/client";

const client = createClient({
  url: process.env.DATABASE_URL!,
  authToken: process.env.DATABASE_AUTH_TOKEN,
});

async function hasColumn(table: string, column: string): Promise<boolean> {
  const res = await client.execute(`PRAGMA table_info("${table}")`);
  return res.rows.some((r) => (r as Record<string, unknown>).name === column);
}

async function main() {
  const checks: Array<[string, string]> = [
    ["order", "item_price"],
    ["order", "shipping_price"],
    ["order", "tax_collected"],
  ];
  let allPresent = true;
  for (const [table, column] of checks) {
    const present = await hasColumn(table, column);
    if (!present) allPresent = false;
    console.log(`${present ? "✅" : "❌ MISSING"}  ${table}.${column}`);
  }
  // Show which host we hit (no token), so we know it's prod not local.
  const host = (process.env.DATABASE_URL || "").replace(/^libsql:\/\//, "").split("?")[0];
  console.log(`\nDB: ${host}`);
  console.log(allPresent ? "\nSchema OK — safe to deploy." : "\n⚠️  Run db:push before deploying.");
  process.exit(allPresent ? 0 : 1);
}

main();
