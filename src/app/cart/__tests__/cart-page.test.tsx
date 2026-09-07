/**
 * A cart that failed to load must not read as an empty cart. The old fallback
 * rendered "Your cart is empty." after five silent failures, which is both a
 * lie to the customer and invisible to the e2e suite.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import type { CartView } from "../actions";
import CartPage from "../page";

const getCart = vi.fn();
const push = vi.fn();

vi.mock("../actions", () => ({
  getCart: (...args: unknown[]) => getCart(...args),
  removeCartItem: vi.fn(),
  checkoutCart: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
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

// A separate fixture (rather than mutating ONE_ITEM) so the null-imageUrl
// case above keeps proving no placeholder <img> is ever emitted.
const ONE_ITEM_WITH_IMAGE: CartView = {
  ...ONE_ITEM,
  items: [{ ...ONE_ITEM.items[0], imageUrl: "https://example.com/art.png" }],
};

beforeEach(() => {
  getCart.mockReset();
  push.mockReset();
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

describe("CartPage row shape (Paper)", () => {
  it("renders exactly one img inside the cart line when the item has an image", async () => {
    getCart.mockResolvedValue(ONE_ITEM_WITH_IMAGE);
    render(<CartPage />);

    const item = await screen.findByTestId("cart-line-item");
    expect(within(item).getAllByRole("img")).toHaveLength(1);
  });

  it("renders no img inside the cart line when the item has no image", async () => {
    getCart.mockResolvedValue(ONE_ITEM);
    render(<CartPage />);

    const item = await screen.findByTestId("cart-line-item");
    expect(within(item).queryAllByRole("img")).toHaveLength(0);
  });

  it("the checkout button's accessible name starts with Checkout", async () => {
    getCart.mockResolvedValue(ONE_ITEM);
    render(<CartPage />);

    expect(
      await screen.findByRole("button", { name: /^Checkout/ })
    ).toBeInTheDocument();
  });

  it("renders Items, Shipping (bundled) and Total rows with the total in a mono element", async () => {
    getCart.mockResolvedValue(ONE_ITEM);
    render(<CartPage />);

    expect(await screen.findByText("Items")).toBeInTheDocument();
    expect(screen.getByText("Shipping (bundled)")).toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
    const totalAmount = screen.getByText("$24.12");
    expect(totalAmount.className).toContain("font-mono");
  });

  it("the empty-state action links to /design", async () => {
    getCart.mockResolvedValue(EMPTY);
    render(<CartPage />);

    const link = await screen.findByRole("link", { name: "Start a design" });
    expect(link).toHaveAttribute("href", "/design");
  });

  it("Add another design pushes to /design via the router", async () => {
    getCart.mockResolvedValue(ONE_ITEM);
    render(<CartPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Add another design" })
    );
    expect(push).toHaveBeenCalledWith("/design");
  });
});
