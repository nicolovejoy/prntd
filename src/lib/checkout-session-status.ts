/**
 * #135 slice 2 — resolving what `/order/confirm` should show for an order
 * that's still `pending` by the time the buyer lands back on the page. A
 * `pending` order here is routine even with hosted checkout — Stripe
 * redirects on a completed payment, often before the webhook has marked the
 * order paid, which is the `complete` and paid → confirmed branch below, not an error
 * state (a `complete` session that isn't paid is the processing/failed branch). What's new with embedded checkout is the `open` branch: Stripe can
 * send the buyer to `return_url` (this page) without a completed payment —
 * e.g. they backed out of a redirect-based payment method — while the
 * session itself is still open, or anyone can open the URL directly. A
 * closed tab never reaches this page at all; there's no redirect to make.
 * `getCheckoutSessionState` is the one Stripe read this needs — a plain
 * server-side lib, not a `"use server"` action, so it's never reachable as
 * an action endpoint. The same read supplies the charged total for the
 * receipt (`amountTotal`, #317). `resolveConfirmView` is pure so the branching is
 * unit-testable without touching Stripe.
 *
 * Most `/order/confirm` visits land here before the webhook has marked the
 * order paid (buyers usually beat it), whichever checkout they used, so this
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
import { embeddedCheckoutPath } from "@/lib/embedded-checkout";

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
  /** `unpaid` on a `complete` session is a delayed-notification method (a
   * bank debit, for one) whose money hasn't arrived — and, if it fails later,
   * stays `complete`/`unpaid`. `null` means Stripe reported none. Any value
   * other than `paid`/`no_payment_required` is read as not yet paid. */
  paymentStatus: "paid" | "unpaid" | "no_payment_required" | (string & {}) | null;
  uiMode: string | null;
  url: string | null;
  /** `session.amount_total` in cents: what Stripe charged after any
   * discount, the number the webhook writes to `order.totalPrice`
   * (`handleStripeCheckoutCompleted`). `null` when Stripe reported none. */
  amountTotal: number | null;
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
      paymentStatus: session.payment_status ?? null,
      uiMode: session.ui_mode,
      url: session.url,
      amountTotal: session.amount_total ?? null,
    };
  } catch (err) {
    console.error(`getCheckoutSessionState failed: ${describeStripeError(err)}`);
    return null;
  }
}

export type ConfirmView =
  /** `paidTotal` is what Stripe charged, in dollars, for a pending order
   * whose session is complete and settled; `null` otherwise (a non-pending
   * order's stored total is already reconciled by the webhook, a failed read
   * or a session with no `amount_total` has nothing better). */
  | { kind: "confirmed"; paidTotal: number | null }
  | { kind: "incomplete"; resumeHref: string | null }
  | { kind: "expired" }
  /** Session `complete` but the payment hasn't cleared; order still pending. */
  | { kind: "processing" }
  /** Same, but the async payment failed (webhook set `abandoned_at`). */
  | { kind: "failed" };

/**
 * Pure. Only a `pending` order is anything other than "confirmed" — a
 * paid/submitted/shipped/etc. order and a Stripe read that failed render the
 * normal receipt (the failure case matches today's behaviour: we don't know
 * the session's state, so we don't tell the buyer anything alarming was
 * charged or not charged). For a pending order: `open` and `expired` as
 * above; `complete` is confirmed when `payment_status` is paid,
 * no_payment_required or absent; any other value is "processing", or "failed" once the webhook has abandoned the order.
 * A pending order whose session is complete and settled carries Stripe's
 * `amount_total` (dollars) as `paidTotal`, since the stored total is the
 * pre-discount figure until the webhook reconciles it (#317).
 * An open embedded session resumes at `/checkout` through
 * `embeddedCheckoutPath`, carrying `from` so the Back link goes where the
 * original one went (#317).
 */
export function resolveConfirmView(params: {
  orderStatus: string;
  abandoned: boolean;
  stripe: CheckoutSessionState | null;
  embeddedEnabled: boolean;
  sessionId: string;
  /** The `from` Stripe handed back on `return_url` (written by
   * `buildCheckoutSessionParams` and `buildCartCheckoutSessionParams`,
   * #317): where /checkout's Back link went on the first visit. It arrives in
   * the query string, so `embeddedCheckoutPath` sanitises it again; missing or
   * unsafe becomes the Shop. Used only for an embedded resume link. */
  from?: string;
}): ConfirmView {
  if (params.orderStatus !== "pending") return { kind: "confirmed", paidTotal: null };

  const stripeState = params.stripe;
  if (stripeState === null) return { kind: "confirmed", paidTotal: null };
  if (stripeState.status === "complete") {
    const ps = stripeState.paymentStatus;
    // Fail closed: a payment_status Stripe adds later reads as not yet paid.
    if (ps == null || ps === "paid" || ps === "no_payment_required") {
      return {
        kind: "confirmed",
        // Same expression as handleStripeCheckoutCompleted.
        paidTotal: stripeState.amountTotal != null ? stripeState.amountTotal / 100 : null,
      };
    }
    return { kind: params.abandoned ? "failed" : "processing" };
  }
  if (stripeState.status === "expired") return { kind: "expired" };

  if (stripeState.status === "open") {
    const resumeHref =
      stripeState.uiMode === "embedded" && params.embeddedEnabled
        ? embeddedCheckoutPath(params.sessionId, params.from ?? "")
        : stripeState.url ?? null;
    return { kind: "incomplete", resumeHref };
  }

  return { kind: "confirmed", paidTotal: null };
}
