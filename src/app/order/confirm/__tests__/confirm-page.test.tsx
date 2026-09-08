/**
 * /order/confirm is now an async server component: it awaits `searchParams`
 * and calls `getOrderBySession` directly (no client fetch, no Loading…
 * paint). These tests call the exported async function like any other
 * server-side helper and render what it returns — see the plan's Task 3.
 *
 * `Breadcrumbs` is a client island rendered on the page, so `next/navigation`
 * is mocked with both `useRouter` (Breadcrumbs calls it) and `usePathname`
 * (not used here, but mocked per the plan so the module shape is complete).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import ConfirmPage from "../page";

const getOrderBySession = vi.fn();

vi.mock("../actions", () => ({
  getOrderBySession: (...args: unknown[]) => getOrderBySession(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/order/confirm",
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
    getOrderBySession.mockReset();
  });

  it("calls getOrderBySession once with the session id and renders the mono heading", async () => {
    getOrderBySession.mockResolvedValue(FRONT_ONLY_ORDER);

    await renderConfirm({ session_id: "cs_1" });

    expect(getOrderBySession).toHaveBeenCalledTimes(1);
    expect(getOrderBySession).toHaveBeenCalledWith("cs_1");

    const heading = screen.getByText("Order confirmed.");
    expect(heading.className).toContain("font-mono");
  });

  it("renders the short order id and only the front thumbnail when there is no back pin", async () => {
    getOrderBySession.mockResolvedValue(FRONT_ONLY_ORDER);

    await renderConfirm({ session_id: "cs_1" });

    expect(screen.getByText("abcdef12")).toBeInTheDocument();
    expect(screen.getByAltText("Front design")).toBeInTheDocument();
    expect(screen.queryByAltText("Back design")).not.toBeInTheDocument();
  });

  it("renders both thumbnails when the line has a back pin", async () => {
    getOrderBySession.mockResolvedValue(TWO_SIDED_ORDER);

    await renderConfirm({ session_id: "cs_2" });

    expect(screen.getByAltText("Front design")).toBeInTheDocument();
    expect(screen.getByAltText("Back design")).toBeInTheDocument();
  });

  it("renders the total in a font-mono element", async () => {
    getOrderBySession.mockResolvedValue(FRONT_ONLY_ORDER);

    await renderConfirm({ session_id: "cs_1" });

    expect(screen.getByText("Total paid")).toBeInTheDocument();
    const amount = screen.getByText("$24.12");
    expect(amount.className).toContain("font-mono");
  });

  it("links View orders to /orders", async () => {
    getOrderBySession.mockResolvedValue(FRONT_ONLY_ORDER);

    await renderConfirm({ session_id: "cs_1" });

    const link = screen.getByRole("link", { name: "View orders" });
    expect(link).toHaveAttribute("href", "/orders");
  });

  it("does not call getOrderBySession and shows Order not found. when session_id is absent", async () => {
    await renderConfirm({});

    expect(getOrderBySession).not.toHaveBeenCalled();
    expect(screen.getByText("Order not found.")).toBeInTheDocument();
  });

  it("shows Order not found. with a recovery link to /design when the loader resolves null", async () => {
    getOrderBySession.mockResolvedValue(null);

    await renderConfirm({ session_id: "cs_missing" });

    expect(screen.getByText("Order not found.")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Start a new design" });
    expect(link).toHaveAttribute("href", "/design");
  });

  it("does not call getOrderBySession and shows Order not found. when session_id is an array", async () => {
    await renderConfirm({ session_id: ["a", "b"] });

    expect(getOrderBySession).not.toHaveBeenCalled();
    expect(screen.getByText("Order not found.")).toBeInTheDocument();
  });

  it("shows a receipt-unavailable state, not Order not found., when the loader rejects", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    getOrderBySession.mockRejectedValue(new Error("turso blip"));

    await renderConfirm({ session_id: "cs_1" });

    expect(screen.getByText("Order confirmed.")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The receipt couldn't be loaded. Your payment went through. The order appears under Orders once it's confirmed."
      )
    ).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "View orders" });
    expect(link).toHaveAttribute("href", "/orders");
    expect(screen.queryByText("Order not found.")).not.toBeInTheDocument();
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});
