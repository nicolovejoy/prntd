import { describe, it, expect } from "vitest";
import { resolveOrderLines } from "@/lib/order-lines";

// Every order carries one order_item row per shirt (authoritative since 1c).
const items = [
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
  it("maps order_item rows to lines, exposing product_id as blankId", () => {
    const lines = resolveOrderLines(items);
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

  it("preserves per-item quantity", () => {
    expect(resolveOrderLines(items)[1].quantity).toBe(3);
  });

  it("defaults null placements to an empty object", () => {
    expect(resolveOrderLines(items)[1].placements).toEqual({});
  });

  it("passes through null printfulCost (COGS not yet known)", () => {
    expect(resolveOrderLines(items)[1].printfulCost).toBeNull();
  });

  it("returns no lines for an order with no items", () => {
    expect(resolveOrderLines([])).toEqual([]);
  });
});
