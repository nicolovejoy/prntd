import { and, eq } from "drizzle-orm";
import {
  cartItem as cartItemTable,
  order as orderTable,
  orderItem as orderItemTable,
} from "@/lib/db/schema";
import { assertTransition } from "@/lib/order-state";
import { recordSale, recordCancellation } from "@/lib/ledger";
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
  // present (1B+ sessions). Falls back to what we stored at order creation
  // for pre-1B sessions that carry no shipping line.
  const itemPrice = session.amountSubtotal != null
    ? session.amountSubtotal / 100
    : foundOrder.itemPrice;
  const shippingPrice = session.amountShipping != null
    ? session.amountShipping / 100
    : foundOrder.shippingPrice;

  // Mark as paid with shipping details + discount info
  await deps.db
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
    .where(eq(orderTable.id, orderId));

  // Record sale + Stripe fee in ledger (using actual amount charged)
  await recordSale(
    orderId,
    actualTotal,
    `Order ${orderId.slice(0, 8)} — ${foundOrder.color} ${foundOrder.size}${session.discount ? ` (${session.discount.code} -$${session.discount.amount.toFixed(2)})` : ""}`,
    deps.db
  );

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
    assertTransition(foundOrder.status, "canceled");

    await deps.db
      .update(orderTable)
      .set({
        status: "canceled",
        printfulCost: 0,
        updatedAt: new Date(),
      })
      .where(eq(orderTable.id, foundOrder.id));

    // Record cancellation reversal in ledger
    await recordCancellation(
      foundOrder.id,
      foundOrder.totalPrice,
      `Order ${foundOrder.id.slice(0, 8)} canceled — Printful ${printfulOrderId}`,
      deps.db
    );

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
