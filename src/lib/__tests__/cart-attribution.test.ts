import { describe, it, expect } from "vitest";
import { cartOrderStoreProductId } from "@/lib/cart-attribution";

describe("cartOrderStoreProductId", () => {
  it("is null for no lines", () => {
    expect(cartOrderStoreProductId([])).toBeNull();
  });

  it("is null when no line is published", () => {
    expect(
      cartOrderStoreProductId([
        { published: false, storeProductId: null },
        { published: false, storeProductId: null },
      ])
    ).toBeNull();
  });

  it("is the product id for one published line", () => {
    expect(cartOrderStoreProductId([{ published: true, storeProductId: "p1" }])).toBe("p1");
  });

  it("is the product id when two published lines share it", () => {
    expect(
      cartOrderStoreProductId([
        { published: true, storeProductId: "p1" },
        { published: true, storeProductId: "p1" },
      ])
    ).toBe("p1");
  });

  it("is null when published lines name different products", () => {
    expect(
      cartOrderStoreProductId([
        { published: true, storeProductId: "p1" },
        { published: true, storeProductId: "p2" },
      ])
    ).toBeNull();
  });

  it("ignores unpublished lines when the published ones share one product", () => {
    expect(
      cartOrderStoreProductId([
        { published: false, storeProductId: null },
        { published: true, storeProductId: "p1" },
        { published: true, storeProductId: "p1" },
      ])
    ).toBe("p1");
  });

  it("is null when a published line has no product id", () => {
    expect(
      cartOrderStoreProductId([
        { published: true, storeProductId: "p1" },
        { published: true, storeProductId: null },
      ])
    ).toBeNull();
  });
});
