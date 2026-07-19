import { describe, it, expect } from "vitest";
import {
  resolveProductAndSize,
  resolveDefaultColor,
} from "@/lib/purchase-defaults";
import { DEFAULT_BLANK_ID } from "@/lib/blanks";

const remembered = { blankId: "bella-canvas-6400", size: "L" };

describe("resolveProductAndSize", () => {
  it("falls back to the static default with nothing remembered", () => {
    expect(
      resolveProductAndSize({ urlProduct: null, urlSize: null, remembered: null })
    ).toEqual({ productId: DEFAULT_BLANK_ID, size: null });
  });

  it("uses the remembered blank + size when the URL has neither", () => {
    expect(
      resolveProductAndSize({ urlProduct: null, urlSize: null, remembered })
    ).toEqual({ productId: "bella-canvas-6400", size: "L" });
  });

  it("URL product wins over remembered", () => {
    const r = resolveProductAndSize({
      urlProduct: "cotton-heritage-mc1087",
      urlSize: null,
      remembered,
    });
    expect(r.productId).toBe("cotton-heritage-mc1087");
    // Remembered size still applies when the winning product offers it.
    expect(r.size).toBe("L");
  });

  it("URL size wins over remembered size", () => {
    expect(
      resolveProductAndSize({ urlProduct: null, urlSize: "M", remembered })
    ).toEqual({ productId: "bella-canvas-6400", size: "M" });
  });

  it("drops an URL size the winning product does not offer", () => {
    const r = resolveProductAndSize({
      urlProduct: DEFAULT_BLANK_ID, // 3001 has no 4XL
      urlSize: "4XL",
      remembered: null,
    });
    expect(r.size).toBeNull();
  });

  it("drops a remembered size the winning product does not offer", () => {
    const r = resolveProductAndSize({
      urlProduct: DEFAULT_BLANK_ID, // 3001 tops out at 2XL
      urlSize: null,
      remembered: { blankId: "cotton-heritage-mc1087", size: "4XL" },
    });
    expect(r).toEqual({ productId: DEFAULT_BLANK_ID, size: null });
  });

  it("ignores a discontinued or unknown URL product", () => {
    expect(
      resolveProductAndSize({
        urlProduct: "clear-case-iphone",
        urlSize: null,
        remembered,
      }).productId
    ).toBe("bella-canvas-6400");
    expect(
      resolveProductAndSize({
        urlProduct: "no-such-blank",
        urlSize: null,
        remembered: null,
      }).productId
    ).toBe(DEFAULT_BLANK_ID);
  });
});

describe("resolveDefaultColor", () => {
  const palette = [
    { name: "Black", value: "#000000" },
    { name: "White", value: "#ffffff" },
    { name: "Navy", value: "#1f2a44" },
  ];

  it("URL color wins", () => {
    expect(
      resolveDefaultColor({ urlColor: "Navy", pinnedColor: "Black", palette })
    ).toEqual({ color: "Navy", pinnedApplied: false });
  });

  it("pinned backdrop applies when the URL has no valid color", () => {
    expect(
      resolveDefaultColor({ urlColor: "Chartreuse", pinnedColor: "Black", palette })
    ).toEqual({ color: "Black", pinnedApplied: true });
  });

  it("ignores a pinned color the palette lacks", () => {
    expect(
      resolveDefaultColor({ urlColor: null, pinnedColor: "Mauve", palette })
    ).toEqual({ color: "White", pinnedApplied: false });
  });

  it("prefers White, else the first color", () => {
    expect(
      resolveDefaultColor({ urlColor: null, pinnedColor: null, palette })
    ).toEqual({ color: "White", pinnedApplied: false });
    expect(
      resolveDefaultColor({
        urlColor: null,
        pinnedColor: null,
        palette: [{ name: "Black", value: "#000000" }, { name: "Navy", value: "#1f2a44" }],
      })
    ).toEqual({ color: "Black", pinnedApplied: false });
  });
});
