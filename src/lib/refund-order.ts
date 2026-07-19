/**
 * Admin-clicked customer refund (money-safety WP1, finding #1). A Printful
 * cancel does NOT refund the customer automatically — the cancel webhook only
 * reverses COGS. Refunding real money is a deliberate admin action, so it lives
 * here as a deps-injected core (Stripe + revalidate wrapped by the server
 * action in admin/actions.ts) and is tested against the real in-memory DB.
 *
 * Idempotent: a booked `refund` ledger row is the "already refunded" flag —
 * checked up front so a second click is a no-op, never a second Stripe refund.
 * The Stripe call is also idempotency-keyed on the order id as a backstop for a
 * concurrent double-click, and the ledger insert relies on the
 * ledger_entry(order_id, type) unique index.
 */
import { and, eq } from "drizzle-orm";
import { order as orderTable, ledgerEntry } from "@/lib/db/schema";
import { refundLedgerRow, isUniqueViolation } from "@/lib/ledger";
import type { db as appDb } from "@/lib/db";

export type RefundOrderDeps = {
  db: typeof appDb;
  /** Resolve the checkout session id to its payment_intent id (null if none). */
  retrievePaymentIntentId: (stripeSessionId: string) => Promise<string | null>;
  /** Issue the Stripe refund. `idempotencyKey` guards a concurrent double-click. */
  createRefund: (paymentIntentId: string, idempotencyKey: string) => Promise<void>;
};

export type RefundOrderResult =
  // refunded=false → nothing to do (already refunded); true → a refund was issued.
  | { ok: true; refunded: boolean }
  | { ok: false; reason: string };

/**
 * Stripe raises StripeInvalidRequestError with code `charge_already_refunded`
 * when the underlying charge is already fully refunded. That is the benign
 * crash-replay case: a prior click's refunds.create succeeded but the process
 * died before booking the ledger row, and the stable idempotency key has since
 * aged past Stripe's TTL (so the replay is treated as fresh and rejected).
 * Treating it as success lets us book the missing ledger row instead of
 * throwing forever.
 */
export function isChargeAlreadyRefunded(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "charge_already_refunded"
  );
}

export async function refundOrderCore(
  orderId: string,
  deps: RefundOrderDeps
): Promise<RefundOrderResult> {
  const found = await deps.db.query.order.findFirst({
    where: eq(orderTable.id, orderId),
  });
  if (!found) return { ok: false, reason: "Order not found" };

  // Already refunded? The ledger row is the source of truth — a second click
  // must not issue a second Stripe refund.
  const existing = await deps.db.query.ledgerEntry.findFirst({
    where: and(eq(ledgerEntry.orderId, orderId), eq(ledgerEntry.type, "refund")),
  });
  if (existing) return { ok: true, refunded: false };

  if (found.status !== "canceled") {
    return { ok: false, reason: "Only canceled orders can be refunded" };
  }
  if (found.totalPrice <= 0) {
    return { ok: false, reason: "Nothing to refund (order total is $0)" };
  }
  if (!found.stripeSessionId) {
    return { ok: false, reason: "No Stripe session on this order" };
  }

  const paymentIntentId = await deps.retrievePaymentIntentId(found.stripeSessionId);
  if (!paymentIntentId) {
    return { ok: false, reason: "No payment intent on the Stripe session" };
  }

  try {
    await deps.createRefund(paymentIntentId, `refund-${orderId}`);
  } catch (err) {
    if (!isChargeAlreadyRefunded(err)) throw err;
    // Refund already happened at Stripe (crash after refund, before ledger,
    // past the idempotency-key TTL). Fall through to book the missing row.
    console.warn(
      `Order ${orderId}: Stripe reports the charge is already refunded — booking the ledger row for the prior refund`
    );
  }

  try {
    await deps.db.insert(ledgerEntry).values(
      refundLedgerRow(
        orderId,
        found.totalPrice,
        `Order ${orderId.slice(0, 8)} refunded via Stripe`
      )
    );
  } catch (err) {
    // A concurrent click booked the row first; the Stripe refund is
    // idempotency-keyed so no double refund happened. Treat as a no-op success.
    if (isUniqueViolation(err)) return { ok: true, refunded: false };
    throw err;
  }

  return { ok: true, refunded: true };
}
