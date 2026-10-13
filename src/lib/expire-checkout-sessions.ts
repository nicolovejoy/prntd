// Not a "use server" module on purpose: these functions trust the ids they
// are given (a user id, an order id, a Stripe session id), so exporting them
// from a "use server" file would make them callable Server Actions.
import { and, desc, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
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

/** Most earlier sessions one checkout will try to expire. A buyer normally has
 * at most one live checkout, so this is a bound on Stripe writes per click. */
const MAX_EXPIRED_PER_CHECKOUT = 3;

/** SQLite's insertion counter for the order table (an ordinary rowid table). */
const orderRowid = sql<number>`"order"."rowid"`;

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
      // Per-request options make the SDK stop when we stop waiting: its own
      // default is 80 s with two retries, and withTimeout cannot cancel it.
      () =>
        stripe.checkout.sessions.expire(sessionId, undefined, {
          timeout: STRIPE_SESSION_READ_TIMEOUT_MS,
          maxNetworkRetries: 0,
        })
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
 * "Earlier" means inserted earlier: a lower SQLite `rowid` on `order`.
 * `order.created_at` is stored in whole seconds and ids are random, so neither
 * can say which of two checkouts in the same second came first; the rowid is
 * assigned at insert and does. Of any two orders exactly one is earlier, so two
 * concurrent checkouts never expire each other, and the newer one is never the
 * one expired. At most three sessions are expired per call.
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
    const [current] = await db
      .select({ id: orderTable.id, rowid: orderRowid })
      .from(orderTable)
      .where(
        and(
          eq(orderTable.id, params.orderId),
          eq(orderTable.userId, params.userId)
        )
      );
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
          gte(orderTable.createdAt, windowStart),
          sql`${orderRowid} < ${current.rowid}`
        )
      )
      .orderBy(desc(orderRowid))
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
