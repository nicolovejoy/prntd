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
    retrieve.mockResolvedValue({ status: "open", ui_mode: "embedded", url: null });

    const result = await getCheckoutSessionState("cs_1");

    expect(retrieve).toHaveBeenCalledWith("cs_1");
    expect(result).toEqual({ status: "open", uiMode: "embedded", url: null });
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
      resolveConfirmView({ ...base, orderStatus: "paid", stripe: null })
    ).toEqual({ kind: "confirmed" });
    expect(
      resolveConfirmView({
        ...base,
        orderStatus: "submitted",
        stripe: { status: "open", uiMode: "embedded", url: null },
      })
    ).toEqual({ kind: "confirmed" });
  });

  it("is confirmed when the Stripe read failed (stripe is null)", () => {
    expect(
      resolveConfirmView({ ...base, orderStatus: "pending", stripe: null })
    ).toEqual({ kind: "confirmed" });
  });

  it("is confirmed when the session completed", () => {
    expect(
      resolveConfirmView({
        ...base,
        orderStatus: "pending",
        stripe: { status: "complete", uiMode: "embedded", url: null },
      })
    ).toEqual({ kind: "confirmed" });
  });

  it("is expired when Stripe reports an expired session", () => {
    expect(
      resolveConfirmView({
        ...base,
        orderStatus: "pending",
        stripe: { status: "expired", uiMode: "embedded", url: null },
      })
    ).toEqual({ kind: "expired" });
  });

  it("resumes to /checkout for an open embedded session with embedded enabled", () => {
    expect(
      resolveConfirmView({
        ...base,
        orderStatus: "pending",
        stripe: { status: "open", uiMode: "embedded", url: null },
      })
    ).toEqual({ kind: "incomplete", resumeHref: "/checkout?session=cs_1" });
  });

  it("does not resume to /checkout for an open embedded session when embedded is disabled", () => {
    expect(
      resolveConfirmView({
        ...base,
        embeddedEnabled: false,
        orderStatus: "pending",
        stripe: { status: "open", uiMode: "embedded", url: "https://checkout.stripe.com/x" },
      })
    ).toEqual({ kind: "incomplete", resumeHref: "https://checkout.stripe.com/x" });
  });

  it("resumes to the Stripe url for an open hosted session that has one", () => {
    expect(
      resolveConfirmView({
        ...base,
        orderStatus: "pending",
        stripe: { status: "open", uiMode: "hosted", url: "https://checkout.stripe.com/x" },
      })
    ).toEqual({ kind: "incomplete", resumeHref: "https://checkout.stripe.com/x" });
  });

  it("has no resume href for an open session with no url and no embedded resume", () => {
    expect(
      resolveConfirmView({
        ...base,
        orderStatus: "pending",
        stripe: { status: "open", uiMode: "hosted", url: null },
      })
    ).toEqual({ kind: "incomplete", resumeHref: null });
  });

  it("encodes the session id in the resume href", () => {
    expect(
      resolveConfirmView({
        embeddedEnabled: true,
        sessionId: "cs_test_abc&xyz",
        orderStatus: "pending",
        stripe: { status: "open", uiMode: "embedded", url: null },
      })
    ).toEqual({ kind: "incomplete", resumeHref: "/checkout?session=cs_test_abc%26xyz" });
  });

  it("is confirmed for an unexpected Stripe status", () => {
    expect(
      resolveConfirmView({
        ...base,
        orderStatus: "pending",
        stripe: { status: null, uiMode: null, url: null },
      })
    ).toEqual({ kind: "confirmed" });
  });
});
