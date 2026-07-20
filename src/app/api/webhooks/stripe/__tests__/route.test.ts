// @vitest-environment node
/**
 * Route-level tests for the Stripe webhook (WP5). The handler's money logic is
 * covered by money-path.integration.test.ts against a real DB; this file locks
 * the ROUTE contract on top of it:
 *   - signature verification (real `stripe.webhooks.constructEvent` against a
 *     header minted with `generateTestHeaderString` — no crypto mocked)
 *   - event-type routing (only checkout.session.completed does work)
 *   - error mapping: a handler THROW → 400 (Stripe redelivers; per WP1 the
 *     handler itself only throws before the paid-claim), while post-claim
 *     failures surface as resolved actions (paid / paid_printful_failed) that
 *     must return 200 so Stripe does NOT redeliver
 *   - the email branch: sendPostOrderEmails fires on submitted / paid /
 *     paid_printful_failed, and not on skipped
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type Stripe from "stripe";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/printful", () => ({
  createOrder: vi.fn(),
  getOrderByExternalId: vi.fn(),
}));
vi.mock("@/lib/ai", () => ({ generateOrderName: vi.fn() }));
vi.mock("@/lib/design-images", () => ({
  getDesignDisplayImageUrl: vi.fn(),
  getDesignImageById: vi.fn(),
}));
vi.mock("@/lib/email", () => ({
  sendOrderConfirmation: vi.fn(),
  sendOwnerOrderAlert: vi.fn(),
}));
vi.mock("@/lib/order-emails", () => ({
  sendPostOrderEmails: vi.fn().mockResolvedValue(undefined),
  createDefaultOrderEmailDeps: vi.fn(() => ({})),
}));
vi.mock("@/lib/webhook-handlers", () => ({
  handleStripeCheckoutCompleted: vi.fn(),
}));
// Real Stripe SDK instance (dummy key): webhooks.constructEvent and
// generateTestHeaderString are pure crypto, no network. checkout.sessions is
// spied per-test.
vi.mock("@/lib/stripe", async () => {
  const { default: StripeSdk } = await import("stripe");
  return { stripe: new StripeSdk("sk_test_dummy") };
});

import { POST } from "../route";
import { stripe } from "@/lib/stripe";
import { handleStripeCheckoutCompleted } from "@/lib/webhook-handlers";
import { sendPostOrderEmails } from "@/lib/order-emails";

const WEBHOOK_SECRET = "whsec_test_wp5";
process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;

const handlerMock = vi.mocked(handleStripeCheckoutCompleted);
const emailsMock = vi.mocked(sendPostOrderEmails);

function eventBody(type: string, object: Record<string, unknown> = { id: "cs_123" }) {
  return JSON.stringify({
    id: "evt_test_1",
    object: "event",
    type,
    data: { object },
  });
}

function signedRequest(body: string, secret = WEBHOOK_SECRET) {
  const signature = stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret,
  });
  return new NextRequest("http://localhost/api/webhooks/stripe", {
    method: "POST",
    body,
    headers: { "stripe-signature": signature },
  });
}

/** Minimal retrieved-session shape accepted by toStripeSessionData. */
function fakeFullSession(
  overrides: Partial<Record<string, unknown>> = {}
): Stripe.Checkout.Session {
  return {
    id: "cs_123",
    metadata: { orderId: "order-1", designId: "design-1" },
    payment_intent: "pi_1",
    amount_total: 2412,
    amount_subtotal: 1943,
    total_details: { amount_shipping: 469 },
    collected_information: {
      shipping_details: {
        name: "Jane Doe",
        address: {
          line1: "1 Main St",
          city: "Town",
          state: "CA",
          postal_code: "90001",
          country: "US",
        },
      },
    },
    ...overrides,
  } as unknown as Stripe.Checkout.Session;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("Stripe webhook route — signature verification", () => {
  it("400s when the stripe-signature header is missing", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/webhooks/stripe", {
        method: "POST",
        body: eventBody("checkout.session.completed"),
      })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Missing signature" });
    expect(handlerMock).not.toHaveBeenCalled();
  });

  it("400s on a signature minted with the wrong secret", async () => {
    const res = await POST(
      signedRequest(eventBody("checkout.session.completed"), "whsec_wrong")
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid signature" });
    expect(handlerMock).not.toHaveBeenCalled();
  });

  it("400s when the body was tampered with after signing", async () => {
    const body = eventBody("checkout.session.completed");
    const signature = stripe.webhooks.generateTestHeaderString({
      payload: body,
      secret: WEBHOOK_SECRET,
    });
    const res = await POST(
      new NextRequest("http://localhost/api/webhooks/stripe", {
        method: "POST",
        body: body.replace("cs_123", "cs_evil"),
        headers: { "stripe-signature": signature },
      })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid signature" });
  });
});

