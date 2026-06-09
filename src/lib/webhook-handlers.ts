import { eq } from "drizzle-orm";
import {
  order as orderTable,
  design as designTable,
  orderItem as orderItemTable,
} from "@/lib/db/schema";
import { getProductOrThrow, getVariantId } from "@/lib/products";
import { assertTransition } from "@/lib/order-state";
import { recordSale, recordCOGS, recordCancellation } from "@/lib/ledger";
import type { createOrder } from "@/lib/printful";
import type { db as appDb } from "@/lib/db";
import type { generateOrderName } from "@/lib/ai";

// Dependency interface for testability
export type WebhookDeps = {
  db: typeof appDb;
  createPrintfulOrder: typeof createOrder;
  generateOrderName: typeof generateOrderName;
  resolveDesignImageUrl: (designId: string) => Promise<string | null>;
  // Resolve a specific design_image id to its URL. Used to print the
  // exact image pinned on the order (`placements.front`) rather than the
  // design's current display image — which matters when the order was
  // placed against a published image owned by someone else, or when the
  // design was regenerated after purchase. Optional: when absent, the
  // handler falls back to `resolveDesignImageUrl(designId)`.
  resolveImageUrlById?: (imageId: string) => Promise<string | null>;
};

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

  // Multi-item (cart, #26) orders fulfill from order_item rows. Single-item
  // orders (design-your-own, buy-existing) keep the legacy placements path
  // below. The sale + price reconciliation above already ran for both.
  const orderItems = await deps.db.query.orderItem.findMany({
    where: eq(orderItemTable.orderId, orderId),
  });
  if (orderItems.length > 0) {
    return submitCartOrder(foundOrder, orderItems, session, deps);
  }

  // Resolve one print file per placement on the order. Front prefers the
  // image pinned on the order (placements.front) so we print exactly what the
  // customer bought — including a published image owned by another designer —
  // and stay immune to post-purchase regeneration; it falls back to the
  // design's current display image for orders with no pin. Non-front
  // placements (back, #25) resolve only via their pinned image id; a missing
  // one is logged and dropped, never fatal (we still submit the front).
  const placements = foundOrder.placements ?? {};
  const frontImageId = placements.front ?? null;
  const frontUrl =
    (frontImageId && deps.resolveImageUrlById
      ? await deps.resolveImageUrlById(frontImageId)
      : null) ?? (await deps.resolveDesignImageUrl(designId));

  if (!frontUrl) {
    console.error(`Order ${orderId}: design ${designId} has no image`);
    return { action: "paid" };
  }

  const files: { placement: string; url: string }[] = [
    { placement: "front", url: frontUrl },
  ];
  for (const [placement, imageId] of Object.entries(placements)) {
    if (placement === "front") continue;
    const url = deps.resolveImageUrlById
      ? await deps.resolveImageUrlById(imageId)
      : null;
    if (url) {
      files.push({ placement, url });
    } else {
      console.error(
        `Order ${orderId}: placement "${placement}" image ${imageId} unresolved — submitting without it`
      );
    }
  }

  const displayName = await deps.generateOrderName(frontUrl);
  if (displayName) {
    await deps.db
      .update(orderTable)
      .set({ displayName, updatedAt: new Date() })
      .where(eq(orderTable.id, orderId));
  }

  const product = getProductOrThrow(foundOrder.productId ?? "bella-canvas-3001");
  const variantId = getVariantId(product, foundOrder.color, foundOrder.size);
  if (!variantId) {
    console.error(`Order ${orderId}: no variant for ${foundOrder.color} ${foundOrder.size} on ${product.name}`);
    return { action: "paid" };
  }

  try {
    const printfulOrder = await deps.createPrintfulOrder({
      files,
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

/**
 * Fulfill a multi-item cart order (#26 B4): resolve files + variant per
 * order_item, submit one N-item Printful order, record order-level COGS, and
 * mark every design in the order as ordered. Best-effort per item — an item
 * with no resolvable front image or variant is logged and dropped rather than
 * failing the whole order (the customer already paid).
 */
async function submitCartOrder(
  foundOrder: { id: string; totalPrice: number; status: string },
  orderItems: Array<{
    designId: string;
    productId: string;
    size: string;
    color: string;
    quantity: number;
    placements: Record<string, string> | null;
  }>,
  session: StripeSessionData,
  deps: WebhookDeps
): Promise<{ action: "skipped" | "paid" | "submitted" | "paid_printful_failed" }> {
  const orderId = foundOrder.id;
  const items: {
    variantId: number;
    quantity: number;
    files: { placement: string; url: string }[];
  }[] = [];
  let firstFrontUrl: string | null = null;

  for (const item of orderItems) {
    const placements = item.placements ?? {};
    const frontImageId = placements.front ?? null;
    const frontUrl =
      (frontImageId && deps.resolveImageUrlById
        ? await deps.resolveImageUrlById(frontImageId)
        : null) ?? (await deps.resolveDesignImageUrl(item.designId));
    if (!frontUrl) {
      console.error(
        `Order ${orderId}: cart item (design ${item.designId}) has no front image — dropping`
      );
      continue;
    }
    firstFrontUrl ??= frontUrl;

    const files: { placement: string; url: string }[] = [
      { placement: "front", url: frontUrl },
    ];
    for (const [placement, imageId] of Object.entries(placements)) {
      if (placement === "front") continue;
      const url = deps.resolveImageUrlById
        ? await deps.resolveImageUrlById(imageId)
        : null;
      if (url) files.push({ placement, url });
      else
        console.error(
          `Order ${orderId}: cart item placement "${placement}" image ${imageId} unresolved — submitting without it`
        );
    }

    const product = getProductOrThrow(item.productId);
    const variantId = getVariantId(product, item.color, item.size);
    if (!variantId) {
      console.error(
        `Order ${orderId}: no variant for ${item.color} ${item.size} on ${product.name} — dropping item`
      );
      continue;
    }
    items.push({ variantId, quantity: item.quantity, files });
  }

  if (items.length === 0) {
    console.error(`Order ${orderId}: no fulfillable cart items`);
    return { action: "paid" };
  }

  if (firstFrontUrl) {
    const displayName = await deps.generateOrderName(firstFrontUrl);
    if (displayName) {
      await deps.db
        .update(orderTable)
        .set({ displayName, updatedAt: new Date() })
        .where(eq(orderTable.id, orderId));
    }
  }

  try {
    const printfulOrder = await deps.createPrintfulOrder({
      items,
      recipientName: session.shipping?.name ?? "",
      address1: session.shipping?.address1 ?? "",
      address2: session.shipping?.address2 || undefined,
      city: session.shipping?.city ?? "",
      stateCode: session.shipping?.state ?? "",
      countryCode: session.shipping?.country ?? "US",
      zip: session.shipping?.zip ?? "",
    });

    assertTransition("paid", "submitted");

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

    // Mark every distinct design in the order as ordered.
    const designIds = [...new Set(orderItems.map((i) => i.designId))];
    for (const designId of designIds) {
      await deps.db
        .update(designTable)
        .set({ status: "ordered", updatedAt: new Date() })
        .where(eq(designTable.id, designId));
    }

    if (printfulCost && printfulCost > 0) {
      await recordCOGS(
        orderId,
        printfulCost,
        `Printful fulfillment PF:${printfulOrder.id} (${items.length} items)`,
        deps.db
      );
    }

    return { action: "submitted" };
  } catch (err) {
    console.error(`Order ${orderId}: Printful cart submission failed:`, err);
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
