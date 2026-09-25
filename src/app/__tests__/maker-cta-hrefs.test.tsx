/**
 * Every "make something" CTA points at `/studio`, the maker surface.
 *
 * History: owner ruling W1 (PR #219,
 * docs/superpowers/plans/2026-09-07-paper-orders-cart-confirm.md) pointed the
 * two `/cart` CTAs at `/design`, because `/studio` bounced an anonymous
 * guest-funnel session to sign-in while `/cart` is guest-reachable
 * (`e2e/cart.spec.ts` buys as a guest). #241 opened the Studio to guest
 * sessions and reversed W1 (Nico, 2026-09-25), so the cart now matches
 * `/orders`.
 *
 * This file exists so a future nav sweep that retargets make-CTAs has to
 * change it on purpose. It pins all three:
 *
 *   1. /orders empty-state action "Make your first design" → /studio
 *   2. /cart empty-state action "Start a design"   → /studio
 *   3. /cart "Add another design" (a router.push)  → /studio
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

describe("maker-CTA hrefs (#241: cart and orders → /studio)", () => {
  it("/orders empty-state action 'Make your first design' points at /studio", () => {
    render(<OrdersList orders={[]} />);

    expect(
      screen.getByRole("link", { name: "Make your first design" })
    ).toHaveAttribute("href", "/studio");
  });

  it("/cart empty-state action 'Start a design' points at /studio", async () => {
    getCart.mockResolvedValue(EMPTY_CART);
    render(<CartPage />);

    const link = await screen.findByRole("link", { name: "Start a design" });
    expect(link).toHaveAttribute("href", "/studio");
  });

  it("/cart 'Add another design' navigates to /studio via the router", async () => {
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
    expect(push).toHaveBeenCalledWith("/studio");
  });
});
