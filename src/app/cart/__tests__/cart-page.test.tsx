/**
 * A cart that failed to load must not read as an empty cart. The old fallback
 * rendered "Your cart is empty." after five silent failures, which is both a
 * lie to the customer and invisible to the e2e suite.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { CartView } from "../actions";
import CartPage from "../page";

const getCart = vi.fn();

vi.mock("../actions", () => ({
  getCart: (...args: unknown[]) => getCart(...args),
  removeCartItem: vi.fn(),
  checkoutCart: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const EMPTY: CartView = { items: [], itemSubtotal: 0, shipping: 0, total: 0 };

const ONE_ITEM: CartView = {
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

beforeEach(() => {
  getCart.mockReset();
});

describe("CartPage load states", () => {
  it("shows the empty state for a genuinely empty cart", async () => {
    getCart.mockResolvedValue(EMPTY);
    render(<CartPage />);

    expect(await screen.findByText("Your cart is empty.")).toBeInTheDocument();
    expect(screen.queryByTestId("cart-load-error")).not.toBeInTheDocument();
  });

  it("shows an error, not an empty cart, when every load attempt fails", async () => {
    getCart.mockRejectedValue(new Error("boom"));
    render(<CartPage />);

    expect(await screen.findByTestId("cart-load-error")).toBeInTheDocument();
    expect(screen.getByText("Couldn't load your cart.")).toBeInTheDocument();
    expect(screen.queryByText("Your cart is empty.")).not.toBeInTheDocument();
  });

  it("recovers on Retry", async () => {
    getCart
      .mockRejectedValueOnce(new Error("boom"))
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(ONE_ITEM);
    render(<CartPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));

    await waitFor(() =>
      expect(screen.getAllByTestId("cart-line-item")).toHaveLength(1)
    );
    expect(screen.queryByTestId("cart-load-error")).not.toBeInTheDocument();
  });

  it("absorbs a single transient failure without surfacing an error", async () => {
    getCart.mockRejectedValueOnce(new Error("boom")).mockResolvedValue(ONE_ITEM);
    render(<CartPage />);

    await waitFor(() =>
      expect(screen.getAllByTestId("cart-line-item")).toHaveLength(1)
    );
    expect(screen.queryByTestId("cart-load-error")).not.toBeInTheDocument();
  });
});
