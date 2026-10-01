import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Stripe from "stripe";

const retrieve = vi.fn();

vi.mock("@/lib/stripe", () => ({
  stripe: { checkout: { sessions: { retrieve: (...args: unknown[]) => retrieve(...args) } } },
}));

import {
  getCheckoutSessionState,
  resolveConfirmView,
  STRIPE_SESSION_READ_TIMEOUT_MS,
} from "../checkout-session-status";

describe("getCheckoutSessionState", () => {
  beforeEach(() => {
    retrieve.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns status/uiMode/url from the retrieved session", async () => {
    retrieve.mockResolvedValue({ status: "open", ui_mode: "embedded", url: null, payment_status: "unpaid" });

    const result = await getCheckoutSessionState("cs_1");

    expect(retrieve).toHaveBeenCalledWith("cs_1");
    expect(result).toEqual({
      status: "open",
      paymentStatus: "unpaid",
      uiMode: "embedded",
      url: null,
    });
  });

  it("returns null when the Stripe call throws", async () => {
    retrieve.mockRejectedValue(new Error("network blip"));

    const result = await getCheckoutSessionState("cs_1");

    expect(result).toBeNull();
  });

  it("returns null after the timeout when the retrieve call never settles", async () => {
    vi.useFakeTimers();
    retrieve.mockReturnValue(new Promise(() => {}));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const resultPromise = getCheckoutSessionState("cs_1");
    await vi.advanceTimersByTimeAsync(STRIPE_SESSION_READ_TIMEOUT_MS);
    const result = await resultPromise;

    expect(result).toBeNull();
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(errSpy.mock.calls[0][0]).toContain("getCheckoutSessionState");
  });

  it("logs a Stripe error's type/code/statusCode, never its raw payload", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const stripeErr = new Stripe.errors.StripeAuthenticationError({
      type: "StripeAuthenticationError",
      code: "api_key_expired",
      statusCode: 401,
      message: "expired",
      client_secret: "cs_secret_PLANTED",
    } as any);
    retrieve.mockRejectedValue(stripeErr);

    const result = await getCheckoutSessionState("cs_1");

    expect(result).toBeNull();
    expect(errSpy).toHaveBeenCalledTimes(1);
    const logged = errSpy.mock.calls[0][0] as string;
    expect(logged).toContain("StripeAuthenticationError");
    expect(logged).toContain("api_key_expired");
    expect(logged).toContain("401");
    expect(logged).not.toContain("PLANTED");
  });
});

describe("resolveConfirmView", () => {
  const base = { embeddedEnabled: true, sessionId: "cs_1" as const };

  it("is confirmed for a non-pending order regardless of stripe state", () => {
    expect(
      resolveConfirmView({ ...base, orderStatus: "paid", abandoned: false, stripe: null })
    ).toEqual({ kind: "confirmed" });
    expect(
      resolveConfirmView({
        ...base,
        orderStatus: "submitted",
        abandoned: false,
        stripe: { status: "open", paymentStatus: null, uiMode: "embedded", url: null },
      })
    ).toEqual({ kind: "confirmed" });
  });

  it("is confirmed when the Stripe read failed (stripe is null)", () => {
    expect(
      resolveConfirmView({ ...base, orderStatus: "pending", abandoned: false, stripe: null })
    ).toEqual({ kind: "confirmed" });
  });

  it("is confirmed when the session completed", () => {
    expect(
      resolveConfirmView({
        ...base,
        orderStatus: "pending",
        abandoned: false,
        stripe: { status: "complete", paymentStatus: "paid", uiMode: "embedded", url: null },
      })
    ).toEqual({ kind: "confirmed" });
  });

  it("is expired when Stripe reports an expired session", () => {
    expect(
      resolveConfirmView({
        ...base,
        orderStatus: "pending",
        abandoned: false,
        stripe: { status: "expired", paymentStatus: null, uiMode: "embedded", url: null },
      })
    ).toEqual({ kind: "expired" });
  });

  it("resumes to /checkout for an open embedded session with embedded enabled", () => {
    expect(
      resolveConfirmView({
        ...base,
        orderStatus: "pending",
        abandoned: false,
        stripe: { status: "open", paymentStatus: null, uiMode: "embedded", url: null },
      })
    ).toEqual({ kind: "incomplete", resumeHref: "/checkout?session=cs_1" });
  });

  it("does not resume to /checkout for an open embedded session when embedded is disabled", () => {
    expect(
      resolveConfirmView({
        ...base,
        embeddedEnabled: false,
        orderStatus: "pending",
        abandoned: false,
        stripe: { status: "open", paymentStatus: null, uiMode: "embedded", url: "https://checkout.stripe.com/x" },
      })
    ).toEqual({ kind: "incomplete", resumeHref: "https://checkout.stripe.com/x" });
  });

  it("resumes to the Stripe url for an open hosted session that has one", () => {
    expect(
      resolveConfirmView({
        ...base,
        orderStatus: "pending",
        abandoned: false,
        stripe: { status: "open", paymentStatus: null, uiMode: "hosted", url: "https://checkout.stripe.com/x" },
      })
    ).toEqual({ kind: "incomplete", resumeHref: "https://checkout.stripe.com/x" });
  });

  it("has no resume href for an open session with no url and no embedded resume", () => {
    expect(
      resolveConfirmView({
        ...base,
        orderStatus: "pending",
        abandoned: false,
        stripe: { status: "open", paymentStatus: null, uiMode: "hosted", url: null },
      })
    ).toEqual({ kind: "incomplete", resumeHref: null });
  });

  it("encodes the session id in the resume href", () => {
    expect(
      resolveConfirmView({
        embeddedEnabled: true,
        sessionId: "cs_test_abc&xyz",
        orderStatus: "pending",
        abandoned: false,
        stripe: { status: "open", paymentStatus: null, uiMode: "embedded", url: null },
      })
    ).toEqual({ kind: "incomplete", resumeHref: "/checkout?session=cs_test_abc%26xyz" });
  });

  it("is confirmed for an unexpected Stripe status", () => {
    expect(
      resolveConfirmView({
        ...base,
        orderStatus: "pending",
        abandoned: false,
        stripe: { status: null, paymentStatus: null, uiMode: null, url: null },
      })
    ).toEqual({ kind: "confirmed" });
  });
});

