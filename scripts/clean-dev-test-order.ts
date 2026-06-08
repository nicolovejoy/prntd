/**
 * One-off dev cleanup: remove the #25 back-order smoke-test artifacts from
 * prntd-dev (the frozen snapshot DB — NOT prod). Deletes the three test orders
 * created 2026-06-08 and any ledger rows attached to them. Guards on db host so
 * it can never run against prod.
 *
 *   npx tsx --env-file .env.local scripts/clean-dev-test-order.ts
 */
import { createClient } from "@libsql/client";

const client = createClient({
  url: process.env.DATABASE_URL!,
  authToken: process.env.DATABASE_AUTH_TOKEN,
});

const ORDER_IDS = [
  "ec857fa2-4aaf-48dc-9ee6-9a40754b3154", // submitted dry-run back order (sale+fee ledger)
  "50dc7f4a-ecd6-4670-9080-5b18ee4c0c69", // abandoned pending checkout
  "cd09997c-b470-45be-923f-1e9b37951287", // abandoned pending checkout
];

async function main() {
  const host = (process.env.DATABASE_URL || "").replace(/^libsql:\/\//, "").split(".")[0];
  if (!host.startsWith("prntd-dev")) {
    throw new Error(`Refusing to run: DB host is "${host}", not prntd-dev. Aborting.`);
  }
  console.log(`DB host: ${host} (safe)\n`);

  for (const id of ORDER_IDS) {
    const led = await client.execute({
      sql: `DELETE FROM ledger_entry WHERE order_id = ?`,
      args: [id],
    });
    const ord = await client.execute({
      sql: `DELETE FROM "order" WHERE id = ?`,
      args: [id],
    });
    console.log(
      `${id}: deleted ${ord.rowsAffected} order row, ${led.rowsAffected} ledger row(s)`
    );
  }
  console.log("\nCleanup complete.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
