import { and, eq } from "drizzle-orm";
import {
  cartItem as cartItemTable,
  ledgerEntry,
  order as orderTable,
  orderItem as orderItemTable,
} from "@/lib/db/schema";
import { assertTransition } from "@/lib/order-state";
import {
  saleLedgerRows,
  refundCogsReversalRow,
  isUniqueViolation,
} from "@/lib/ledger";
import {
  submitOrderFulfillment,
  type FulfillmentDeps,
} from "@/lib/order-fulfillment";

// The webhook deps are exactly the fulfillment deps; the alias keeps the
// established name for the route + admin call sites and their tests.
export type WebhookDeps = FulfillmentDeps;

// Stripe checkout.session.completed payload (after retrieval)
export type StripeSessionData = {
  id: string;
  metadata: { orderId: string; designId: string };
  paymentIntentId: string | null;
  amountTotal: number | null; // cents — actual amount charged after discounts
  // cents — Stripe's authoritative breakdown. amountSubtotal = product line
  // before discount; amountShipping = the separate shipping line (untouched
  // by % promos). Optional so pre-1B sessions (no shipping line) still parse.
  amountSubtotal?: number | null;
  amountShipping?: number | null;
  discount: {
    code: string;
    amount: number; // dollars — discount amount
  } | null;
  shipping: {
    name: string;
    address1: string;
    address2: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  } | null;
};

// Printful webhook payload
export type PrintfulWebhookPayload = {
  type: string;
  data: {
    order?: { id: number | string };
    shipment?: { tracking_number?: string; tracking_url?: string };
    reason?: string;
  };
};

export async function handleStripeCheckoutCompleted(
  session: StripeSessionData,
  deps: WebhookDeps
): Promise<{ action: "skipped" | "paid" | "submitted" | "paid_printful_failed" }> {
  const { orderId } = session.metadata;

  const foundOrder = await deps.db.query.order.findFirst({
    where: eq(orderTable.id, orderId),
  });

  if (!foundOrder) {
    throw new Error(`Order ${orderId} not found`);
  }

  if (foundOrder.status !== "pending") {
    return { action: "skipped" };
  }

  assertTransition(foundOrder.status, "paid");

  // If a discount was applied, update totalPrice to what was actually charged
  const actualTotal = session.amountTotal != null
    ? session.amountTotal / 100
    : foundOrder.totalPrice;

  // Reconcile the price split from Stripe's authoritative breakdown when
  // present (1B+ sessions). Shipping is its own Stripe line, untouched by %
  // promos. itemPrice is the *post-discount* product revenue = total − shipping
  // (computed in cents to avoid FP drift), NOT the pre-discount amountSubtotal:
  // a promo discounts only the product line, so amountSubtotal would leave
  // itemPrice + shippingPrice > totalPrice (finding #5). This keeps the stored
  // split internally consistent (item + shipping === total). Falls back to what
  // we stored at order creation for pre-1B sessions that carry no shipping line.
  const shippingPrice = session.amountShipping != null
    ? session.amountShipping / 100
    : foundOrder.shippingPrice;
  const itemPrice = session.amountTotal != null && session.amountShipping != null
    ? (session.amountTotal - session.amountShipping) / 100
    : foundOrder.itemPrice;

  // Atomic claim (#37): the paid-update and the sale/fee ledger rows commit
  // together, and the claim is conditional on status still being `pending` —
  // so a redelivery racing the live run (Stripe retries past its timeout while
  // the slow tail is still working) cannot double-process. The loser's batch
  // trips the ledger_entry (order_id, type) unique index and rolls back whole:
  // it neither re-marks the order nor doubles the ledger.
  try {
    const [claim] = await deps.db.batch([
      deps.db
        .update(orderTable)
        .set({
          status: "paid",
          classification: "customer",
          stripeSessionId: session.id,
          stripePaymentIntentId: session.paymentIntentId,
          totalPrice: actualTotal,
          itemPrice,
          shippingPrice,
          discountCode: session.discount?.code ?? null,
          discountAmount: session.discount?.amount ?? null,
          shippingName: session.shipping?.name ?? "",
          shippingAddress1: session.shipping?.address1 ?? "",
          shippingAddress2: session.shipping?.address2 ?? "",
          shippingCity: session.shipping?.city ?? "",
          shippingState: session.shipping?.state ?? "",
          shippingZip: session.shipping?.zip ?? "",
          shippingCountry: session.shipping?.country ?? "US",
          updatedAt: new Date(),
        })
        .where(and(eq(orderTable.id, orderId), eq(orderTable.status, "pending"))),
      deps.db.insert(ledgerEntry).values(
        saleLedgerRows(
          orderId,
          actualTotal,
          `Order ${orderId.slice(0, 8)} — ${foundOrder.color} ${foundOrder.size}${session.discount ? ` (${session.discount.code} -$${session.discount.amount.toFixed(2)})` : ""}`
        )
      ),
    ]);
    if (claim.rowsAffected === 0) return { action: "skipped" };
  } catch (err) {
    if (isUniqueViolation(err)) return { action: "skipped" };
    throw err;
  }

  // Fulfillment: one shared tail for single-item (legacy scalar) and cart
  // (order_item) orders — resolveOrderLines inside submitOrderFulfillment
  // normalizes both.
  const orderItems = await deps.db.query.orderItem.findMany({
    where: eq(orderItemTable.orderId, orderId),
  });

  // #38: the cart survives Stripe-session creation, so backing out of checkout
  // returns to an intact /cart. Payment is the point of no return — clear the
  // purchased lines here, matched per line so a single-item /order purchase
  // (no order_item rows today) or anything added to the cart mid-checkout is
  // untouched. Runs even if fulfillment fails below: the customer paid.
  //
  // Wrapped so a cart-cleanup failure never fails the webhook (finding #3b):
  // the paid-claim already committed, so a throw here would 400 → Stripe
  // redelivers → skipped (status≠pending) → fulfillment stranded until the
  // daily cron. A leftover cart row is cosmetic; log and press on to fulfill.
  try {
    for (const item of orderItems) {
      await deps.db.delete(cartItemTable).where(
        and(
          eq(cartItemTable.userId, foundOrder.userId),
          eq(cartItemTable.designId, item.designId),
          eq(cartItemTable.productId, item.productId),
          eq(cartItemTable.size, item.size),
          eq(cartItemTable.color, item.color)
        )
      );
    }
  } catch (err) {
    console.error(`Order ${orderId}: cart cleanup failed (non-fatal):`, err);
  }

  return submitOrderFulfillment(foundOrder, orderItems, session.shipping, deps);
}

