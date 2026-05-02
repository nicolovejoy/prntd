import { eq } from "drizzle-orm";
import { order as orderTable, user as userTable } from "@/lib/db/schema";
import type { db as appDb } from "@/lib/db";
import type { sendOrderConfirmation, sendOwnerOrderAlert } from "@/lib/email";
import { getProduct } from "@/lib/products";

export type OrderEmailPayload = {
  email: string;
  size: string;
  color: string;
  totalPrice: number;
  productId: string;
  productName: string;
  discountCode: string | null;
  displayName: string | null;
};

export type OrderEmailDeps = {
  loadOrderForEmail: (orderId: string) => Promise<OrderEmailPayload | null>;
  sendOrderConfirmation: typeof sendOrderConfirmation;
  sendOwnerOrderAlert: typeof sendOwnerOrderAlert;
};

/**
 * Send post-order emails (customer confirmation + owner alert) for a freshly
 * paid order. Fire-and-forget: errors are logged but never thrown so callers
 * (webhook handler, recover action) don't fail the request because Resend hiccupped.
 */
export async function sendPostOrderEmails(
  orderId: string,
  deps: OrderEmailDeps
): Promise<void> {
  let payload: OrderEmailPayload | null;
  try {
    payload = await deps.loadOrderForEmail(orderId);
  } catch (err) {
    console.error(`sendPostOrderEmails: lookup failed for order ${orderId}:`, err);
    return;
  }

  if (!payload) {
    console.warn(`sendPostOrderEmails: order ${orderId} not found, skipping`);
    return;
  }

  try {
    await deps.sendOrderConfirmation({
      to: payload.email,
      orderId,
      size: payload.size,
      color: payload.color,
      total: payload.totalPrice,
      productName: payload.productName,
      displayName: payload.displayName,
    });
    console.log(`Order ${orderId}: confirmation email sent to ${payload.email}`);
  } catch (err) {
    console.error(`sendPostOrderEmails: confirmation failed for ${orderId}:`, err);
  }

  try {
    await deps.sendOwnerOrderAlert({
      orderId,
      customerEmail: payload.email,
      size: payload.size,
      color: payload.color,
      total: payload.totalPrice,
      discountCode: payload.discountCode,
      displayName: payload.displayName,
    });
  } catch (err) {
    console.error(`sendPostOrderEmails: owner alert failed for ${orderId}:`, err);
  }
}

/**
 * Default loader that reads the order joined with the user from the production DB.
 * Used by both the Stripe webhook route and the admin recover action.
 *
 * Email senders are passed in by the caller (not imported here) so this module
 * stays test-friendly — importing @/lib/email instantiates Resend at module load.
 */
export function createDefaultOrderEmailDeps(
  db: typeof appDb,
  senders: Pick<OrderEmailDeps, "sendOrderConfirmation" | "sendOwnerOrderAlert">
): OrderEmailDeps {
  return {
    loadOrderForEmail: async (orderId) => {
      const rows = await db
        .select({
          email: userTable.email,
          size: orderTable.size,
          color: orderTable.color,
          totalPrice: orderTable.totalPrice,
          productId: orderTable.productId,
          discountCode: orderTable.discountCode,
          displayName: orderTable.displayName,
        })
        .from(orderTable)
        .innerJoin(userTable, eq(orderTable.userId, userTable.id))
        .where(eq(orderTable.id, orderId));
      const row = rows[0];
      if (!row) return null;
      // Resolve product name from the catalog. Falls back to a generic
      // "product" label if a historical order references an id we no
      // longer carry — emails should never break on a missing product.
      const product = getProduct(row.productId);
      return {
        ...row,
        productName: product?.name ?? "product",
      };
    },
    sendOrderConfirmation: senders.sendOrderConfirmation,
    sendOwnerOrderAlert: senders.sendOwnerOrderAlert,
  };
}
