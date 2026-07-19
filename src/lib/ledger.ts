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

type LedgerRow = typeof ledgerEntry.$inferInsert;

/**
 * Pure row builders (#37): the values for each once-per-order ledger write,
 * returned instead of inserted so callers can compose them into a `db.batch`
 * with the status update they must be atomic with. The record* wrappers below
 * keep the standalone-insert API for callers with no batching need.
 */
export function saleLedgerRows(
  orderId: string,
  amount: number,
  description: string
): LedgerRow[] {
  const stripeFee = calculateStripeFee(amount);
  return [
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
  ];
}

export function cogsLedgerRow(
  orderId: string,
  printfulCost: number,
  description: string
): LedgerRow {
  return {
    orderId,
    type: "cogs",
    amount: -printfulCost,
    description,
  };
}

export function refundLedgerRow(
  orderId: string,
  originalAmount: number,
  description: string
): LedgerRow {
  return {
    orderId,
    type: "refund",
    amount: -originalAmount,
    description,
    metadata: { note: "Customer refund issued via Stripe" },
  };
}

/**
 * Reverse a booked COGS entry when Printful cancels an order — their cost is no
 * longer incurred. `cogsAmount` is the (negative) amount on the `cogs` row being
 * reversed; negating it yields the positive offset. This is a fact independent
 * of whether the customer is refunded (that's the admin-clicked `refund` row).
 */
export function refundCogsReversalRow(
  orderId: string,
  cogsAmount: number,
  description: string
): LedgerRow {
  return {
    orderId,
    type: "refund_cogs_reversal",
    amount: -cogsAmount,
    description,
  };
}

export async function recordSale(
  orderId: string,
  amount: number,
  description: string,
  db: DbInstance
) {
  await db.insert(ledgerEntry).values(saleLedgerRows(orderId, amount, description));
}

export async function recordCOGS(
  orderId: string,
  printfulCost: number,
  description: string,
  db: DbInstance
) {
  await db.insert(ledgerEntry).values(cogsLedgerRow(orderId, printfulCost, description));
}

export async function recordCancellation(
  orderId: string,
  originalAmount: number,
  description: string,
  db: DbInstance
) {
  await db.insert(ledgerEntry).values(refundLedgerRow(orderId, originalAmount, description));
}

/**
 * True when an error is SQLite/libSQL's unique-constraint rejection — the
 * signal that a concurrent or redelivered webhook already wrote this order's
 * ledger rows (the whole batch rolled back; nothing was applied).
 */
export function isUniqueViolation(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /UNIQUE constraint failed/i.test(message);
}
