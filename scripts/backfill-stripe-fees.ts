/**
 * One-time script to backfill stripe_fee ledger entries for paid orders
 * that don't already have them.
 *
 * Run with: npx dotenvx run --env-file=.env.local -- npx tsx scripts/backfill-stripe-fees.ts
 */

import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { sql } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";

const STRIPE_FEE_RATE = 0.029;
const STRIPE_FEE_FIXED = 0.30;

function calculateStripeFee(amount: number): number {
  return Math.round((amount * STRIPE_FEE_RATE + STRIPE_FEE_FIXED) * 100) / 100;
}

const db = drizzle(
  createClient({
    url: process.env.DATABASE_URL!,
    authToken: process.env.DATABASE_AUTH_TOKEN,
  }),
  { schema }
);

async function main() {
  // Find paid/submitted/shipped/delivered orders without a stripe_fee ledger entry
  const orders = await db.all<{ id: string; total_price: number }>(sql`
    SELECT o.id, o.total_price
    FROM "order" o
    WHERE o.status IN ('paid', 'submitted', 'shipped', 'delivered')
      AND o.id NOT IN (
        SELECT le.order_id FROM ledger_entry le WHERE le.type = 'stripe_fee'
      )
  `);

  if (orders.length === 0) {
    console.log("No orders need stripe_fee backfill.");
    return;
  }

  console.log(`Found ${orders.length} orders missing stripe_fee entries:\n`);

  for (const o of orders) {
    const fee = calculateStripeFee(o.total_price);
    console.log(`  ${o.id.slice(0, 8)}  total=$${o.total_price.toFixed(2)}  fee=$${fee.toFixed(2)}`);

    await db.insert(schema.ledgerEntry).values({
      orderId: o.id,
      type: "stripe_fee",
      amount: -fee,
      description: "Stripe processing fee (2.9% + $0.30) — backfill",
      metadata: { rate: STRIPE_FEE_RATE, fixed: STRIPE_FEE_FIXED, backfill: true },
    });
  }

  console.log(`\nBackfilled ${orders.length} stripe_fee ledger entries.`);
}

main().catch(console.error);
