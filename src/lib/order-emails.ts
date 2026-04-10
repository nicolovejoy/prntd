import { eq } from "drizzle-orm";
import { order as orderTable, user as userTable } from "@/lib/db/schema";
import type { db as appDb } from "@/lib/db";
import type { sendOrderConfirmation, sendOwnerOrderAlert } from "@/lib/email";

export type OrderEmailPayload = {
  email: string;
  size: string;
  color: string;
  totalPrice: number;
  discountCode: string | null;
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
          discountCode: orderTable.discountCode,
        })
        .from(orderTable)
        .innerJoin(userTable, eq(orderTable.userId, userTable.id))
        .where(eq(orderTable.id, orderId));
      return rows[0] ?? null;
    },
    sendOrderConfirmation: senders.sendOrderConfirmation,
    sendOwnerOrderAlert: senders.sendOwnerOrderAlert,
  };
}
