/**
 * A cart that failed to load must not read as an empty cart. The old fallback
 * rendered "Your cart is empty." after five silent failures, which is both a
 * lie to the customer and invisible to the e2e suite.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import type { CartView } from "../actions";
import CartPage from "../page";
import {
  CHECKOUT_FAILED,
  CART_LINE_UNAVAILABLE,
  CART_TOO_FULL_TO_CHECKOUT,
} from "@/lib/action-copy";
import { CART_MAX_LINES } from "@/lib/cart-line-edit";

const getCart = vi.fn();
const removeCartItem = vi.fn();
const setCartItemQuantity = vi.fn();
const checkoutCart = vi.fn();
const push = vi.fn();

vi.mock("../actions", () => ({
  getCart: (...args: unknown[]) => getCart(...args),
  removeCartItem: (...args: unknown[]) => removeCartItem(...args),
  checkoutCart: (...args: unknown[]) => checkoutCart(...args),
  setCartItemQuantity: (...args: unknown[]) => setCartItemQuantity(...args),
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
      backImageUrl: null,
      unavailable: false,
      editHref: null,
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
  removeCartItem.mockReset();
  setCartItemQuantity.mockReset();
  checkoutCart.mockReset();
  getCart.mockReset();
  push.mockReset();
});

describe("CartPage load states", () => {
  it("titles the page with the mono masthead (#188 slice 8)", async () => {
    getCart.mockResolvedValue(EMPTY);
    render(<CartPage />);

    const h1 = await screen.findByRole("heading", { level: 1, name: "Your cart" });
    expect(h1).toHaveClass(
      "font-mono",
      "text-[11px]",
      "uppercase",
      "text-text-muted",
    );
    expect(h1).not.toHaveClass("font-bold");
  });

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

    // A DOM query rather than getAllByRole("img"): the thumbnail is
    // decorative-when-labeled (alt=""), which HTML-AAM maps to
    // role="presentation" — a role query would miss it. e2e/cart.spec.ts
    // counts the same way (.locator("img"), alt-agnostic).
    const item = await screen.findByTestId("cart-line-item");
    expect(item.querySelectorAll("img")).toHaveLength(1);
  });

  it("renders no img inside the cart line when the item has no image", async () => {
    getCart.mockResolvedValue(ONE_ITEM);
    render(<CartPage />);

    const item = await screen.findByTestId("cart-line-item");
    expect(item.querySelectorAll("img")).toHaveLength(0);
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

  // #241: the empty cart keeps ruling W1 (/design, which a visitor with no
  // session can reach and which mints the guest session); a cart with lines
  // implies a session, so "Add another design" goes to /studio. History in
  // src/app/__tests__/maker-cta-hrefs.test.tsx.
  it("the empty-state action links to /design", async () => {
    getCart.mockResolvedValue(EMPTY);
    render(<CartPage />);

    const link = await screen.findByRole("link", { name: "Start a design" });
    expect(link).toHaveAttribute("href", "/design");
  });

  it("Add another design pushes to /studio via the router", async () => {
    getCart.mockResolvedValue(ONE_ITEM);
    render(<CartPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Add another design" })
    );
    expect(push).toHaveBeenCalledWith("/studio");
  });

  it("shows the back design beside the front on a two-sided line (#282)", async () => {
    getCart.mockResolvedValue({
      ...ONE_ITEM,
      items: [
        {
          ...ONE_ITEM.items[0],
          hasBack: true,
          imageUrl: "https://example.com/front.png",
          backImageUrl: "https://example.com/back.png",
        },
      ],
    });
    render(<CartPage />);
    const back = await screen.findByTestId("cart-line-back");
    expect(back.querySelector("img")?.getAttribute("src")).toBe(
      "https://example.com/back.png"
    );
  });

  it("shows one thumbnail on a front-only line", async () => {
    getCart.mockResolvedValue(ONE_ITEM_WITH_IMAGE);
    render(<CartPage />);
    await screen.findByTestId("cart-line-item");
    expect(screen.queryByTestId("cart-line-back")).not.toBeInTheDocument();
  });
});

describe("CartPage unavailable lines (one buy surface, slice 3)", () => {
  const STALE: CartView = {
    ...ONE_ITEM,
    items: [{ ...ONE_ITEM.items[0], unavailable: true }],
  };

  it("labels a line that is no longer available, and not a good one", async () => {
    getCart.mockResolvedValue({
      ...ONE_ITEM,
      items: [
        { ...ONE_ITEM.items[0], id: "good" },
        { ...ONE_ITEM.items[0], id: "bad", unavailable: true },
      ],
    });
    render(<CartPage />);
    const labels = await screen.findAllByTestId("cart-line-unavailable");
    expect(labels).toHaveLength(1);
    expect(labels[0]).toHaveTextContent("No longer available");
    expect(screen.getAllByTestId("cart-line-item")).toHaveLength(2);
  });

  it("an unavailable line with no image URLs renders no thumbnail image", async () => {
    getCart.mockResolvedValue({
      ...ONE_ITEM,
      items: [{ ...ONE_ITEM.items[0], unavailable: true, imageUrl: null, backImageUrl: null }],
    });
    render(<CartPage />);
    const line = await screen.findByTestId("cart-line-item");
    expect(line.querySelector("img")).toBeNull();
    expect(screen.queryByTestId("cart-line-back")).not.toBeInTheDocument();
    expect(screen.getByTestId("cart-line-unavailable")).toHaveTextContent("No longer available");
  });

  it("shows no label for a valid line", async () => {
    getCart.mockResolvedValue(ONE_ITEM);
    render(<CartPage />);
    await screen.findByTestId("cart-line-item");
    expect(screen.queryByTestId("cart-line-unavailable")).not.toBeInTheDocument();
  });

  it("Remove keeps working on a flagged line", async () => {
    getCart.mockResolvedValueOnce(STALE).mockResolvedValue(EMPTY);
    removeCartItem.mockResolvedValue(undefined);
    render(<CartPage />);
    await screen.findByTestId("cart-line-unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(removeCartItem).toHaveBeenCalledWith("line-1"));
    expect(await screen.findByText("Your cart is empty.")).toBeInTheDocument();
  });

  it("a line that is no longer available: the notice shows on load, Checkout is disabled and never calls the action", async () => {
    getCart.mockResolvedValue(STALE);
    render(<CartPage />);
    await screen.findByTestId("cart-line-unavailable");

    expect(screen.getByTestId("cart-checkout-error")).toHaveTextContent(
      CART_LINE_UNAVAILABLE
    );
    const button = screen.getByRole("button", { name: /^Checkout/ });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(checkoutCart).not.toHaveBeenCalled();
  });

  it("removing the unavailable line clears the notice and re-enables Checkout", async () => {
    const OK_AND_STALE: CartView = {
      ...STALE,
      items: [
        { ...ONE_ITEM.items[0], id: "ok" },
        { ...STALE.items[0], id: "gone" },
      ],
    };
    getCart.mockResolvedValueOnce(OK_AND_STALE).mockResolvedValue(ONE_ITEM);
    removeCartItem.mockResolvedValue(undefined);
    render(<CartPage />);
    await screen.findByTestId("cart-line-unavailable");

    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[1]);

    await waitFor(() =>
      expect(screen.queryByTestId("cart-checkout-error")).not.toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: /^Checkout/ })).toBeEnabled();
  });

  it("a cart with no unavailable line shows no notice and an enabled Checkout", async () => {
    getCart.mockResolvedValue(ONE_ITEM);
    render(<CartPage />);
    await screen.findByTestId("cart-line-item");
    expect(screen.queryByTestId("cart-checkout-error")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Checkout/ })).toBeEnabled();
  });
});

describe("CartPage cart line cap (#316)", () => {
  function cartOf(lines: number): CartView {
    return {
      ...ONE_ITEM,
      items: Array.from({ length: lines }, (_, i) => ({ ...ONE_ITEM.items[0], id: `line-${i}` })),
    };
  }

  it("a cart over the cap: the notice shows on load, Checkout is disabled and never calls the action", async () => {
    getCart.mockResolvedValue(cartOf(CART_MAX_LINES + 1));
    render(<CartPage />);
    await screen.findAllByTestId("cart-line-item");

    expect(screen.getByTestId("cart-checkout-error")).toHaveTextContent(
      CART_TOO_FULL_TO_CHECKOUT
    );
    const button = screen.getByRole("button", { name: /^Checkout/ });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(checkoutCart).not.toHaveBeenCalled();
  });

  it("a cart of exactly the cap shows no notice and an enabled Checkout", async () => {
    getCart.mockResolvedValue(cartOf(CART_MAX_LINES));
    render(<CartPage />);
    await screen.findAllByTestId("cart-line-item");
    expect(screen.queryByTestId("cart-checkout-error")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Checkout/ })).toBeEnabled();
  });

  it("a cap refusal from the server does not re-read the cart", async () => {
    getCart.mockResolvedValue(ONE_ITEM);
    checkoutCart.mockResolvedValue({ url: null, error: CART_TOO_FULL_TO_CHECKOUT });
    render(<CartPage />);

    fireEvent.click(await screen.findByRole("button", { name: /^Checkout/ }));

    expect(await screen.findByTestId("cart-checkout-error")).toHaveTextContent(
      CART_TOO_FULL_TO_CHECKOUT
    );
    expect(getCart).toHaveBeenCalledTimes(1);
  });

  it("an unavailable-line refusal still re-reads the cart", async () => {
    getCart.mockResolvedValue(ONE_ITEM);
    checkoutCart.mockResolvedValue({ url: null, error: CART_LINE_UNAVAILABLE });
    render(<CartPage />);

    fireEvent.click(await screen.findByRole("button", { name: /^Checkout/ }));

    await screen.findByTestId("cart-checkout-error");
    await waitFor(() => expect(getCart).toHaveBeenCalledTimes(2));
  });
});

describe("cart line controls (#282)", () => {
  const WITH_EDIT: CartView = {
    ...ONE_ITEM_WITH_IMAGE,
    items: [{ ...ONE_ITEM_WITH_IMAGE.items[0], editHref: "/d/img-1?order=1&size=M&line=line-1&from=%2Fcart" }],
  };

  it("renders an Edit link and links the thumbnail to the same place", async () => {
    getCart.mockResolvedValue(WITH_EDIT);
    render(<CartPage />);
    const edit = await screen.findByRole("link", { name: "Edit" });
    expect(edit).toHaveAttribute("href", WITH_EDIT.items[0].editHref);
    const thumbLink = screen.getByTestId("cart-line-thumb-link");
    expect(thumbLink).toHaveAttribute("href", WITH_EDIT.items[0].editHref);
  });

  it("no Edit link on a line without one, or on an unavailable line", async () => {
    getCart.mockResolvedValue({
      ...WITH_EDIT,
      items: [
        { ...WITH_EDIT.items[0], id: "a", editHref: null },
        { ...WITH_EDIT.items[0], id: "b", unavailable: true },
      ],
    });
    render(<CartPage />);
    await screen.findAllByTestId("cart-line-item");
    expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("the stepper shows the quantity and calls setCartItemQuantity with ±1", async () => {
    getCart.mockResolvedValue({ ...WITH_EDIT, items: [{ ...WITH_EDIT.items[0], quantity: 2 }] });
    setCartItemQuantity.mockResolvedValue({ ok: true });
    render(<CartPage />);
    expect(await screen.findByTestId("cart-line-quantity")).toHaveTextContent("2");
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity" }));
    await waitFor(() => expect(setCartItemQuantity).toHaveBeenCalledWith("line-1", 3));
    fireEvent.click(screen.getByRole("button", { name: "Decrease quantity" }));
    await waitFor(() => expect(setCartItemQuantity).toHaveBeenCalledWith("line-1", 1));
    // The cart is re-read after each change.
    await waitFor(() => expect(getCart).toHaveBeenCalledTimes(3));
  });

  it("a failed quantity write shows a plain notice and re-reads the cart", async () => {
    getCart.mockResolvedValue({ ...WITH_EDIT, items: [{ ...WITH_EDIT.items[0], quantity: 2 }] });
    setCartItemQuantity.mockRejectedValue(new Error("boom"));
    render(<CartPage />);
    await screen.findByTestId("cart-line-quantity");
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity" }));
    expect(await screen.findByTestId("cart-quantity-error")).toHaveTextContent(
      "Couldn't change the quantity."
    );
    expect(getCart).toHaveBeenCalledTimes(2);
  });

  it("disables Decrease at 1 and Increase at 12", async () => {
    getCart.mockResolvedValueOnce({ ...WITH_EDIT, items: [{ ...WITH_EDIT.items[0], quantity: 1 }] });
    const { unmount } = render(<CartPage />);
    await screen.findByTestId("cart-line-quantity");
    expect(screen.getByRole("button", { name: "Decrease quantity" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Increase quantity" })).toBeEnabled();
    unmount();
    getCart.mockResolvedValueOnce({ ...WITH_EDIT, items: [{ ...WITH_EDIT.items[0], quantity: 12 }] });
    render(<CartPage />);
    await screen.findByTestId("cart-line-quantity");
    expect(screen.getByRole("button", { name: "Increase quantity" })).toBeDisabled();
  });

  it("the stepper buttons are 44px targets", async () => {
    getCart.mockResolvedValue(WITH_EDIT);
    render(<CartPage />);
    const inc = await screen.findByRole("button", { name: "Increase quantity" });
    expect(inc.className).toMatch(/\bw-11\b/);
    expect(inc.className).toMatch(/\bh-11\b/);
  });
});

/**
 * Replace window.location so an href assignment is recorded instead of
 * attempted (jsdom does not navigate). Call `restore` in a `finally`.
 */
