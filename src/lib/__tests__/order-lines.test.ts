import { describe, it, expect } from "vitest";
import { resolveOrderLines } from "@/lib/order-lines";

// Legacy single-item orders carry the bought item in scalar columns on `order`.
const legacyOrder = {
  designId: "design-1",
  productId: "bella-canvas-3001", // a blank catalog id
  size: "L",
  color: "Black",
  placements: { front: "img-front" } as Record<string, string> | null,
  itemPrice: 19.43,
  printfulCost: 8.12,
};

// Cart (#26) orders carry one order_item row per shirt instead.
const cartItems = [
  {
    designId: "design-a",
    productId: "bella-canvas-3001",
    size: "M",
    color: "White",
    quantity: 1,
    placements: { front: "img-a" } as Record<string, string> | null,
    itemPrice: 19.43,
    printfulCost: 8.0,
  },
  {
    designId: "design-b",
    productId: "bella-canvas-6400",
    size: "S",
    color: "Navy",
    quantity: 3,
    placements: null as Record<string, string> | null,
    itemPrice: 21.43,
    printfulCost: null,
  },
];

describe("resolveOrderLines", () => {
  it("returns order_item rows as lines when present (authoritative)", () => {
    const lines = resolveOrderLines(legacyOrder, cartItems);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({
      designId: "design-a",
      blankId: "bella-canvas-3001",
      size: "M",
      color: "White",
      quantity: 1,
      placements: { front: "img-a" },
      itemPrice: 19.43,
      printfulCost: 8.0,
    });
  });

  it("preserves per-item quantity from order_item rows", () => {
    const lines = resolveOrderLines(legacyOrder, cartItems);
    expect(lines[1].quantity).toBe(3);
  });

  it("ignores the legacy scalar columns when order_item rows exist", () => {
    const lines = resolveOrderLines(legacyOrder, cartItems);
    expect(lines.map((l) => l.designId)).toEqual(["design-a", "design-b"]);
    expect(lines.some((l) => l.designId === "design-1")).toBe(false);
  });

  it("synthesizes one line from scalar columns when there are no order_item rows", () => {
    const lines = resolveOrderLines(legacyOrder, []);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual({
      designId: "design-1",
      blankId: "bella-canvas-3001",
      size: "L",
      color: "Black",
      quantity: 1,
      placements: { front: "img-front" },
      itemPrice: 19.43,
      printfulCost: 8.12,
    });
  });

  it("defaults null placements to an empty object", () => {
    const lines = resolveOrderLines(legacyOrder, cartItems);
    expect(lines[1].placements).toEqual({});

    const synthetic = resolveOrderLines(
      { ...legacyOrder, placements: null },
      []
    );
    expect(synthetic[0].placements).toEqual({});
  });

  it("passes through null printfulCost (COGS not yet known)", () => {
    const lines = resolveOrderLines(legacyOrder, cartItems);
    expect(lines[1].printfulCost).toBeNull();
  });
});
