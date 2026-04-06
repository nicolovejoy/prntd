/**
 * Backfill complete ledger entries (sale, stripe_fee, cogs) for all paid orders.
 * Uses actual Stripe fees from Balance Transactions instead of estimates.
 *
 * Run with:
 *   npx @dotenvx/dotenvx run --env-file=.env.local -- npx tsx scripts/backfill-ledger.ts
 *
 * Dry run (no writes):
 *   npx @dotenvx/dotenvx run --env-file=.env.local -- npx tsx scripts/backfill-ledger.ts --dry-run
 */

import Stripe from "stripe";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { sql } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";

const dryRun = process.argv.includes("--dry-run");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

const db = drizzle(
  createClient({
    url: process.env.DATABASE_URL!,
    authToken: process.env.DATABASE_AUTH_TOKEN,
  }),
  { schema }
);

type OrderRow = {
  id: string;
  total_price: number;
  printful_cost: number | null;
  stripe_payment_intent_id: string | null;
  stripe_session_id: string | null;
};

async function getActualStripeFee(order: OrderRow): Promise<{
  fee: number;
  net: number;
  gross: number;
  balanceTransactionId: string | null;
} | null> {
  const piId = order.stripe_payment_intent_id;
  if (!piId) {
    console.warn(`  ⚠ ${order.id.slice(0, 8)}: no payment intent ID, skipping Stripe lookup`);
    return null;
  }

  try {
    const pi = await stripe.paymentIntents.retrieve(piId, {
      expand: ["latest_charge.balance_transaction"],
    });

    const charge = pi.latest_charge;
    if (!charge || typeof charge === "string") {
      console.warn(`  ⚠ ${order.id.slice(0, 8)}: no expanded charge on payment intent`);
      return null;
    }

    const bt = charge.balance_transaction;
    if (!bt || typeof bt === "string") {
      console.warn(`  ⚠ ${order.id.slice(0, 8)}: no expanded balance transaction`);
      return null;
    }

    return {
      fee: bt.fee / 100, // cents → dollars
      net: bt.net / 100,
      gross: bt.amount / 100,
      balanceTransactionId: bt.id,
    };
  } catch (err) {
    console.error(`  ✗ ${order.id.slice(0, 8)}: Stripe API error:`, (err as Error).message);
    return null;
  }
}

async function main() {
  console.log(dryRun ? "=== DRY RUN (no writes) ===\n" : "");

  // Find paid orders and what ledger types they already have
  const orders = await db.all<OrderRow>(sql`
    SELECT o.id, o.total_price, o.printful_cost,
           o.stripe_payment_intent_id, o.stripe_session_id
    FROM "order" o
    WHERE o.status IN ('paid', 'submitted', 'shipped', 'delivered')
  `);

  if (orders.length === 0) {
    console.log("No paid orders found.");
    return;
  }

  // Get existing ledger entries to avoid duplicates
  const existingEntries = await db.all<{ order_id: string; type: string }>(sql`
    SELECT order_id, type FROM ledger_entry
    WHERE order_id IS NOT NULL
  `);

  const existingTypes = new Map<string, Set<string>>();
  for (const e of existingEntries) {
    if (!existingTypes.has(e.order_id)) existingTypes.set(e.order_id, new Set());
    existingTypes.get(e.order_id)!.add(e.type);
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const order of orders) {
    const types = existingTypes.get(order.id) ?? new Set();
    const entries: schema.ledgerEntry[] = [];
    const label = order.id.slice(0, 8);

    // --- Sale entry ---
    if (!types.has("sale")) {
      entries.push({
        orderId: order.id,
        type: "sale",
        amount: order.total_price,
        description: "Order payment — backfill",
        metadata: { backfill: true },
      } as any);
      console.log(`  ${label}  + sale         $${order.total_price.toFixed(2)}`);
    }

    // --- Stripe fee entry (use actual from Stripe API) ---
    const stripeData = await getActualStripeFee(order);

    if (!types.has("stripe_fee")) {
      if (stripeData) {
        entries.push({
          orderId: order.id,
          type: "stripe_fee",
          amount: -stripeData.fee,
          description: "Stripe processing fee (actual) — backfill",
          metadata: {
            backfill: true,
            balanceTransactionId: stripeData.balanceTransactionId,
            gross: stripeData.gross,
            net: stripeData.net,
            actualFee: stripeData.fee,
          },
        } as any);
        console.log(`  ${label}  + stripe_fee  -$${stripeData.fee.toFixed(2)} (actual)`);
      } else {
        // Fallback to estimate if Stripe lookup failed
        const estimated = Math.round((order.total_price * 0.029 + 0.30) * 100) / 100;
        entries.push({
          orderId: order.id,
          type: "stripe_fee",
          amount: -estimated,
          description: "Stripe processing fee (estimated 2.9% + $0.30) — backfill",
          metadata: { backfill: true, estimated: true },
        } as any);
        console.log(`  ${label}  + stripe_fee  -$${estimated.toFixed(2)} (estimated)`);
      }
    } else if (stripeData && types.has("stripe_fee")) {
      // Update existing estimated fee with actual
      const currentFee = await db.all<{ id: string; amount: number; metadata: string }>(sql`
        SELECT id, amount, metadata FROM ledger_entry
        WHERE order_id = ${order.id} AND type = 'stripe_fee'
        LIMIT 1
      `);
      if (currentFee.length > 0) {
        const current = currentFee[0];
        const currentAmount = Math.abs(current.amount);
        if (Math.abs(currentAmount - stripeData.fee) > 0.001) {
          if (!dryRun) {
            await db.run(sql`
              UPDATE ledger_entry
              SET amount = ${-stripeData.fee},
                  description = 'Stripe processing fee (actual) — corrected',
                  metadata = ${JSON.stringify({
                    backfill: true,
                    balanceTransactionId: stripeData.balanceTransactionId,
                    correctedFrom: currentAmount,
                    actualFee: stripeData.fee,
                  })}
              WHERE id = ${current.id}
            `);
          }
          console.log(`  ${label}  ~ stripe_fee  -$${currentAmount.toFixed(2)} → -$${stripeData.fee.toFixed(2)} (corrected)`);
          updated++;
        }
      }
    }

    // --- COGS entry ---
    if (!types.has("cogs") && order.printful_cost != null) {
      entries.push({
        orderId: order.id,
        type: "cogs",
        amount: -order.printful_cost,
        description: "Printful fulfillment cost — backfill",
        metadata: { backfill: true },
      } as any);
      console.log(`  ${label}  + cogs        -$${order.printful_cost.toFixed(2)}`);
    }

    if (entries.length === 0) {
      skipped++;
      continue;
    }

    if (!dryRun) {
      await db.insert(schema.ledgerEntry).values(entries as any);
    }
    created += entries.length;
  }

  console.log(`\n${dryRun ? "[DRY RUN] Would have" : "Done:"}`);
  console.log(`  Created: ${created} ledger entries`);
  console.log(`  Updated: ${updated} stripe fees (estimated → actual)`);
  console.log(`  Skipped: ${skipped} orders (already complete)`);
}

main().catch(console.error);
