/**
 * One-time script to backfill order classification column.
 * Run with: npx dotenvx run --env-file=.env.local -- npx tsx scripts/backfill-classification.ts
 */

import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { sql, isNull } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";

const db = drizzle(
  createClient({
    url: process.env.DATABASE_URL!,
    authToken: process.env.DATABASE_AUTH_TOKEN,
  }),
  { schema }
);

async function main() {
  // Customer-tagged orders → customer
  const r1 = await db.run(
    sql`UPDATE "order" SET classification = 'customer' WHERE tags LIKE '%customer%' AND classification IS NULL`
  );
  console.log("Tagged as customer:", r1.rowsAffected);

  // Everything else → test
  const r2 = await db.run(
    sql`UPDATE "order" SET classification = 'test' WHERE classification IS NULL`
  );
  console.log("Defaulted to test:", r2.rowsAffected);

  // Verify
  const remaining = await db
    .select({ id: schema.order.id })
    .from(schema.order)
    .where(isNull(schema.order.classification));
  console.log("Unclassified remaining:", remaining.length);

  // Summary
  const all = await db.run(
    sql`SELECT classification, COUNT(*) as cnt FROM "order" GROUP BY classification`
  );
  console.log("Classification counts:", all.rows);
}

main().catch(console.error);
