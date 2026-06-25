import type { db } from "@/lib/db";
import { ledgerEntry } from "@/lib/db/schema";
import { STRIPE_FEE_RATE, STRIPE_FEE_FIXED, calculateStripeFee } from "@/lib/pricing";

// Re-export so existing `@/lib/ledger` importers (tests, webhook) keep working;
// the canonical definition now lives in the db-free pricing module.
export { calculateStripeFee };

type DbInstance = Pick<typeof db, "insert" | "query">;

/**
 * Collapse a ledger's per-type totals into the admin financial summary.
 * Pure, so it's tested without an admin session (getFinancialSummary wraps
 * it after auth + the grouped query).
 *
 * `grossProfit` sums only sale + refund + stripe_fee + cogs. A `tax`
 * pass-through (1C — only if collection is ever turned on) is a liability we
 * remit, not revenue, so it must stay OUT of profit. It's excluded by
 * omission today; the test locks that so a later refactor can't fold a new
 * type into the total by accident.
 */
export function summarizeLedger(byType: Record<string, number>) {
  const sales = byType["sale"] ?? 0;
  const stripeFees = byType["stripe_fee"] ?? 0;
  const cogs = byType["cogs"] ?? 0;
  const refunds = byType["refund"] ?? 0;
  const revenue = sales + refunds;
  return {
    revenue,
    stripeFees,
    cogs: Math.abs(cogs),
    grossProfit: revenue + stripeFees + cogs,
  };
}

export async function recordSale(
  orderId: string,
  amount: number,
  description: string,
  db: DbInstance
) {
  const stripeFee = calculateStripeFee(amount);

  await db.insert(ledgerEntry).values([
    {
      orderId,
      type: "sale",
      amount,
      description,
      metadata: { gross: amount, stripeFee },
    },
    {
      orderId,
      type: "stripe_fee",
      amount: -stripeFee,
      description: `Stripe processing fee (2.9% + $0.30)`,
      metadata: { rate: STRIPE_FEE_RATE, fixed: STRIPE_FEE_FIXED },
    },
  ]);
}

export async function recordCOGS(
  orderId: string,
  printfulCost: number,
  description: string,
  db: DbInstance
) {
  await db.insert(ledgerEntry).values({
    orderId,
    type: "cogs",
    amount: -printfulCost,
    description,
  });
}

export async function recordCancellation(
  orderId: string,
  originalAmount: number,
  description: string,
  db: DbInstance
) {
  await db.insert(ledgerEntry).values({
    orderId,
    type: "refund",
    amount: -originalAmount,
    description,
    metadata: { note: "Order canceled before fulfillment, refund pending" },
  });
}
