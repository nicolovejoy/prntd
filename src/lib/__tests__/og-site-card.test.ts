import { describe, it, expect } from "vitest";
import { designCardPalette } from "../og-site-card";
import { relativeLuminance } from "../instant-preview";

/**
 * The share card composites a transparent PNG onto the listing's pinned
 * backdrop, so the only real decision in it is which colour that is and
 * whether the wordmark can be read on top.
 */
describe("designCardPalette", () => {
  it("uses the pinned storefront backdrop", () => {
    // Whatever the palette resolves Navy to, it is a real hex and it is dark.
    const { backdrop } = designCardPalette("Navy");
    expect(backdrop).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(relativeLuminance(backdrop)).toBeLessThan(0.5);
  });

  it("falls back to the White default for a legacy null backdrop (#76)", () => {
    const { backdrop } = designCardPalette(null);
    expect(relativeLuminance(backdrop)).toBeGreaterThanOrEqual(0.5);
    expect(designCardPalette(undefined).backdrop).toBe(backdrop);
  });

  it("darkens the wordmark on a light backdrop and lightens it on a dark one", () => {
    expect(designCardPalette("White").wordmark).toBe("rgba(0,0,0,0.45)");
    expect(designCardPalette("Black").wordmark).toBe("rgba(255,255,255,0.55)");
  });

  it("never leaves the wordmark the same tone as its backdrop", () => {
    for (const color of ["White", "Black", "Navy", "Red", null]) {
      const { backdrop, wordmark } = designCardPalette(color);
      const backdropIsLight = relativeLuminance(backdrop) >= 0.5;
      const wordmarkIsDark = wordmark.startsWith("rgba(0,0,0");
      expect(wordmarkIsDark).toBe(backdropIsLight);
    }
  });
});
