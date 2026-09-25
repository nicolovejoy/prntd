/**
 * #135 slice 2 — resolving what `/order/confirm` should show for an order
 * that's still `pending` by the time the buyer lands back on the page. A
 * `pending` order here is routine even with hosted checkout — Stripe
 * redirects on a completed payment, often before the webhook has marked the
 * order paid, which is the `complete` → confirmed branch below, not an error
 * state. What's new with embedded checkout is the `open` branch: Stripe can
 * send the buyer to `return_url` (this page) without a completed payment —
 * e.g. they backed out of a redirect-based payment method — while the
 * session itself is still open, or anyone can open the URL directly. A
 * closed tab never reaches this page at all; there's no redirect to make.
 * `getCheckoutSessionState` is the one Stripe read this needs — a plain
 * server-side lib, not a `"use server"` action, so it's never reachable as
 * an action endpoint. `resolveConfirmView` is pure so the branching is
 * unit-testable without touching Stripe.
 *
 * With the embedded flag on, most `/order/confirm` visits land here before
 * the webhook has marked the order paid (buyers usually beat it), so this
 * read sits on the critical path of the receipt page. Bounded to
 * `STRIPE_SESSION_READ_TIMEOUT_MS` (well under the SDK's own 80s/2-retry
 * default) so a slow Stripe can't hang the page, and every failure is logged
 * server-side — the fail-safe return is silent to the buyer by design (see
 * below), so without a log a systematic failure (e.g. a restricted key with
 * no session-read permission) would dead-end every purchase with no trace.
 */
import Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { withTimeout } from "@/lib/timeout";

/** Shared by `loadEmbeddedCheckout` too — both reads sit on the same
 * post-payment critical path and get the same bound. */
export const STRIPE_SESSION_READ_TIMEOUT_MS = 3000;

/**
 * One line describing a failed Stripe read, safe to log: for a Stripe SDK
 * error, its `type`/`code`/`statusCode` (never `.raw`, headers, or any
 * secret); otherwise the error's message, which is how a `withTimeout`
 * rejection surfaces here.
 */
export function describeStripeError(err: unknown): string {
  if (err instanceof Stripe.errors.StripeError) {
    return `type=${err.type} code=${err.code ?? "none"} statusCode=${err.statusCode ?? "none"}`;
  }
  return err instanceof Error ? err.message : String(err);
}

export type CheckoutSessionState = {
  status: "open" | "complete" | "expired" | null;
  uiMode: string | null;
  url: string | null;
};

/** `null` means the Stripe call threw or timed out — callers treat that like
 * today's behaviour (render the order as confirmed) rather than guessing. */
export async function getCheckoutSessionState(
  sessionId: string
): Promise<CheckoutSessionState | null> {
  try {
    const session = await withTimeout(
      "getCheckoutSessionState",
      STRIPE_SESSION_READ_TIMEOUT_MS,
      () => stripe.checkout.sessions.retrieve(sessionId)
    );
    return {
      status: session.status,
      uiMode: session.ui_mode,
      url: session.url,
    };
  } catch (err) {
    console.error(`getCheckoutSessionState failed: ${describeStripeError(err)}`);
    return null;
  }
}

export type ConfirmView =
  | { kind: "confirmed" }
  | { kind: "incomplete"; resumeHref: string | null }
  | { kind: "expired" };

/**
 * Pure. Only a `pending` order with an `open` or `expired` Stripe session is
 * anything other than "confirmed" — a paid/submitted/shipped/etc. order, a Stripe read
 * that failed, or a `complete` session all render the normal receipt (the
 * failure case matches today's behaviour: we don't know the session's state,
 * so we don't tell the buyer anything alarming was charged or not charged).
 */
export function resolveConfirmView(params: {
  orderStatus: string;
  stripe: CheckoutSessionState | null;
  embeddedEnabled: boolean;
  sessionId: string;
}): ConfirmView {
  if (params.orderStatus !== "pending") return { kind: "confirmed" };

  const stripeState = params.stripe;
  if (stripeState === null) return { kind: "confirmed" };
  if (stripeState.status === "complete") return { kind: "confirmed" };
  if (stripeState.status === "expired") return { kind: "expired" };

  if (stripeState.status === "open") {
    const resumeHref =
      stripeState.uiMode === "embedded" && params.embeddedEnabled
        ? `/checkout?session=${encodeURIComponent(params.sessionId)}`
        : stripeState.url ?? null;
    return { kind: "incomplete", resumeHref };
  }

  return { kind: "confirmed" };
}
