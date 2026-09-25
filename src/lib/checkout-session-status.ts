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
 */
import { stripe } from "@/lib/stripe";

export type CheckoutSessionState = {
  status: "open" | "complete" | "expired" | null;
  uiMode: string | null;
  url: string | null;
};

/** `null` means the Stripe call threw — callers treat that like today's
 * behaviour (render the order as confirmed) rather than guessing. */
export async function getCheckoutSessionState(
  sessionId: string
): Promise<CheckoutSessionState | null> {
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    return {
      status: session.status,
      uiMode: session.ui_mode,
      url: session.url,
    };
  } catch {
    return null;
  }
}

export type ConfirmView =
  | { kind: "confirmed" }
  | { kind: "incomplete"; resumeHref: string | null }
  | { kind: "expired" };

/**
 * Pure. Only a `pending` order with an `open` Stripe session is anything
 * other than "confirmed" — a paid/submitted/shipped/etc. order, a Stripe read
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
