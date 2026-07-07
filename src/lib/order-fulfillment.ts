/**
 * Shared fulfillment tail for a paid order — the one code path that submits to
 * Printful. Resolves print files per line (order_item rows when present, else
 * the legacy scalar columns, via resolveOrderLines), submits a single N-item
 * Printful order, marks the order submitted + its designs ordered, and records
 * COGS. Used by the Stripe webhook on fresh payment and by the admin retry, so
 * the retry can't drift from the webhook (multi-item, pinned placements, COGS).
 *
 * Per-line problems (missing image, unknown blank, no variant) drop that line
 * rather than failing the order — the customer already paid. An order with no
 * fulfillable lines stays `paid` for admin follow-up.
 */
import { eq } from "drizzle-orm";
import {
  order as orderTable,
  design as designTable,
  ledgerEntry,
} from "@/lib/db/schema";
import { resolveOrderLines, type OrderItemRow } from "@/lib/order-lines";
import { getBlank, getVariantId } from "@/lib/blanks";
import { assertTransition } from "@/lib/order-state";
import { cogsLedgerRow } from "@/lib/ledger";
import { withTimeout } from "@/lib/timeout";
import type { createOrder, PrintfulOrderItem } from "@/lib/printful";
import type { db as appDb } from "@/lib/db";
import type { generateOrderName } from "@/lib/ai";

// Cap on the post-submission order-naming Anthropic call. Long enough for a
// normal vision response, short enough that a hung call can't push the webhook
// response past Stripe's ~10s delivery timeout (the order is already submitted
// to Printful by the time this runs).
const ORDER_NAME_TIMEOUT_MS = 8_000;

export type FulfillmentDeps = {
  db: typeof appDb;
  createPrintfulOrder: typeof createOrder;
  generateOrderName: typeof generateOrderName;
  resolveDesignImageUrl: (designId: string) => Promise<string | null>;
  // Resolve a specific design_image id to its URL. Used to print the exact
  // image pinned on the order (`placements.front`) rather than the design's
  // current display image — which matters when the order was placed against a
  // published image owned by someone else, or when the design was regenerated
  // after purchase. Optional: when absent, lines fall back to
  // `resolveDesignImageUrl(designId)`.
  resolveImageUrlById?: (imageId: string) => Promise<string | null>;
};

export type ShippingAddress = {
  name: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
};

/** The order-row fields fulfillment needs (a subset of the full row). */
export type FulfillmentOrder = {
  id: string;
  designId: string;
  productId: string;
  size: string;
  color: string;
  placements: Record<string, string> | null;
  itemPrice: number | null;
  printfulCost: number | null;
  displayName: string | null;
};

export type FulfillmentResult =
  | { action: "paid" }
  | { action: "submitted"; printfulOrderId: string }
  | { action: "paid_printful_failed" };

