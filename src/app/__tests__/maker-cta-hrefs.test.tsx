/**
 * Where each "make something" CTA points, and why one of them differs.
 *
 * History: owner ruling W1 (PR #219,
 * docs/superpowers/plans/2026-09-07-paper-orders-cart-confirm.md) pointed the
 * two `/cart` CTAs at `/design`, because `/studio` bounced an anonymous
 * guest-funnel session to sign-in while `/cart` is guest-reachable
 * (`e2e/cart.spec.ts` buys as a guest). #241 opened the Studio to guest
 * sessions (Nico, 2026-09-25) and reversed W1 — except for the empty cart
 * (controller ruling, #241 fix round): an empty cart is what a first-time
 * visitor with NO session sees, and middleware sends a sessionless /studio
 * request to /sign-in, while /design is open and mints the guest session.
 * A cart with lines implies a session, so "Add another design" follows the
 * rest of the site to /studio.
 *
 * This file exists so a future nav sweep that retargets make-CTAs has to
 * change it on purpose. It pins all three:
 *
 *   1. /orders empty-state action "Make your first design" → /studio
 *   2. /cart empty-state action "Start a design"   → /design (W1 survives)
 *   3. /cart "Add another design" (a router.push)  → /studio
 *
 * The sessionless half of (2) — /cart and /design reachable with no cookie,
 * /studio not — is pinned in src/__tests__/middleware.test.ts.
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

describe("maker-CTA hrefs (#241: /studio everywhere but the empty cart)", () => {
  it("/orders empty-state action 'Make your first design' points at /studio", () => {
    render(<OrdersList orders={[]} />);

    expect(
      screen.getByRole("link", { name: "Make your first design" })
    ).toHaveAttribute("href", "/studio");
  });

  it("/cart empty-state action 'Start a design' points at /design (W1 survives for the empty cart)", async () => {
    getCart.mockResolvedValue(EMPTY_CART);
    render(<CartPage />);

    const link = await screen.findByRole("link", { name: "Start a design" });
    expect(link).toHaveAttribute("href", "/design");
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
