/**
 * Owner ruling W1 (docs/superpowers/plans/2026-09-07-paper-orders-cart-confirm.md):
 *
 * `/cart` "make something" CTAs point at `/design`, not `/studio`, because
 * `/studio` sits behind `requireRealUser` and bounces an anonymous guest,
 * while `/cart` is a guest-reachable surface (`e2e/cart.spec.ts` buys as a
 * guest). `/orders` is itself behind `requireRealUser`, so its CTAs point at
 * `/studio` (the maker surface) — W1 does not apply there (reversal recorded
 * in the slice ledger).
 *
 * This file exists so a future nav sweep that blanket-retargets make-CTAs
 * fails here loudly, instead of silently walling a guest out of the purchase
 * path or sending a signed-in user off the Studio. It pins all three:
 *
 *   1. /orders empty-state action "Make your first design" → /studio
 *   2. /cart empty-state action "Start a design"   → /design
 *   3. /cart "Add another design" (a router.push)  → /design
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OrdersList } from "../orders/orders-list";
import type { UserOrder } from "@/lib/user-orders";
import CartPage from "../cart/page";
import type { CartView } from "../cart/actions";

const getCart = vi.fn();
const push = vi.fn();

vi.mock("../cart/actions", () => ({
  getCart: (...args: unknown[]) => getCart(...args),
  removeCartItem: vi.fn(),
  checkoutCart: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));

beforeEach(() => {
  getCart.mockReset();
  push.mockReset();
});

const LINE: UserOrder["lines"][number] = {
  designId: "d1",
  blankId: "bella-canvas-3001",
  size: "M",
  color: "White",
  quantity: 1,
  imageUrl: "https://img.example/front.png",
  backImageUrl: null,
  designedByName: null,
};

function makeOrder(): UserOrder {
  return {
    id: "order-1",
    status: "paid",
    totalPrice: 27.43,
    trackingNumber: null,
    trackingUrl: null,
    createdAt: new Date("2026-09-01"),
    archivedAt: null,
    displayName: null,
    lines: [LINE],
  };
}

const EMPTY_CART: CartView = { items: [], itemSubtotal: 0, shipping: 0, total: 0 };

describe("maker-CTA hrefs (ruling W1: cart → /design; orders → /studio)", () => {
  it("/orders empty-state action 'Make your first design' points at /studio", () => {
    render(<OrdersList orders={[]} />);

    expect(
      screen.getByRole("link", { name: "Make your first design" })
    ).toHaveAttribute("href", "/studio");
  });

  it("/cart empty-state action 'Start a design' points at /design", async () => {
    getCart.mockResolvedValue(EMPTY_CART);
    render(<CartPage />);

    const link = await screen.findByRole("link", { name: "Start a design" });
    expect(link).toHaveAttribute("href", "/design");
  });

  it("/cart 'Add another design' navigates to /design via the router", async () => {
    const oneItemCart: CartView = {
      items: [
        {
          id: "line-1",
          designId: "d1",
          productId: "bella-canvas-3001",
          productName: "Classic Tee",
          size: "M",
          color: "Black",
          placements: null,
          hasBack: false,
          quantity: 1,
          unitPrice: 19.43,
          imageUrl: null,
        },
      ],
      itemSubtotal: 19.43,
      shipping: 4.69,
      total: 24.12,
    };
    getCart.mockResolvedValue(oneItemCart);
    render(<CartPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Add another design" })
    );
    expect(push).toHaveBeenCalledWith("/design");
  });
});
