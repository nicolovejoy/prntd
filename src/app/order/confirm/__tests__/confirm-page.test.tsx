/**
 * /order/confirm is now an async server component: it awaits `searchParams`
 * and calls `getOrderReceipt` directly (no client fetch, no Loading…
 * paint). These tests call the exported async function like any other
 * server-side helper and render what it returns — see the plan's Task 3.
 *
 * `Breadcrumbs` is a client island rendered on the page, so `next/navigation`
 * is mocked with both `useRouter` (Breadcrumbs calls it) and `usePathname`
 * (not used here, but mocked per the plan so the module shape is complete).
 * `redirect` is mocked to throw (as Next's does) so the page stops, and
 * `@/lib/auth` returns whatever session the test sets.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import ConfirmPage from "../page";
import { safeNextPath } from "@/lib/safe-next";

const getOrderReceipt = vi.fn();
const getCheckoutSessionState = vi.fn();
const h = vi.hoisted(() => ({ session: null as unknown }));

vi.mock("@/lib/order-receipt", () => ({
  getOrderReceipt: (...args: unknown[]) => getOrderReceipt(...args),
}));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => h.session } },
  isAnonymousUser: (u: { isAnonymous?: boolean } | undefined) => Boolean(u?.isAnonymous),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

vi.mock("@/lib/stripe", () => ({
  stripe: { checkout: { sessions: { retrieve: vi.fn() } } },
}));

vi.mock("@/lib/checkout-session-status", async () => {
  const actual = await vi.importActual<typeof import("@/lib/checkout-session-status")>(
    "@/lib/checkout-session-status"
  );
  return {
    ...actual,
    getCheckoutSessionState: (...args: unknown[]) => getCheckoutSessionState(...args),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/order/confirm",
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

const FRONT_ONLY_ORDER = {
  id: "abcdef1234567890",
  status: "paid",
  totalPrice: 24.12,
  lines: [
    {
      blankId: "bella-canvas-3001",
      size: "M",
      color: "Black",
      quantity: 1,
      imageUrl: "https://img.example/front.png",
      backImageUrl: null,
    },
  ],
};

const TWO_SIDED_ORDER = {
  id: "fedcba0987654321",
  status: "paid",
  totalPrice: 32.12,
  lines: [
    {
      blankId: "bella-canvas-3001",
      size: "L",
      color: "White",
      quantity: 1,
      imageUrl: "https://img.example/front.png",
      backImageUrl: "https://img.example/back.png",
    },
  ],
};

async function renderConfirm(searchParams: Record<string, string | string[] | undefined>) {
  const ui = await ConfirmPage({ searchParams: Promise.resolve(searchParams) });
  render(ui);
}

describe("ConfirmPage", () => {
  beforeEach(() => {
    getOrderReceipt.mockReset();
    getCheckoutSessionState.mockReset();
    vi.unstubAllEnvs();
    h.session = { user: { id: "buyer", isAnonymous: false } };
  });

  it("sends a signed-out visitor to sign-in and back to the same receipt", async () => {
    h.session = null;

    await expect(renderConfirm({ session_id: "cs_1", from: "/cart" })).rejects.toThrow(
      /^NEXT_REDIRECT:/
    );

    expect(getOrderReceipt).not.toHaveBeenCalled();
    const err = await renderConfirm({ session_id: "cs_1", from: "/cart" }).catch((e) => e);
    const url = String(err.message).replace("NEXT_REDIRECT:", "");
    expect(url.startsWith("/sign-in?next=")).toBe(true);
    const next = new URL(url, "http://x").searchParams.get("next");
    expect(next).toBe("/order/confirm?session_id=cs_1&from=%2Fcart");
    expect(safeNextPath(next)).toBe(next);
  });

  it("round-trips a from that carries its own query", async () => {
    h.session = null;
    const from = "/d/x?size=M&color=Black";

    const err = await renderConfirm({ session_id: "cs_1", from }).catch((e) => e);

    const url = String(err.message).replace("NEXT_REDIRECT:", "");
    const next = new URL(url, "http://x").searchParams.get("next");
    expect(next).toBe("/order/confirm?session_id=cs_1&from=%2Fd%2Fx%3Fsize%3DM%26color%3DBlack");
    expect(safeNextPath(next)).toBe(next);
  });

  it("sends an anonymous guest session to sign-in the same way", async () => {
    h.session = { user: { id: "guest", isAnonymous: true } };

    const err = await renderConfirm({ session_id: "cs_1" }).catch((e) => e);

    expect(String(err.message)).toBe(
      `NEXT_REDIRECT:/sign-in?next=${encodeURIComponent("/order/confirm?session_id=cs_1")}`
    );
    expect(getOrderReceipt).not.toHaveBeenCalled();
  });

  it("calls getOrderReceipt once with the session id and the viewer's id, and renders the mono heading", async () => {
    h.session = { user: { id: "user-7", isAnonymous: false } };
    getOrderReceipt.mockResolvedValue(FRONT_ONLY_ORDER);

    await renderConfirm({ session_id: "cs_1" });

    expect(getOrderReceipt).toHaveBeenCalledTimes(1);
    expect(getOrderReceipt).toHaveBeenCalledWith({
      stripeSessionId: "cs_1",
      viewerId: "user-7",
    });

    const heading = screen.getByText("Order confirmed.");
    expect(heading.className).toContain("font-mono");
  });

  it("renders the short order id and only the front thumbnail when there is no back pin", async () => {
    getOrderReceipt.mockResolvedValue(FRONT_ONLY_ORDER);

    await renderConfirm({ session_id: "cs_1" });

    expect(screen.getByText("abcdef12")).toBeInTheDocument();
    expect(screen.getByAltText("Front design")).toBeInTheDocument();
    expect(screen.queryByAltText("Back design")).not.toBeInTheDocument();
  });

  it("renders both thumbnails when the line has a back pin", async () => {
    getOrderReceipt.mockResolvedValue(TWO_SIDED_ORDER);

    await renderConfirm({ session_id: "cs_2" });

    expect(screen.getByAltText("Front design")).toBeInTheDocument();
    expect(screen.getByAltText("Back design")).toBeInTheDocument();
  });

  it("renders the total in a font-mono element", async () => {
    getOrderReceipt.mockResolvedValue(FRONT_ONLY_ORDER);

    await renderConfirm({ session_id: "cs_1" });

    expect(screen.getByText("Total paid")).toBeInTheDocument();
    const amount = screen.getByText("$24.12");
    expect(amount.className).toContain("font-mono");
  });

  it("links View orders to /orders", async () => {
    getOrderReceipt.mockResolvedValue(FRONT_ONLY_ORDER);

    await renderConfirm({ session_id: "cs_1" });

    const link = screen.getByRole("link", { name: "View orders" });
    expect(link).toHaveAttribute("href", "/orders");
  });

  it("does not read a session or call getOrderReceipt, and shows Order not found., when session_id is absent", async () => {
    h.session = null;

    await renderConfirm({});

    expect(getOrderReceipt).not.toHaveBeenCalled();
    expect(screen.getByText("Order not found.")).toBeInTheDocument();
  });

  it("shows Order not found. with a recovery link to /design when the loader resolves null", async () => {
    getOrderReceipt.mockResolvedValue(null);

    await renderConfirm({ session_id: "cs_missing" });

    expect(screen.getByText("Order not found.")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Start a new design" });
    expect(link).toHaveAttribute("href", "/design");
  });

  it("does not call getOrderReceipt and shows Order not found. when session_id is an array", async () => {
    await renderConfirm({ session_id: ["a", "b"] });

    expect(getOrderReceipt).not.toHaveBeenCalled();
    expect(screen.getByText("Order not found.")).toBeInTheDocument();
  });

  it("shows the checking screen, not a receipt or a payment claim, when the order read rejects", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    getOrderReceipt.mockRejectedValue(new Error("turso blip"));

    await renderConfirm({ session_id: "cs_1", from: "/cart" });

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Payment not confirmed yet.");
    expect(
      screen.getByText(
        "Couldn't confirm it just now. Reload in a moment. A paid order appears under Orders once it's confirmed."
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reload" })).toHaveAttribute(
      "href",
      "/order/confirm?session_id=cs_1&from=%2Fcart"
    );
    expect(screen.getByRole("link", { name: "View orders" })).toHaveAttribute("href", "/orders");
    expect(screen.queryByText("Order confirmed.")).not.toBeInTheDocument();
    expect(screen.queryByText(/Your payment went through/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\$\d/)).not.toBeInTheDocument();
    expect(screen.queryByText("Order not found.")).not.toBeInTheDocument();
    expect(getCheckoutSessionState).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  const PENDING_ORDER = { ...FRONT_ONLY_ORDER, status: "pending" };

  // A switch rolled back mid-checkout must not turn an open, unpaid session
  // into "Order confirmed.", so the Stripe read runs with the switch off.
  it("switch off + pending + open hosted session: Payment not completed., resume link is the hosted url", async () => {
    vi.stubEnv("EMBEDDED_CHECKOUT_ENABLED", undefined);
    getOrderReceipt.mockResolvedValue(PENDING_ORDER);
    getCheckoutSessionState.mockResolvedValue({
      status: "open",
      uiMode: "hosted",
      url: "https://checkout.stripe.com/x",
      amountTotal: null,
    });

    await renderConfirm({ session_id: "cs_1" });

    expect(getCheckoutSessionState).toHaveBeenCalledWith("cs_1");
    expect(screen.getByText("Payment not completed.")).toBeInTheDocument();
    expect(screen.queryByText("Order confirmed.")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Return to checkout" })).toHaveAttribute(
      "href",
      "https://checkout.stripe.com/x"
    );
  });

  it("switch off + pending + open embedded session: Payment not completed., no resume link", async () => {
    vi.stubEnv("EMBEDDED_CHECKOUT_ENABLED", undefined);
    getOrderReceipt.mockResolvedValue(PENDING_ORDER);
    getCheckoutSessionState.mockResolvedValue({ status: "open", uiMode: "embedded", url: null, amountTotal: null });

    await renderConfirm({ session_id: "cs_1" });

    expect(screen.getByText("Payment not completed.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Return to checkout" })).not.toBeInTheDocument();
  });

  it("switch off + pending + complete session: Order confirmed.", async () => {
    vi.stubEnv("EMBEDDED_CHECKOUT_ENABLED", undefined);
    getOrderReceipt.mockResolvedValue(PENDING_ORDER);
    getCheckoutSessionState.mockResolvedValue({ status: "complete", uiMode: "hosted", url: null, amountTotal: null });

    await renderConfirm({ session_id: "cs_1" });

    expect(getCheckoutSessionState).toHaveBeenCalledWith("cs_1");
    expect(screen.getByText("Order confirmed.")).toBeInTheDocument();
  });

  it("switch off + paid order: never calls the Stripe helper", async () => {
    vi.stubEnv("EMBEDDED_CHECKOUT_ENABLED", undefined);
    getOrderReceipt.mockResolvedValue(FRONT_ONLY_ORDER);

    await renderConfirm({ session_id: "cs_1" });

    expect(getCheckoutSessionState).not.toHaveBeenCalled();
    expect(screen.getByText("Order confirmed.")).toBeInTheDocument();
  });

  it("flag on + paid order: never calls the Stripe helper", async () => {
    vi.stubEnv("EMBEDDED_CHECKOUT_ENABLED", "true");
    getOrderReceipt.mockResolvedValue(FRONT_ONLY_ORDER);

    await renderConfirm({ session_id: "cs_1" });

    expect(getCheckoutSessionState).not.toHaveBeenCalled();
    expect(screen.getByText("Order confirmed.")).toBeInTheDocument();
  });

  it("flag on + pending + open embedded session: shows Payment not completed. with a Return to checkout link", async () => {
    vi.stubEnv("EMBEDDED_CHECKOUT_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_abc123");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_abc123");
    getOrderReceipt.mockResolvedValue(PENDING_ORDER);
    getCheckoutSessionState.mockResolvedValue({ status: "open", uiMode: "embedded", url: null, amountTotal: null });

    await renderConfirm({ session_id: "cs_1" });

    expect(getCheckoutSessionState).toHaveBeenCalledWith("cs_1");
    expect(screen.getByText("Payment not completed.")).toBeInTheDocument();
    expect(screen.getByText("Nothing was charged.")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Return to checkout" });
    expect(link).toHaveAttribute("href", "/checkout?session=cs_1&from=%2Fshop");
  });

  it.each([
    ["/cart", "/checkout?session=cs_1&from=%2Fcart"],
    ["//evil.example", "/checkout?session=cs_1&from=%2Fshop"],
  ])("open embedded session with from=%s in the URL: the resume link is %s", async (from, href) => {
    vi.stubEnv("EMBEDDED_CHECKOUT_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_abc123");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_abc123");
    getOrderReceipt.mockResolvedValue(PENDING_ORDER);
    getCheckoutSessionState.mockResolvedValue({ status: "open", uiMode: "embedded", url: null, amountTotal: null });

    await renderConfirm({ session_id: "cs_1", from });

    expect(screen.getByRole("link", { name: "Return to checkout" })).toHaveAttribute("href", href);
  });

  it("flag on + pending + open embedded session but no publishable key configured: no Return to checkout link", async () => {
    // A usable /checkout page needs a real key pair too
    // (embeddedCheckoutConfig()) — with the key missing, resumeHref must
    // come back null rather than pointing at a page that can't render.
    vi.stubEnv("EMBEDDED_CHECKOUT_ENABLED", "true");
    getOrderReceipt.mockResolvedValue(PENDING_ORDER);
    getCheckoutSessionState.mockResolvedValue({ status: "open", uiMode: "embedded", url: null, amountTotal: null });

    await renderConfirm({ session_id: "cs_1" });

    expect(screen.getByText("Payment not completed.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Return to checkout" })).not.toBeInTheDocument();
  });

  it("flag on + pending + open hosted session with a url: Return to checkout links to that url", async () => {
    vi.stubEnv("EMBEDDED_CHECKOUT_ENABLED", "true");
    getOrderReceipt.mockResolvedValue(PENDING_ORDER);
    getCheckoutSessionState.mockResolvedValue({
      status: "open",
      uiMode: "hosted",
      url: "https://checkout.stripe.com/x",
      amountTotal: null,
    });

    await renderConfirm({ session_id: "cs_1" });

    expect(screen.getByText("Payment not completed.")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Return to checkout" });
    expect(link).toHaveAttribute("href", "https://checkout.stripe.com/x");
  });

  it("flag on + pending + complete session: shows Order confirmed.", async () => {
    vi.stubEnv("EMBEDDED_CHECKOUT_ENABLED", "true");
    getOrderReceipt.mockResolvedValue(PENDING_ORDER);
    getCheckoutSessionState.mockResolvedValue({ status: "complete", uiMode: "embedded", url: null, amountTotal: null });

    await renderConfirm({ session_id: "cs_1" });

    expect(screen.getByText("Order confirmed.")).toBeInTheDocument();
  });

  it("flag on + pending + expired session: shows the expired copy with a Back to Shop link, no Return to checkout", async () => {
    vi.stubEnv("EMBEDDED_CHECKOUT_ENABLED", "true");
    getOrderReceipt.mockResolvedValue(PENDING_ORDER);
    getCheckoutSessionState.mockResolvedValue({ status: "expired", uiMode: "embedded", url: null, amountTotal: null });

    await renderConfirm({ session_id: "cs_1" });

    expect(screen.getByText("This checkout expired.")).toBeInTheDocument();
    expect(screen.getByText("Nothing was charged.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Return to checkout" })).not.toBeInTheDocument();
    const backLink = screen.getByRole("link", { name: "Back to Shop" });
    expect(backLink).toHaveAttribute("href", "/shop");
  });

  it("pending + helper returns null: Payment not confirmed yet., Reload and View orders, no receipt (#317 item 1)", async () => {
    vi.stubEnv("EMBEDDED_CHECKOUT_ENABLED", "true");
    getOrderReceipt.mockResolvedValue(PENDING_ORDER);
    getCheckoutSessionState.mockResolvedValue(null);

    await renderConfirm({ session_id: "cs_1", from: "/cart" });

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Payment not confirmed yet.");
    expect(
      screen.getByText(
        "Couldn't confirm it just now. Reload in a moment. A paid order appears under Orders once it's confirmed."
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reload" })).toHaveAttribute(
      "href",
      "/order/confirm?session_id=cs_1&from=%2Fcart"
    );
    expect(screen.getByRole("link", { name: "View orders" })).toHaveAttribute("href", "/orders");
    expect(screen.queryByText("Total paid")).not.toBeInTheDocument();
    expect(screen.queryByText("Order confirmed.")).not.toBeInTheDocument();
    expect(screen.queryByText(/\$\d/)).not.toBeInTheDocument();
  });

  it("shows Order not found. for a viewer who does not own the order (loader returns null)", async () => {
    getOrderReceipt.mockResolvedValue(null);

    await renderConfirm({ session_id: "cs_1" });

    expect(screen.getByText("Order not found.")).toBeInTheDocument();
    expect(screen.queryByText("Order confirmed.")).not.toBeInTheDocument();
  });

  it("pending + complete + paid: prints Stripe's charged total, not the stored pre-discount one (#317)", async () => {
    vi.stubEnv("EMBEDDED_CHECKOUT_ENABLED", "true");
    getOrderReceipt.mockResolvedValue(PENDING_ORDER);
    getCheckoutSessionState.mockResolvedValue({
      status: "complete",
      paymentStatus: "paid",
      uiMode: "embedded",
      url: null,
      amountTotal: 1912,
    });

    await renderConfirm({ session_id: "cs_1" });

    expect(screen.getByText("Order confirmed.")).toBeInTheDocument();
    expect(screen.getByText("$19.12")).toBeInTheDocument();
    expect(screen.queryByText("$24.12")).not.toBeInTheDocument();
  });

  it("pending + complete + paid with no amount_total: falls back to the stored total", async () => {
    vi.stubEnv("EMBEDDED_CHECKOUT_ENABLED", "true");
    getOrderReceipt.mockResolvedValue(PENDING_ORDER);
    getCheckoutSessionState.mockResolvedValue({
      status: "complete",
      paymentStatus: "paid",
      uiMode: "embedded",
      url: null,
      amountTotal: null,
    });

    await renderConfirm({ session_id: "cs_1" });

    expect(screen.getByText("$24.12")).toBeInTheDocument();
  });

  it("a paid order prints its stored (webhook-reconciled) total with no Stripe read", async () => {
    getOrderReceipt.mockResolvedValue({ ...FRONT_ONLY_ORDER, totalPrice: 19.12 });

    await renderConfirm({ session_id: "cs_1" });

    expect(getCheckoutSessionState).not.toHaveBeenCalled();
    expect(screen.getByText("$19.12")).toBeInTheDocument();
  });
  describe("delayed payment (#272)", () => {
    const PENDING = { ...FRONT_ONLY_ORDER, status: "pending", abandoned: false };
    const complete = (paymentStatus: string) => ({
      status: "complete",
      paymentStatus,
      uiMode: "hosted",
      url: null,
      amountTotal: null,
    });

    it("shows Payment still processing for a pending order on a complete, unpaid session", async () => {
      getOrderReceipt.mockResolvedValue(PENDING);
      getCheckoutSessionState.mockResolvedValue(complete("unpaid"));

      await renderConfirm({ session_id: "cs_1" });

      const heading = screen.getByRole("heading", { level: 1 });
      expect(heading.textContent).toBe("Payment still processing");
      expect(heading.className).toContain("font-mono");
      expect(screen.queryByText("Order confirmed.")).not.toBeInTheDocument();
      expect(screen.queryByText("Total paid")).not.toBeInTheDocument();
      expect(screen.queryByText(/\$\d/)).not.toBeInTheDocument();
      expect(
        screen.getByText("Your order will be placed once the payment clears.")
      ).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Return to checkout" })).not.toBeInTheDocument();
    });

    it("treats an unknown payment_status like unpaid", async () => {
      getOrderReceipt.mockResolvedValue(PENDING);
      getCheckoutSessionState.mockResolvedValue(complete("requires_review"));

      await renderConfirm({ session_id: "cs_1" });

      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Payment still processing");
    });

    it("shows the not-completed state, not confirmed or processing, once the async payment failed", async () => {
      getOrderReceipt.mockResolvedValue({ ...PENDING, abandoned: true });
      getCheckoutSessionState.mockResolvedValue(complete("unpaid"));

      await renderConfirm({ session_id: "cs_1" });

      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Payment not completed.");
      expect(screen.getByText("The payment didn't go through.")).toBeInTheDocument();
      expect(screen.queryByText("Nothing was charged.")).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Return to checkout" })).not.toBeInTheDocument();
      expect(screen.queryByText("Total paid")).not.toBeInTheDocument();
      expect(screen.queryByText(/\$\d/)).not.toBeInTheDocument();
      expect(screen.queryByText("Order confirmed.")).not.toBeInTheDocument();
      expect(screen.queryByText("Payment still processing")).not.toBeInTheDocument();
    });

    it("shows Order confirmed. for a pending order on a complete, paid session", async () => {
      getOrderReceipt.mockResolvedValue(PENDING);
      getCheckoutSessionState.mockResolvedValue(complete("paid"));

      await renderConfirm({ session_id: "cs_1" });

      expect(screen.getByText("Order confirmed.")).toBeInTheDocument();
    });

    it("shows Order confirmed. once the webhook has claimed the order, with no Stripe read", async () => {
      getOrderReceipt.mockResolvedValue({ ...FRONT_ONLY_ORDER, abandoned: false });

      await renderConfirm({ session_id: "cs_1" });

      expect(getCheckoutSessionState).not.toHaveBeenCalled();
      expect(screen.getByText("Order confirmed.")).toBeInTheDocument();
    });
  });
});
