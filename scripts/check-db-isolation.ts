/**
 * Read-only: which DB does .env.local actually point at?
 * Prints the host (non-secret) + a couple row counts to confirm connectivity.
 * Used to verify #27 dev-DB isolation. No writes, no secrets printed.
 *
 *   npx tsx scripts/check-db-isolation.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@libsql/client";

const client = createClient({
  url: process.env.DATABASE_URL!,
  authToken: process.env.DATABASE_AUTH_TOKEN,
});

async function main() {
  const host = (process.env.DATABASE_URL || "")
    .replace(/^libsql:\/\//, "")
    .split("?")[0];
  const designs = await client.execute(`select count(*) as c from design`);
  const orders = await client.execute(`select count(*) as c from "order"`);
  console.log(`DB host : ${host}`);
  console.log(`designs : ${designs.rows[0].c}`);
  console.log(`orders  : ${orders.rows[0].c}`);
  const isDev = host.startsWith("prntd-dev-");
  console.log(
    isDev
      ? "\n✅ Pointed at the DEV branch — local work is isolated from prod."
      : "\n⚠️  NOT the dev branch — still pointed at prod (or unknown)."
  );
  process.exit(isDev ? 0 : 1);
}

main();