describe("Stripe webhook route — event routing", () => {
  it("acknowledges unrelated event types without doing any work", async () => {
    const retrieve = vi.spyOn(stripe.checkout.sessions, "retrieve");
    const res = await POST(signedRequest(eventBody("payment_intent.succeeded")));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(retrieve).not.toHaveBeenCalled();
    expect(handlerMock).not.toHaveBeenCalled();
    expect(emailsMock).not.toHaveBeenCalled();
  });

  it("runs the handler with the translated session data on checkout.session.completed", async () => {
    vi.spyOn(stripe.checkout.sessions, "retrieve").mockResolvedValue(
      fakeFullSession() as never
    );
    handlerMock.mockResolvedValue({ action: "submitted" });

    const res = await POST(signedRequest(eventBody("checkout.session.completed")));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(handlerMock).toHaveBeenCalledTimes(1);
    const [sessionData] = handlerMock.mock.calls[0];
    expect(sessionData).toMatchObject({
      id: "cs_123",
      metadata: { orderId: "order-1", designId: "design-1" },
      paymentIntentId: "pi_1",
      amountTotal: 2412,
      amountShipping: 469,
      discount: null,
      shipping: expect.objectContaining({ city: "Town", zip: "90001" }),
    });
  });

  it("400s when the retrieved session is missing orderId/designId metadata", async () => {
    vi.spyOn(stripe.checkout.sessions, "retrieve").mockResolvedValue(
      fakeFullSession({ metadata: {} }) as never
    );
    const res = await POST(signedRequest(eventBody("checkout.session.completed")));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Missing metadata" });
    expect(handlerMock).not.toHaveBeenCalled();
  });
});

describe("Stripe webhook route — error mapping (WP1 contract)", () => {
  beforeEach(() => {
    vi.spyOn(stripe.checkout.sessions, "retrieve").mockResolvedValue(
      fakeFullSession() as never
    );
  });

  it("returns 400 when the handler throws (pre-paid-claim failure → Stripe redelivers)", async () => {
    handlerMock.mockRejectedValue(new Error("Order order-1 not found"));
    const res = await POST(signedRequest(eventBody("checkout.session.completed")));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Processing failed" });
    expect(emailsMock).not.toHaveBeenCalled();
  });

  it("returns 200 (never 400) when fulfillment failed after the paid-claim", async () => {
    // Per WP1, a Printful failure after the money moved resolves to
    // paid_printful_failed instead of throwing — a 400 here would make Stripe
    // redeliver an event that can only be skipped, stranding fulfillment on
    // the daily cron.
    handlerMock.mockResolvedValue({ action: "paid_printful_failed" });
    const res = await POST(signedRequest(eventBody("checkout.session.completed")));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
  });
});

describe("Stripe webhook route — email branch", () => {
  beforeEach(() => {
    vi.spyOn(stripe.checkout.sessions, "retrieve").mockResolvedValue(
      fakeFullSession() as never
    );
  });

  it.each(["submitted", "paid", "paid_printful_failed"] as const)(
    "sends post-order emails when the handler resolves %s",
    async (action) => {
      handlerMock.mockResolvedValue({ action });
      const res = await POST(signedRequest(eventBody("checkout.session.completed")));
      expect(res.status).toBe(200);
      expect(emailsMock).toHaveBeenCalledTimes(1);
      expect(emailsMock).toHaveBeenCalledWith("order-1", expect.anything());
    }
  );

  it("does not send emails on a skipped redelivery", async () => {
    handlerMock.mockResolvedValue({ action: "skipped" });
    const res = await POST(signedRequest(eventBody("checkout.session.completed")));
    expect(res.status).toBe(200);
    expect(emailsMock).not.toHaveBeenCalled();
  });
});