export async function handlePrintfulEvent(
  payload: PrintfulWebhookPayload,
  deps: Pick<WebhookDeps, "db">
): Promise<{ action: "shipped" | "canceled" | "failed_logged" | "ignored"; orderId?: string; trackingNumber?: string | null; trackingUrl?: string | null }> {
  const printfulOrderId = String(payload.data?.order?.id ?? "");
  if (!printfulOrderId) {
    throw new Error("Missing Printful order ID in payload");
  }

  const foundOrder = await deps.db.query.order.findFirst({
    where: eq(orderTable.printfulOrderId, printfulOrderId),
  });

  if (!foundOrder) {
    throw new Error(`No order found for Printful ID ${printfulOrderId}`);
  }

  if (payload.type === "package_shipped") {
    // Redelivery (#37): Printful retries until it gets a 2xx, and repeated
    // 400s can get the webhook disabled. Already at (or past) the target
    // status → acknowledge and do nothing.
    if (foundOrder.status === "shipped" || foundOrder.status === "delivered") {
      return { action: "ignored", orderId: foundOrder.id };
    }
    assertTransition(foundOrder.status, "shipped");

    const shipment = payload.data?.shipment;
    const trackingNumber = shipment?.tracking_number ?? null;
    const trackingUrl = shipment?.tracking_url ?? null;

    await deps.db
      .update(orderTable)
      .set({
        status: "shipped",
        trackingNumber,
        trackingUrl,
        updatedAt: new Date(),
      })
      .where(eq(orderTable.id, foundOrder.id));

    return { action: "shipped", orderId: foundOrder.id, trackingNumber, trackingUrl };
  }

  if (payload.type === "order_canceled") {
    // Redelivery (#37): same 200-on-repeat contract as package_shipped, and
    // it also prevents a doubled COGS-reversal ledger row.
    if (foundOrder.status === "canceled") {
      return { action: "ignored", orderId: foundOrder.id };
    }
    assertTransition(foundOrder.status, "canceled");

    // A cancel does NOT refund the customer here — that is an admin-clicked
    // action (refundOrder), never an automatic webhook side effect, so we don't
    // book a `refund` row for money that hasn't moved. What IS a fact the
    // moment Printful cancels: their cost is reversed. If this order booked
    // COGS, offset it with a `refund_cogs_reversal` row so gross profit isn't
    // understated. Cancel-update + reversal commit together (#37).
    const cogsEntry = await deps.db.query.ledgerEntry.findFirst({
      where: and(
        eq(ledgerEntry.orderId, foundOrder.id),
        eq(ledgerEntry.type, "cogs")
      ),
    });

    const cancelUpdate = deps.db
      .update(orderTable)
      .set({ status: "canceled", printfulCost: 0, updatedAt: new Date() })
      .where(eq(orderTable.id, foundOrder.id));

    if (cogsEntry) {
      await deps.db.batch([
        cancelUpdate,
        deps.db.insert(ledgerEntry).values(
          refundCogsReversalRow(
            foundOrder.id,
            cogsEntry.amount,
            `Order ${foundOrder.id.slice(0, 8)} canceled — COGS reversed (Printful ${printfulOrderId})`
          )
        ),
      ]);
    } else {
      await cancelUpdate;
    }

    return { action: "canceled", orderId: foundOrder.id };
  }

  if (payload.type === "order_failed") {
    console.error(
      `Order ${foundOrder.id} (Printful ${printfulOrderId}) failed: ${payload.data?.reason ?? "unknown"}`
    );
    return { action: "failed_logged" };
  }

  return { action: "ignored" };
}
