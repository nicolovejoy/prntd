// Not a "use server" module on purpose: these functions trust the ids they
// are given (a user id, an order id, a Stripe session id), so exporting them
// from a "use server" file would make them callable Server Actions.
import { and, desc, eq, gte, isNotNull, isNull, lt, ne, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { order as orderTable } from "@/lib/db/schema";
import { stripe } from "@/lib/stripe";
import { withTimeout } from "@/lib/timeout";
import {
  STRIPE_SESSION_READ_TIMEOUT_MS,
  describeStripeError,
} from "@/lib/checkout-session-status";
import { CHECKOUT_SESSION_TTL_SECONDS } from "@/lib/checkout";
import { handleStripeCheckoutExpired } from "@/lib/webhook-handlers";

/** An order older than the session lifetime plus this margin has a session
 * that Stripe already expired on its own. */
const OPEN_WINDOW_MARGIN_SECONDS = 5 * 60;

/** Most earlier sessions one checkout will try to expire. */
const MAX_EXPIRED_PER_CHECKOUT = 10;

/**
 * Asks Stripe to expire one open Checkout session. True when Stripe reports
 * it expired. Never throws and never waits longer than the timeout: Stripe
 * refuses a session that is complete or already expired, and that refusal,
 * a network error and a timeout all read as false.
 */
export async function expireCheckoutSession(sessionId: string): Promise<boolean> {
  try {
    const session = await withTimeout(
      "expireCheckoutSession",
      STRIPE_SESSION_READ_TIMEOUT_MS,
      () => stripe.checkout.sessions.expire(sessionId)
    );
    if (session.status === "expired") return true;
    console.error(
      `expireCheckoutSession ${sessionId}: Stripe reported status ${String(session.status)}`
    );
    return false;
  } catch (err) {
    console.error(
      `expireCheckoutSession ${sessionId} failed: ${describeStripeError(err)}`
    );
    return false;
  }
}

/**
 * After a new checkout session exists for `orderId`, expires the same buyer's
 * earlier open sessions. Never throws. Returns what it attempted, for tests
 * and logs.
 *
 * "Earlier" is a total order on (created_at, id). `order.created_at` is stored
 * as whole seconds, so two checkouts can share a value; the id breaks the tie,
 * which means that of two checkouts created together exactly one counts as the
 * earlier, and two concurrent checkouts never expire each other.
 *
 * An order is marked abandoned only when Stripe confirms its session expired.
 * When Stripe refuses (the session is complete, or being paid) or the call
 * fails, the row is left as it is, so the webhook can still claim a payment.
 */
export async function expireEarlierCheckoutSessions(params: {
  userId: string;
  orderId: string;
}): Promise<{ orderId: string; sessionId: string; expired: boolean }[]> {
  try {
    const current = await db.query.order.findFirst({
      where: and(
        eq(orderTable.id, params.orderId),
        eq(orderTable.userId, params.userId)
      ),
      columns: { id: true, createdAt: true },
    });
    if (!current) return [];

    const windowStart = new Date(
      Date.now() -
        (CHECKOUT_SESSION_TTL_SECONDS + OPEN_WINDOW_MARGIN_SECONDS) * 1000
    );
    const earlier = await db
      .select({ id: orderTable.id, sessionId: orderTable.stripeSessionId })
      .from(orderTable)
      .where(
        and(
          eq(orderTable.userId, params.userId),
          eq(orderTable.status, "pending"),
          isNull(orderTable.abandonedAt),
          isNotNull(orderTable.stripeSessionId),
          ne(orderTable.id, current.id),
          gte(orderTable.createdAt, windowStart),
          or(
            lt(orderTable.createdAt, current.createdAt),
            and(
              eq(orderTable.createdAt, current.createdAt),
              lt(orderTable.id, current.id)
            )
          )
        )
      )
      .orderBy(desc(orderTable.createdAt), desc(orderTable.id))
      .limit(MAX_EXPIRED_PER_CHECKOUT);

    const targets = earlier.flatMap((row) =>
      row.sessionId ? [{ orderId: row.id, sessionId: row.sessionId }] : []
    );

    return await Promise.all(
      targets.map(async (target) => {
        const expired = await expireCheckoutSession(target.sessionId);
        if (expired) {
          try {
            await handleStripeCheckoutExpired(target.orderId, { db });
          } catch (err) {
            console.error(
              `Order ${target.orderId}: could not mark abandoned after its session expired (non-fatal): ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }
        return { ...target, expired };
      })
    );
  } catch (err) {
    console.error(
      `expireEarlierCheckoutSessions failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`
    );
    return [];
  }
}
