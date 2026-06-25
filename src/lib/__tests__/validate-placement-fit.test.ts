import { describe, it, expect } from "vitest";
import {
  validatePlacementFit,
  getBlankOrThrow,
  type DesignArtwork,
} from "@/lib/blanks";

const tee = getBlankOrThrow("bella-canvas-3001"); // front: 3:4, printArea 12x16, dtg

// High-res, correct shape, transparent — the happy path.
const goodArt: DesignArtwork = {
  pixelWidth: 2400,
  pixelHeight: 3200, // 200 DPI at 12x16
  aspectRatio: "3:4",
  hasTransparency: true,
};

describe("validatePlacementFit", () => {
  it("passes a high-res, correctly-shaped, transparent design", () => {
    const r = validatePlacementFit({ blank: tee, placementId: "front", artwork: goodArt });
    expect(r.ok).toBe(true);
    expect(r.warnings).toHaveLength(0);
  });

  it("flags a missing placement as fatal (and short-circuits)", () => {
    const r = validatePlacementFit({ blank: tee, placementId: "sleeve_left", artwork: goodArt });
    expect(r.ok).toBe(false);
    expect(r.warnings.map((w) => w.code)).toEqual(["placement_missing"]);
  });

  it("warns on low resolution", () => {
    const r = validatePlacementFit({
      blank: tee,
      placementId: "front",
      artwork: { ...goodArt, pixelWidth: 300, pixelHeight: 400 }, // ~25 DPI
    });
    expect(r.ok).toBe(false);
    expect(r.warnings.map((w) => w.code)).toContain("low_resolution");
  });

  it("warns when the aspect needs reshaping", () => {
    const r = validatePlacementFit({
      blank: tee,
      placementId: "front",
      artwork: { ...goodArt, aspectRatio: "1:2" }, // 1.5x off 3:4
    });
    expect(r.warnings.map((w) => w.code)).toContain("aspect_mismatch");
  });

  it("warns about a solid background on a colored garment (DTG knockout)", () => {
    const r = validatePlacementFit({
      blank: tee,
      placementId: "front",
      artwork: { ...goodArt, hasTransparency: false },
      coloredGarment: true,
    });
    expect(r.warnings.map((w) => w.code)).toContain("needs_transparency");
  });

  it("does not warn about transparency on a white garment", () => {
    const r = validatePlacementFit({
      blank: tee,
      placementId: "front",
      artwork: { ...goodArt, hasTransparency: false },
      coloredGarment: false,
    });
    expect(r.warnings.map((w) => w.code)).not.toContain("needs_transparency");
  });

  it("each warning carries a remediation hint (never a dead end)", () => {
    const r = validatePlacementFit({
      blank: tee,
      placementId: "front",
      artwork: { pixelWidth: 200, pixelHeight: 200, aspectRatio: "1:2", hasTransparency: false },
      coloredGarment: true,
    });
    expect(r.warnings.length).toBeGreaterThan(0);
    for (const w of r.warnings) expect(w.remediation).toBeTruthy();
  });
});
