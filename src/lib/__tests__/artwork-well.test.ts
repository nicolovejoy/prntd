import { describe, it, expect } from "vitest";
import { contrastRatio, wellForLuminance, wellClass, PAPER_WELL_HEX } from "@/lib/artwork-well";
import { relativeLuminance } from "@/lib/blanks";

describe("contrastRatio", () => {
  it("is 21 for black on white and symmetric", () => {
    expect(contrastRatio(0, 1)).toBeCloseTo(21, 5);
    expect(contrastRatio(1, 0)).toBeCloseTo(21, 5);
    expect(contrastRatio(0.3, 0.3)).toBe(1);
  });
});

describe("wellForLuminance (#139)", () => {
  const paper = relativeLuminance(PAPER_WELL_HEX);
  // The threshold: contrast against the paper well under 3.
  const edge = (paper + 0.05) / 3 - 0.05;

  it("puts white and anything lighter than the threshold on the dark well", () => {
    expect(wellForLuminance(1)).toBe("dark");
    expect(wellForLuminance(edge + 0.001)).toBe("dark");
  });

  it("keeps black, mid-grey and the threshold itself on paper", () => {
    expect(wellForLuminance(0)).toBe("paper");
    expect(wellForLuminance(0.18)).toBe("paper");
    expect(wellForLuminance(edge)).toBe("paper");
  });

  it("keeps an unscored image on paper", () => {
    expect(wellForLuminance(null)).toBe("paper");
  });

  it("maps to the two utilities", () => {
    expect(wellClass(1)).toBe("bg-surface-well-dark");
    expect(wellClass(null)).toBe("bg-surface-well");
  });
});
