import { eq } from "drizzle-orm";
import {
  order as orderTable,
  design as designTable,
} from "@/lib/db/schema";
import { TSHIRT_VARIANTS } from "@/lib/printful";
import { assertTransition } from "@/lib/order-state";
import { recordSale, recordCOGS, recordCancellation } from "@/lib/ledger";
import type { createOrder } from "@/lib/printful";
import type { db as appDb } from "@/lib/db";

// Dependency interface for testability
export type WebhookDeps = {
  db: typeof appDb;
  createPrintfulOrder: typeof createOrder;
};

// Stripe checkout.session.completed payload (after retrieval)
export type StripeSessionData = {
  id: string;
  metadata: { orderId: string; designId: string };
  paymentIntentId: string | null;
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
  const { orderId, designId } = session.metadata;

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

  // Mark as paid with shipping details
  await deps.db
    .update(orderTable)
    .set({
      status: "paid",
      stripeSessionId: session.id,
      stripePaymentIntentId: session.paymentIntentId,
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

  // Record sale + Stripe fee in ledger
  await recordSale(
    orderId,
    foundOrder.totalPrice,
    `Order ${orderId.slice(0, 8)} — ${foundOrder.color} ${foundOrder.size} ${foundOrder.quality}`,
    deps.db
  );

  // Submit to Printful
  const foundDesign = await deps.db.query.design.findFirst({
    where: eq(designTable.id, designId),
  });

  if (!foundDesign?.currentImageUrl) {
    console.error(`Order ${orderId}: design ${designId} has no image`);
    return { action: "paid" };
  }

  const variantId = TSHIRT_VARIANTS[foundOrder.color]?.[foundOrder.size];
  if (!variantId) {
    console.error(`Order ${orderId}: no variant for ${foundOrder.color} ${foundOrder.size}`);
    return { action: "paid" };
  }

  try {
    const printfulOrder = await deps.createPrintfulOrder({
      designImageUrl: foundDesign.currentImageUrl,
      size: foundOrder.size,
      color: foundOrder.color,
      variantId,
      recipientName: session.shipping?.name ?? "",
      address1: session.shipping?.address1 ?? "",
      address2: session.shipping?.address2 || undefined,
      city: session.shipping?.city ?? "",
      stateCode: session.shipping?.state ?? "",
      countryCode: session.shipping?.country ?? "US",
      zip: session.shipping?.zip ?? "",
    });

    assertTransition("paid", "submitted");

    // Extract Printful fulfillment cost
    const printfulCost = printfulOrder.costs?.total
      ? parseFloat(printfulOrder.costs.total)
      : null;

    await deps.db
      .update(orderTable)
      .set({
        status: "submitted",
        printfulOrderId: String(printfulOrder.id),
        printfulCost,
        updatedAt: new Date(),
      })
      .where(eq(orderTable.id, orderId));

    await deps.db
      .update(designTable)
      .set({ status: "ordered", updatedAt: new Date() })
      .where(eq(designTable.id, designId));

    // Record COGS in ledger
    if (printfulCost && printfulCost > 0) {
      await recordCOGS(
        orderId,
        printfulCost,
        `Printful fulfillment PF:${printfulOrder.id}`,
        deps.db
      );
    }

    return { action: "submitted" };
  } catch (err) {
    console.error(`Order ${orderId}: Printful submission failed:`, err);
    return { action: "paid_printful_failed" };
  }
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