function stubLocationHref() {
  const hrefSet = vi.fn();
  const original = window.location;
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      get pathname() {
        return original.pathname;
      },
      get search() {
        return original.search;
      },
      set href(value: string) {
        hrefSet(value);
      },
    },
  });
  return {
    hrefSet,
    restore: () =>
      Object.defineProperty(window, "location", {
        configurable: true,
        value: original,
      }),
  };
}

describe("CartPage checkout (#278 slice 6b)", () => {
  const EMBEDDED_PATH = "/checkout?session=cs_test_abc&from=%2Fcart";

  it("follows the url checkoutCart returns, our own relative /checkout path included", async () => {
    const loc = stubLocationHref();
    try {
      getCart.mockResolvedValue(ONE_ITEM);
      checkoutCart.mockResolvedValue({ url: EMBEDDED_PATH });
      render(<CartPage />);

      fireEvent.click(await screen.findByRole("button", { name: /^Checkout/ }));

      await waitFor(() =>
        expect(loc.hrefSet).toHaveBeenCalledWith(EMBEDDED_PATH)
      );
      expect(screen.queryByTestId("cart-checkout-error")).not.toBeInTheDocument();
    } finally {
      loc.restore();
    }
  });

  it("needsAuth sends the buyer to sign-in and back to the cart", async () => {
    const loc = stubLocationHref();
    try {
      getCart.mockResolvedValue(ONE_ITEM);
      checkoutCart.mockResolvedValue({ url: null, needsAuth: true });
      render(<CartPage />);

      fireEvent.click(await screen.findByRole("button", { name: /^Checkout/ }));

      await waitFor(() =>
        expect(loc.hrefSet).toHaveBeenCalledWith("/sign-in?next=/cart")
      );
    } finally {
      loc.restore();
    }
  });

  it("a thrown checkout shows the checkout-failed line, not the thrown message, and gives the button back", async () => {
    const loc = stubLocationHref();
    try {
      getCart.mockResolvedValue(ONE_ITEM);
      checkoutCart.mockRejectedValue(new Error("digest 123: masked in production"));
      render(<CartPage />);

      fireEvent.click(await screen.findByRole("button", { name: /^Checkout/ }));

      const notice = await screen.findByTestId("cart-checkout-error");
      expect(notice).toHaveTextContent(CHECKOUT_FAILED);
      expect(notice).not.toHaveTextContent("masked in production");
      expect(
        await screen.findByRole("button", { name: /^Checkout/ })
      ).toBeEnabled();
      expect(loc.hrefSet).not.toHaveBeenCalled();
      // Nothing about the cart changed, so it is not re-read.
      expect(getCart).toHaveBeenCalledTimes(1);
    } finally {
      loc.restore();
    }
  });

  it("the next attempt clears the notice", async () => {
    const loc = stubLocationHref();
    try {
      getCart.mockResolvedValue(ONE_ITEM);
      checkoutCart
        .mockRejectedValueOnce(new Error("boom"))
        .mockResolvedValueOnce({ url: EMBEDDED_PATH });
      render(<CartPage />);

      fireEvent.click(await screen.findByRole("button", { name: /^Checkout/ }));
      await screen.findByTestId("cart-checkout-error");
      fireEvent.click(await screen.findByRole("button", { name: /^Checkout/ }));

      await waitFor(() =>
        expect(loc.hrefSet).toHaveBeenCalledWith(EMBEDDED_PATH)
      );
      expect(screen.queryByTestId("cart-checkout-error")).not.toBeInTheDocument();
    } finally {
      loc.restore();
    }
  });

  it("a refusal keeps its own message when the cart re-read after it fails", async () => {
    getCart
      .mockResolvedValueOnce(ONE_ITEM)
      .mockRejectedValue(new Error("re-read failed"));
    checkoutCart.mockResolvedValue({ url: null, error: CART_LINE_UNAVAILABLE });
    render(<CartPage />);

    fireEvent.click(await screen.findByRole("button", { name: /^Checkout/ }));

    const notice = await screen.findByTestId("cart-checkout-error");
    expect(notice).toHaveTextContent(CART_LINE_UNAVAILABLE);
    expect(
      await screen.findByRole("button", { name: /^Checkout/ })
    ).toBeEnabled();
    expect(screen.getByTestId("cart-checkout-error")).not.toHaveTextContent(
      CHECKOUT_FAILED
    );
    // The initial load plus the re-read after the refusal, which is the one
    // that failed.
    expect(getCart).toHaveBeenCalledTimes(2);
  });
});