describe("getCheckoutSessionState payment_status", () => {
  beforeEach(() => retrieve.mockReset());

  it.each(["paid", "unpaid", "no_payment_required"] as const)("exposes %s", async (ps) => {
    retrieve.mockResolvedValue({ status: "complete", ui_mode: "hosted", url: null, payment_status: ps });
    expect((await getCheckoutSessionState("cs_1"))?.paymentStatus).toBe(ps);
  });

  it("reads a missing payment_status as null", async () => {
    retrieve.mockResolvedValue({ status: "complete", ui_mode: "hosted", url: null });
    expect((await getCheckoutSessionState("cs_1"))?.paymentStatus).toBeNull();
  });
});

describe("resolveConfirmView exhaustive matrix", () => {
  const orderStatuses = ["pending", "paid", "submitted", "shipped", "delivered", "canceled"];
  const sessionStatuses = ["open", "complete", "expired", null] as const;
  const paymentStatuses = ["paid", "unpaid", "no_payment_required", null] as const;

  // The behaviour on main, before payment_status existed: confirmed unless a
  // pending order had an open or expired session (or the read succeeded with
  // anything else, which was also confirmed).
  function onMain(orderStatus: string, s: (typeof sessionStatuses)[number], read: boolean) {
    if (orderStatus !== "pending" || !read) return "confirmed";
    if (s === "expired") return "expired";
    if (s === "open") return "incomplete";
    return "confirmed";
  }

  for (const orderStatus of orderStatuses)
    for (const abandoned of [false, true])
      for (const read of [true, false])
        for (const s of sessionStatuses)
          for (const ps of paymentStatuses) {
            it(`${orderStatus} abandoned=${abandoned} read=${read} session=${s} pay=${ps}`, () => {
              const view = resolveConfirmView({
                embeddedEnabled: true,
                sessionId: "cs_1",
                orderStatus,
                abandoned,
                stripe: read ? { status: s, paymentStatus: ps, uiMode: "embedded", url: null } : null,
              });
              const unpaidComplete = orderStatus === "pending" && read && s === "complete" && ps === "unpaid";
              if (unpaidComplete) {
                expect(view.kind).toBe(abandoned ? "failed" : "processing");
              } else {
                // Every other combination, including every paid one, is
                // exactly what main returned.
                expect(view.kind).toBe(onMain(orderStatus, s, read));
              }
              if (s === "complete" && (ps === "paid" || ps === "no_payment_required")) {
                expect(view.kind).toBe("confirmed");
              }
            });
          }
});
