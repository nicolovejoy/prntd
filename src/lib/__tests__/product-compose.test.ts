import { describe, it, expect } from "vitest";
import { checkProductFit, artworkFromAspect } from "../product-compose";
import { DEFAULT_BLANK_ID } from "../blanks";

// bella-canvas-3001 (default): placements front/3:4 and back/3:4, DTG.

describe("checkProductFit", () => {
  it("passes a matching aspect on an existing placement", () => {
    const r = checkProductFit({
      blankId: DEFAULT_BLANK_ID,
      placementId: "front",
      aspectRatio: "3:4",
    });
    expect(r.ok).toBe(true);
    expect(r.warnings).toHaveLength(0);
  });

  it("flags a placement the blank doesn't have", () => {
    const r = checkProductFit({
      blankId: DEFAULT_BLANK_ID,
      placementId: "sleeve_left",
      aspectRatio: "3:4",
    });
    expect(r.ok).toBe(false);
    expect(r.warnings[0].code).toBe("placement_missing");
  });

  it("warns (not blocks) on a badly mismatched aspect", () => {
    const r = checkProductFit({
      blankId: DEFAULT_BLANK_ID,
      placementId: "front",
      aspectRatio: "1:2", // 0.5 vs front's 0.75 → ≥1.5× → regenerate
    });
    expect(r.ok).toBe(false);
    expect(r.warnings.some((w) => w.code === "aspect_mismatch")).toBe(true);
  });

  it("does NOT false-warn on resolution we can't measure yet", () => {
    const r = checkProductFit({
      blankId: DEFAULT_BLANK_ID,
      placementId: "front",
      aspectRatio: "3:4",
    });
    expect(r.warnings.some((w) => w.code === "low_resolution")).toBe(false);
  });

  it("does NOT false-warn the knockout rule on a colored garment (alpha unknown)", () => {
    const r = checkProductFit({
      blankId: DEFAULT_BLANK_ID,
      placementId: "front",
      aspectRatio: "3:4",
      coloredGarment: true,
    });
    expect(r.warnings.some((w) => w.code === "needs_transparency")).toBe(false);
  });
});

describe("artworkFromAspect", () => {
  it("carries the aspect and uses non-warning sentinels for unknowns", () => {
    const a = artworkFromAspect("4:5");
    expect(a.aspectRatio).toBe("4:5");
    expect(a.hasTransparency).toBe(true);
    expect(a.pixelWidth).toBeGreaterThan(100000);
  });
});