describe("CartPage Checkout stays disabled once a navigation is requested (#315)", () => {
  const EMBEDDED_PATH = "/checkout?session=cs_test_abc&from=%2Fcart";
  const WITH_EDIT: CartView = {
    ...ONE_ITEM_WITH_IMAGE,
    items: [
      {
        ...ONE_ITEM_WITH_IMAGE.items[0],
        editHref: "/d/img-1?order=1&size=M&line=line-1&from=%2Fcart",
      },
    ],
  };

  function firePageShow(persisted: boolean) {
    const event = new Event("pageshow") as Event & { persisted: boolean };
    Object.defineProperty(event, "persisted", { value: persisted });
    window.dispatchEvent(event);
  }

  async function startCheckout(loc: ReturnType<typeof stubLocationHref>) {
    getCart.mockResolvedValue(WITH_EDIT);
    checkoutCart.mockResolvedValue({ url: EMBEDDED_PATH });
    render(<CartPage />);
    fireEvent.click(await screen.findByRole("button", { name: /^Checkout/ }));
    await waitFor(() => expect(loc.hrefSet).toHaveBeenCalledWith(EMBEDDED_PATH));
  }

  it("after the url is followed: the button reads Redirecting, the steppers are disabled and Edit is not a link", async () => {
    const loc = stubLocationHref();
    try {
      await startCheckout(loc);

      const button = screen.getByRole("button", { name: "Redirecting…" });
      expect(button).toBeDisabled();
      expect(screen.getByRole("button", { name: /^Increase quantity/ })).toBeDisabled();
      expect(screen.getByRole("button", { name: /^Decrease quantity/ })).toBeDisabled();
      expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
    } finally {
      loc.restore();
    }
  });

  it("a persisted pageshow gives the page back; a non-persisted one does not", async () => {
    const loc = stubLocationHref();
    try {
      await startCheckout(loc);

      firePageShow(false);
      expect(screen.getByRole("button", { name: "Redirecting…" })).toBeDisabled();

      firePageShow(true);
      expect(await screen.findByRole("button", { name: /^Checkout/ })).toBeEnabled();
      expect(screen.getByRole("button", { name: /^Increase quantity/ })).toBeEnabled();
      expect(screen.getByRole("link", { name: "Edit" })).toBeInTheDocument();
    } finally {
      loc.restore();
    }
  });

  it("needsAuth also stays disabled", async () => {
    const loc = stubLocationHref();
    try {
      getCart.mockResolvedValue(ONE_ITEM);
      checkoutCart.mockResolvedValue({ url: null, needsAuth: true });
      render(<CartPage />);
      fireEvent.click(await screen.findByRole("button", { name: /^Checkout/ }));
      await waitFor(() =>
        expect(loc.hrefSet).toHaveBeenCalledWith("/sign-in?next=/cart")
      );
      expect(screen.getByRole("button", { name: "Redirecting…" })).toBeDisabled();
    } finally {
      loc.restore();
    }
  });

  it.each([
    ["a returned error", () => checkoutCart.mockResolvedValue({ url: null, error: CART_LINE_UNAVAILABLE })],
    ["a thrown action", () => checkoutCart.mockRejectedValue(new Error("boom"))],
    ["a null url", () => checkoutCart.mockResolvedValue({ url: null })],
  ])("%s leaves the button enabled", async (_label, arrange) => {
    const loc = stubLocationHref();
    try {
      getCart.mockResolvedValue(ONE_ITEM);
      arrange();
      render(<CartPage />);
      fireEvent.click(await screen.findByRole("button", { name: /^Checkout/ }));
      await waitFor(() => expect(checkoutCart).toHaveBeenCalledTimes(1));
      expect(await screen.findByRole("button", { name: /^Checkout/ })).toBeEnabled();
      expect(loc.hrefSet).not.toHaveBeenCalled();
    } finally {
      loc.restore();
    }
  });

  it("a second click while disabled does not call checkoutCart again", async () => {
    const loc = stubLocationHref();
    try {
      await startCheckout(loc);

      fireEvent.click(screen.getByRole("button", { name: "Redirecting…" }));

      expect(checkoutCart).toHaveBeenCalledTimes(1);
    } finally {
      loc.restore();
    }
  });

  it("two clicks dispatched before React re-renders call checkoutCart once", async () => {
    const loc = stubLocationHref();
    try {
      getCart.mockResolvedValue(ONE_ITEM);
      checkoutCart.mockResolvedValue({ url: EMBEDDED_PATH });
      render(<CartPage />);
      const button = await screen.findByRole("button", { name: /^Checkout/ });

      await act(async () => {
        button.click();
        button.click();
      });

      expect(checkoutCart).toHaveBeenCalledTimes(1);
    } finally {
      loc.restore();
    }
  });

  it("a persisted pageshow re-reads the cart and shows what it returns", async () => {
    const loc = stubLocationHref();
    try {
      getCart.mockResolvedValueOnce(ONE_ITEM).mockResolvedValue(EMPTY);
      checkoutCart.mockResolvedValue({ url: EMBEDDED_PATH });
      render(<CartPage />);
      fireEvent.click(await screen.findByRole("button", { name: /^Checkout/ }));
      await waitFor(() => expect(loc.hrefSet).toHaveBeenCalled());

      firePageShow(true);

      expect(await screen.findByText("Your cart is empty.")).toBeInTheDocument();
      expect(getCart).toHaveBeenCalledTimes(2);
    } finally {
      loc.restore();
    }
  });

  it("a non-persisted pageshow does not re-read the cart", async () => {
    const loc = stubLocationHref();
    try {
      await startCheckout(loc);
      getCart.mockClear();
      firePageShow(false);
      expect(getCart).not.toHaveBeenCalled();
    } finally {
      loc.restore();
    }
  });

  it("after a persisted pageshow, Checkout works again: a second click calls checkoutCart a second time", async () => {
    const loc = stubLocationHref();
    try {
      await startCheckout(loc);

      firePageShow(true);
      fireEvent.click(await screen.findByRole("button", { name: /^Checkout/ }));

      await waitFor(() => expect(checkoutCart).toHaveBeenCalledTimes(2));
    } finally {
      loc.restore();
    }
  });

  it("a line that goes stale after load: one notice and a disabled Checkout, and removing the line clears both", async () => {
    const STALE_AFTER_CLICK: CartView = {
      ...ONE_ITEM,
      items: [{ ...ONE_ITEM.items[0], unavailable: true }],
    };
    getCart
      .mockResolvedValueOnce(ONE_ITEM)
      .mockResolvedValueOnce(STALE_AFTER_CLICK)
      .mockResolvedValue(ONE_ITEM);
    checkoutCart.mockResolvedValue({ url: null, error: CART_LINE_UNAVAILABLE });
    removeCartItem.mockResolvedValue(undefined);
    render(<CartPage />);

    fireEvent.click(await screen.findByRole("button", { name: /^Checkout/ }));

    await screen.findByTestId("cart-line-unavailable");
    expect(screen.getAllByTestId("cart-checkout-error")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /^Checkout/ })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() =>
      expect(screen.queryByTestId("cart-checkout-error")).not.toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: /^Checkout/ })).toBeEnabled();
  });
});
