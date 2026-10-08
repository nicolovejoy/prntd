import { describe, it, expect } from "vitest";
import {
  cartLineEdit,
  cartLineEditHref,
  isValidCartQuantity,
  CART_LINE_MAX_QUANTITY,
  CART_LINE_MIN_QUANTITY,
} from "@/lib/cart-line-edit";

const OPTS = { productId: "bella-canvas-3001", size: "M", color: "Black" };

describe("cartLineEdit", () => {
  it("front-only line: the front is the page image", () => {
    expect(cartLineEdit({ placements: { front: "A" } }, (id) => id === "A")).toEqual({
      pageImageId: "A",
      back: null,
      swap: false,
    });
  });

  it("two-sided line with the front linked: front page, back carried", () => {
    expect(
      cartLineEdit({ placements: { front: "A", back: "B" } }, (id) => id === "A")
    ).toEqual({ pageImageId: "A", back: "B", swap: false });
  });

  it("swapped line (only the back is linked): the back is the page image, swap set", () => {
    expect(
      cartLineEdit({ placements: { front: "B", back: "A" } }, (id) => id === "A")
    ).toEqual({ pageImageId: "A", back: "B", swap: true });
  });

  it("both pins linked (two images of one conversation): the front wins, no swap", () => {
    expect(cartLineEdit({ placements: { front: "A", back: "C" } }, () => true)).toEqual({
      pageImageId: "A",
      back: "C",
      swap: false,
    });
  });

  it("neither pin linked (a legacy /preview line with a foreign front): the front is still the page", () => {
    expect(cartLineEdit({ placements: { front: "X" } }, () => false)).toEqual({
      pageImageId: "X",
      back: null,
      swap: false,
    });
  });

  it("no front pin: not editable", () => {
    expect(cartLineEdit({ placements: null }, () => true)).toBeNull();
    expect(cartLineEdit({ placements: { back: "B" } }, () => true)).toBeNull();
  });
});

describe("cartLineEditHref", () => {
  it("opens the page image with the panel open, the picks, the line and from=/cart", () => {
    const href = cartLineEditHref("line-1", OPTS, {
      pageImageId: "A",
      back: null,
      swap: false,
    });
    const url = new URL(href, "http://x");
    expect(url.pathname).toBe("/d/A");
    expect(url.searchParams.get("order")).toBe("1");
    expect(url.searchParams.get("product")).toBe(OPTS.productId);
    expect(url.searchParams.get("size")).toBe("M");
    expect(url.searchParams.get("color")).toBe("Black");
    expect(url.searchParams.get("line")).toBe("line-1");
    expect(url.searchParams.get("from")).toBe("/cart");
    expect(url.searchParams.has("back")).toBe(false);
    expect(url.searchParams.has("swap")).toBe(false);
  });

  it("carries back and swap for a swapped line", () => {
    const url = new URL(
      cartLineEditHref("line-2", OPTS, { pageImageId: "A", back: "B", swap: true }),
      "http://x"
    );
    expect(url.searchParams.get("back")).toBe("B");
    expect(url.searchParams.get("swap")).toBe("1");
  });
});

describe("isValidCartQuantity", () => {
  it("accepts the integers 1 to 12", () => {
    expect(CART_LINE_MIN_QUANTITY).toBe(1);
    expect(CART_LINE_MAX_QUANTITY).toBe(12);
    for (let q = 1; q <= 12; q++) expect(isValidCartQuantity(q)).toBe(true);
  });
  it("refuses everything else", () => {
    for (const q of [0, 13, -1, 1.5, NaN, Infinity, "2", null, undefined, true]) {
      expect(isValidCartQuantity(q)).toBe(false);
    }
  });
});