export async function submitOrderFulfillment(
  order: FulfillmentOrder,
  orderItems: OrderItemRow[],
  shipping: ShippingAddress | null,
  deps: FulfillmentDeps
): Promise<FulfillmentResult> {
  const orderId = order.id;
  const lines = resolveOrderLines(
    {
      designId: order.designId,
      productId: order.productId,
      size: order.size,
      color: order.color,
      placements: order.placements,
      itemPrice: order.itemPrice,
      printfulCost: order.printfulCost,
    },
    orderItems
  );

  // One Printful line item per fulfillable line. Front prefers the image
  // pinned on the line (placements.front) and falls back to the design's
  // current display image; non-front placements resolve only via their pinned
  // image id — a missing one is logged and dropped, never fatal.
  const items: PrintfulOrderItem[] = [];
  let firstFrontUrl: string | null = null;
  for (const line of lines) {
    const frontImageId = line.placements.front ?? null;
    const frontUrl =
      (frontImageId && deps.resolveImageUrlById
        ? await deps.resolveImageUrlById(frontImageId)
        : null) ?? (await deps.resolveDesignImageUrl(line.designId));
    if (!frontUrl) {
      console.error(
        `Order ${orderId}: line (design ${line.designId}) has no front image — dropping`
      );
      continue;
    }
    firstFrontUrl ??= frontUrl;

    const files: { placement: string; url: string }[] = [
      { placement: "front", url: frontUrl },
    ];
    for (const [placement, imageId] of Object.entries(line.placements)) {
      if (placement === "front") continue;
      const url = deps.resolveImageUrlById
        ? await deps.resolveImageUrlById(imageId)
        : null;
      if (url) files.push({ placement, url });
      else
        console.error(
          `Order ${orderId}: placement "${placement}" image ${imageId} unresolved — submitting without it`
        );
    }

    const product = getBlank(line.blankId);
    const variantId = product
      ? getVariantId(product, line.color, line.size)
      : null;
    if (!variantId) {
      console.error(
        `Order ${orderId}: no variant for ${line.color} ${line.size} on ${product?.name ?? line.blankId} — dropping line`
      );
      continue;
    }
    items.push({ variantId, quantity: line.quantity, files });
  }

  if (items.length === 0) {
    console.error(`Order ${orderId}: no fulfillable lines`);
    return { action: "paid" };
  }

  try {
    const printfulOrder = await deps.createPrintfulOrder({
      items,
      // Our order id as Printful's external reference (#37): makes the
      // Printful order traceable to ours, and a duplicate submission of the
      // same order gets rejected by Printful instead of printing twice.
      externalId: orderId,
      recipientName: shipping?.name ?? "",
      address1: shipping?.address1 ?? "",
      address2: shipping?.address2 || undefined,
      city: shipping?.city ?? "",
      stateCode: shipping?.state ?? "",
      countryCode: shipping?.country ?? "US",
      zip: shipping?.zip ?? "",
    });

    assertTransition("paid", "submitted");

    const printfulCost = printfulOrder.costs?.total
      ? parseFloat(printfulOrder.costs.total)
      : null;

    // Submitted-update, design flips, and the COGS row commit together (#37):
    // a crash mid-tail can't leave a submitted order with no COGS on the
    // books (the gap the admin-retry bug hid until PR #42).
    const designIds = [...new Set(lines.map((l) => l.designId))];
    const submittedUpdate = deps.db
      .update(orderTable)
      .set({
        status: "submitted",
        printfulOrderId: String(printfulOrder.id),
        printfulCost,
        updatedAt: new Date(),
      })
      .where(eq(orderTable.id, orderId));
    const designUpdates = designIds.map((designId) =>
      deps.db
        .update(designTable)
        .set({ status: "ordered", updatedAt: new Date() })
        .where(eq(designTable.id, designId))
    );
    if (printfulCost && printfulCost > 0) {
      await deps.db.batch([
        submittedUpdate,
        ...designUpdates,
        deps.db.insert(ledgerEntry).values(
          cogsLedgerRow(
            orderId,
            printfulCost,
            `Printful fulfillment PF:${printfulOrder.id}${items.length > 1 ? ` (${items.length} items)` : ""}`
          )
        ),
      ]);
    } else {
      await deps.db.batch([submittedUpdate, ...designUpdates]);
    }

    // Name the order AFTER Printful submission — the shirt never waits on the
    // LLM (#39). Bounded so a hung Anthropic call can't stall the webhook
    // response past Stripe's timeout. Skipped when already named (admin retry).
    // displayName is written before returning so the confirmation email, sent
    // by the caller after this resolves, still carries the name. Fails soft.
    if (firstFrontUrl && !order.displayName) {
      try {
        const displayName = await withTimeout(
          "generateOrderName",
          ORDER_NAME_TIMEOUT_MS,
          () => deps.generateOrderName(firstFrontUrl!)
        );
        if (displayName) {
          await deps.db
            .update(orderTable)
            .set({ displayName, updatedAt: new Date() })
            .where(eq(orderTable.id, orderId));
        }
      } catch (err) {
        console.error(`Order ${orderId}: order naming failed (non-fatal):`, err);
      }
    }

    return { action: "submitted", printfulOrderId: String(printfulOrder.id) };
  } catch (err) {
    console.error(`Order ${orderId}: Printful submission failed:`, err);
    return { action: "paid_printful_failed" };
  }
}
