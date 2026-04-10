import type { StripeSessionData } from "@/lib/webhook-handlers";

type LoadedOrder = {
  id: string;
  status: string;
  stripeSessionId: string | null;
};

type FetchedSession = {
  paymentStatus: string; // Stripe's session.payment_status: "paid" | "unpaid" | "no_payment_required"
  sessionData: StripeSessionData;
};

type HandlerResult = {
  action: "skipped" | "paid" | "submitted" | "paid_printful_failed";
};

export type RecoverDeps = {
  loadOrder: (orderId: string) => Promise<LoadedOrder | null>;
  fetchSessionData: (stripeSessionId: string) => Promise<FetchedSession>;
  runCheckoutHandler: (session: StripeSessionData) => Promise<HandlerResult>;
  sendEmails: (orderId: string) => Promise<void>;
};

/**
 * Replays the Stripe checkout flow for an order stuck at `pending` (typically
 * because the live webhook crashed before reaching the handler). Idempotent:
 * if the order is no longer pending, throws so the caller doesn't double-process.
 *
 * The function is dependency-injected so it can be tested without touching DB,
 * Stripe, or Resend. The admin server action wires the real implementations.
 */
export async function recoverPendingOrderCore(
  orderId: string,
  deps: RecoverDeps
): Promise<HandlerResult> {
  const order = await deps.loadOrder(orderId);
  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  if (order.status !== "pending") {
    throw new Error(
      `Order ${orderId} is not pending (status: ${order.status}) — nothing to recover`
    );
  }

  if (!order.stripeSessionId) {
    throw new Error(`Order ${orderId} has no Stripe session ID — cannot recover`);
  }

  const { paymentStatus, sessionData } = await deps.fetchSessionData(
    order.stripeSessionId
  );

  if (paymentStatus !== "paid") {
    throw new Error(
      `Stripe session ${order.stripeSessionId} is not paid (payment_status: ${paymentStatus})`
    );
  }

  const result = await deps.runCheckoutHandler(sessionData);

  // Send emails for any state where the customer was actually charged.
  // "skipped" means the order had already advanced past pending — don't re-send.
  if (
    result.action === "submitted" ||
    result.action === "paid" ||
    result.action === "paid_printful_failed"
  ) {
    await deps.sendEmails(orderId);
  }

  return result;
}
