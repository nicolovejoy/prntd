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
 * `grossProfit` sums sale + refund + stripe_fee + cogs + refund_cogs_reversal.
 * `refund_cogs_reversal` is a COGS *correction* — booked when Printful cancels a
 * submitted order, so their cost is no longer incurred — and MUST net against
 * COGS, or a canceled-with-COGS order permanently understates profit by the full
 * COGS. A `tax` pass-through (1C — only if collection is ever turned on) is a
 * different case: a liability we remit, not revenue, so it stays OUT of profit.
 * The tests lock both: reversal in, tax out.
 */
export function summarizeLedger(byType: Record<string, number>) {
  const sales = byType["sale"] ?? 0;
  const stripeFees = byType["stripe_fee"] ?? 0;
  const cogs = byType["cogs"] ?? 0;
  const cogsReversal = byType["refund_cogs_reversal"] ?? 0;
  const refunds = byType["refund"] ?? 0;
  const netCogs = cogs + cogsReversal; // reversal (+) offsets the cogs row (−)
  const revenue = sales + refunds;
  return {
    revenue,
    stripeFees,
    cogs: Math.abs(netCogs),
    grossProfit: revenue + stripeFees + netCogs,
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

const UNIQUE_VIOLATION_TEXT = /UNIQUE constraint failed/i;

/** Deep enough for DrizzleQueryError -> LibsqlError -> SQLite, with slack. */
const MAX_CAUSE_DEPTH = 8;

/** Best-effort message for an arbitrary thrown value. */
function errorMessageOf(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { message?: unknown }).message === "string"
  ) {
    return (value as { message: string }).message;
  }
  return String(value);
}

/**
 * True when an error is SQLite/libSQL's unique-constraint rejection — the
 * signal that a concurrent or redelivered write already booked this row.
 *
 * The text can arrive at two different depths. `db.batch(...)` calls the
 * libSQL client directly, so `LibsqlBatchError.message` carries it. Every
 * NON-batch execution (a bare `db.insert(...)`) is wrapped by drizzle in a
 * `DrizzleQueryError` whose own message is only `Failed query: ...`; the
 * SQLite text lives on `.cause` (`LibsqlError`), and one level below that
 * again. So we walk the chain instead of reading one message (#209 — before
 * this, the bare-insert catch in refund-order.ts could never match).
 *
 * The walk is bounded and cycle-safe because the chain is arbitrary
 * third-party data: a driver that ever self-references would otherwise hang
 * a money path.
 */
export function isUniqueViolation(err: unknown): boolean {
  const seen = new Set<object>();
  let current: unknown = err;

  for (let depth = 0; depth <= MAX_CAUSE_DEPTH; depth++) {
    if (current === null || current === undefined) return false;
    if (UNIQUE_VIOLATION_TEXT.test(errorMessageOf(current))) return true;
    if (typeof current !== "object") return false;
    if (seen.has(current)) return false;
    seen.add(current);
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
