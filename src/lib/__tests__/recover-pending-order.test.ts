import { describe, it, expect, vi } from "vitest";
import {
  recoverPendingOrderCore,
  type RecoverDeps,
} from "../recover-pending-order";
import type { StripeSessionData } from "../webhook-handlers";

const sessionData: StripeSessionData = {
  id: "cs_test_recover",
  metadata: { orderId: "order-stuck", designId: "design-1" },
  paymentIntentId: "pi_recover",
  amountTotal: 3000,
  discount: null,
  shipping: {
    name: "Stuck User",
    address1: "1 Main",
    address2: "",
    city: "Springfield",
    state: "IL",
    zip: "62701",
    country: "US",
  },
};

function createDeps(overrides: Partial<RecoverDeps> = {}): RecoverDeps {
  return {
    loadOrder: vi.fn().mockResolvedValue({
      id: "order-stuck",
      status: "pending",
      stripeSessionId: "cs_test_recover",
    }),
    fetchSessionData: vi.fn().mockResolvedValue({
      paymentStatus: "paid",
      sessionData,
    }),
    runCheckoutHandler: vi.fn().mockResolvedValue({ action: "submitted" }),
    sendEmails: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("recoverPendingOrderCore", () => {
  it("recovers a pending order end-to-end", async () => {
    const deps = createDeps();

    const result = await recoverPendingOrderCore("order-stuck", deps);

    expect(result.action).toBe("submitted");
    expect(deps.loadOrder).toHaveBeenCalledWith("order-stuck");
    expect(deps.fetchSessionData).toHaveBeenCalledWith("cs_test_recover");
    expect(deps.runCheckoutHandler).toHaveBeenCalledWith(sessionData);
    expect(deps.sendEmails).toHaveBeenCalledWith("order-stuck");
  });

  it("throws when order not found", async () => {
    const deps = createDeps({ loadOrder: vi.fn().mockResolvedValue(null) });

    await expect(recoverPendingOrderCore("missing", deps)).rejects.toThrow(
      "Order missing not found"
    );
    expect(deps.fetchSessionData).not.toHaveBeenCalled();
  });

  it("throws when order is not in pending status", async () => {
    const deps = createDeps({
      loadOrder: vi.fn().mockResolvedValue({
        id: "order-stuck",
        status: "paid",
        stripeSessionId: "cs_test_recover",
      }),
    });

    await expect(
      recoverPendingOrderCore("order-stuck", deps)
    ).rejects.toThrow(/not pending/);
    expect(deps.fetchSessionData).not.toHaveBeenCalled();
  });

  it("throws when order has no stripeSessionId", async () => {
    const deps = createDeps({
      loadOrder: vi.fn().mockResolvedValue({
        id: "order-stuck",
        status: "pending",
        stripeSessionId: null,
      }),
    });

    await expect(
      recoverPendingOrderCore("order-stuck", deps)
    ).rejects.toThrow(/no Stripe session/);
  });

  it("throws when Stripe session payment_status is not paid", async () => {
    const deps = createDeps({
      fetchSessionData: vi.fn().mockResolvedValue({
        paymentStatus: "unpaid",
        sessionData,
      }),
    });

    await expect(
      recoverPendingOrderCore("order-stuck", deps)
    ).rejects.toThrow(/not paid/);
    expect(deps.runCheckoutHandler).not.toHaveBeenCalled();
  });

  it("returns skipped without sending emails when handler reports skipped", async () => {
    const deps = createDeps({
      runCheckoutHandler: vi.fn().mockResolvedValue({ action: "skipped" }),
    });

    const result = await recoverPendingOrderCore("order-stuck", deps);

    expect(result.action).toBe("skipped");
    expect(deps.sendEmails).not.toHaveBeenCalled();
  });

  it("still sends emails when handler returns paid_printful_failed", async () => {
    // Customer was charged — they deserve a confirmation even if Printful errored
    const deps = createDeps({
      runCheckoutHandler: vi.fn().mockResolvedValue({ action: "paid_printful_failed" }),
    });

    const result = await recoverPendingOrderCore("order-stuck", deps);

    expect(result.action).toBe("paid_printful_failed");
    expect(deps.sendEmails).toHaveBeenCalledWith("order-stuck");
  });

  it("still sends emails when handler returns paid", async () => {
    const deps = createDeps({
      runCheckoutHandler: vi.fn().mockResolvedValue({ action: "paid" }),
    });

    const result = await recoverPendingOrderCore("order-stuck", deps);

    expect(result.action).toBe("paid");
    expect(deps.sendEmails).toHaveBeenCalledWith("order-stuck");
  });
});
