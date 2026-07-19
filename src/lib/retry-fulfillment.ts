/**
 * Durability sweep core (#39). Finds paid orders whose Printful submission
 * never landed (status `paid`, no printfulOrderId) and re-runs the shared
 * fulfillment tail. Called on a schedule by /api/cron/retry-fulfillment; kept
 * as a deps-injected lib function (like handleStripeCheckoutCompleted) so it's
 * testable against the real in-memory DB without the route's auth/env.
 *
 * A paid-but-unsubmitted order stalls because the Stripe webhook returned 200
 * (so Stripe won't redeliver) after Printful was down. Guardrails:
 *   - floor: skip orders paid in the last `floorMs` (default 10 min) so the
 *     sweep never races an in-flight webhook or Stripe's own delivery retries.
 *   - ceil: skip orders older than `ceilMs` (default 24h) — a permanently
 *     unfulfillable order (missing image/variant) would be retried forever
 *     otherwise; those are left for the admin manual retry.
 *   - limit: bound per-run work to stay inside the function's maxDuration.
 * Double-submit safety (this sweep vs. a concurrent admin retry) rides on
 * #37's Printful external_id dedupe inside submitOrderFulfillment.
 */
import { and, asc, eq, gt, isNull, lt } from "drizzle-orm";
import { order as orderTable, orderItem as orderItemTable } from "@/lib/db/schema";
import {
  submitOrderFulfillment,
  type FulfillmentDeps,
  type FulfillmentResult,
} from "@/lib/order-fulfillment";

export const RETRY_FLOOR_MS = 10 * 60 * 1000;
export const RETRY_CEIL_MS = 24 * 60 * 60 * 1000;
export const RETRY_BATCH_LIMIT = 5;

export type RetryFulfillmentResult = {
  scanned: number;
  results: { orderId: string; action: FulfillmentResult["action"] | "error" }[];
};

export async function retryStuckFulfillments(
  deps: FulfillmentDeps,
  opts: { now?: number; floorMs?: number; ceilMs?: number; limit?: number } = {}
): Promise<RetryFulfillmentResult> {
  const now = opts.now ?? Date.now();
  const floor = new Date(now - (opts.floorMs ?? RETRY_FLOOR_MS));
  const ceil = new Date(now - (opts.ceilMs ?? RETRY_CEIL_MS));

  const stuck = await deps.db.query.order.findMany({
    where: and(
      eq(orderTable.status, "paid"),
      isNull(orderTable.printfulOrderId),
      lt(orderTable.updatedAt, floor),
      gt(orderTable.updatedAt, ceil)
    ),
    orderBy: asc(orderTable.createdAt),
    limit: opts.limit ?? RETRY_BATCH_LIMIT,
  });

  const results: RetryFulfillmentResult["results"] = [];
  for (const foundOrder of stuck) {
    const items = await deps.db.query.orderItem.findMany({
      where: eq(orderItemTable.orderId, foundOrder.id),
    });
    try {
      const result = await submitOrderFulfillment(
        foundOrder,
        items,
        {
          name: foundOrder.shippingName ?? "",
          address1: foundOrder.shippingAddress1 ?? "",
          address2: foundOrder.shippingAddress2 ?? "",
          city: foundOrder.shippingCity ?? "",
          state: foundOrder.shippingState ?? "",
          zip: foundOrder.shippingZip ?? "",
          country: foundOrder.shippingCountry ?? "US",
        },
        deps
      );
      console.log(`retry-fulfillment: order ${foundOrder.id} → ${result.action}`);
      results.push({ orderId: foundOrder.id, action: result.action });
    } catch (err) {
      // One order's failure shouldn't abort the sweep.
      console.error(`retry-fulfillment: order ${foundOrder.id} threw:`, err);
      results.push({ orderId: foundOrder.id, action: "error" });
    }
  }

  return { scanned: stuck.length, results };
}
