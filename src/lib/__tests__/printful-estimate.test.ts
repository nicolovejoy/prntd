import { describe, it, expect } from "vitest";
import { parseEstimateCosts } from "@/lib/printful";

describe("parseEstimateCosts", () => {
  it("parses string amounts from Printful's costs block", () => {
    expect(
      parseEstimateCosts({
        costs: { subtotal: "38.86", shipping: "6.89", tax: "0.00", total: "45.75" },
      })
    ).toEqual({ subtotal: 38.86, shipping: 6.89, tax: 0, total: 45.75 });
  });

  it("tolerates numeric amounts", () => {
    expect(
      parseEstimateCosts({ costs: { subtotal: 19.43, shipping: 4.69, total: 24.12 } })
    ).toEqual({ subtotal: 19.43, shipping: 4.69, tax: 0, total: 24.12 });
  });

  it("defaults missing fields to 0", () => {
    expect(parseEstimateCosts({})).toEqual({
      subtotal: 0,
      shipping: 0,
      tax: 0,
      total: 0,
    });
  });

  it("treats unparseable strings as 0", () => {
    expect(parseEstimateCosts({ costs: { shipping: "n/a" } }).shipping).toBe(0);
  });
});
