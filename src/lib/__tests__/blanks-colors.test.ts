import { describe, it, expect } from "vitest";
import {
  BLANKS,
  BACKGROUND_PALETTE,
  getBlankOrThrow,
  getColorHex,
  relativeLuminance,
} from "../blanks";

const SHIRTS = BLANKS.filter((b) => b.type === "shirt");

// Today's 25 publish backdrops (Classic Tee colours as of 2026-09-30), in
// their original order. Adding shirt colours must not change this list;
// published designs reference these names (decision 8, 2026-09-28).
const PINNED_PALETTE = [
  ["White", "#ffffff"],
  ["Vintage White", "#fcf4e8"],
  ["Soft Cream", "#e7d4c0"],
  ["Heather Dust", "#e5d9c9"],
  ["Natural", "#fef1d1"],
  ["Tan", "#ddb792"],
  ["Pebble", "#9a8479"],
  ["Athletic Heather", "#cececc"],
  ["Dark Grey", "#2A2929"],
  ["Black", "#0c0c0c"],
  ["Red", "#d0071e"],
  ["Maroon", "#721d37"],
  ["Burnt Orange", "#ed8043"],
  ["Orange", "#ff6f32"],
  ["Mustard", "#eda027"],
  ["Pink", "#fdbfc7"],
  ["Mauve", "#bf6e6e"],
  ["Team Purple", "#230f46"],
  ["Sage", "#9eab96"],
  ["Forest", "#223e25"],
  ["Kelly", "#1a9462"],
  ["Aqua", "#008db5"],
  ["Baby Blue", "#c7d7ef"],
  ["True Royal", "#01408d"],
  ["Navy", "#212642"],
].map(([name, value]) => ({ name, value }));

describe("shirt colour catalog", () => {
  it("gives every colour a parseable hex", () => {
    for (const b of SHIRTS) {
      for (const c of b.colors) {
        expect(c.value, `${b.id} / ${c.name}`).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });

  it("has no duplicate colour names", () => {
    for (const b of SHIRTS) {
      const names = b.colors.map((c) => c.name);
      expect(new Set(names).size, b.id).toBe(names.length);
    }
  });

  it("has a variant id for every size the product sells, for every colour", () => {
    for (const b of SHIRTS) {
      for (const c of b.colors) {
        for (const size of b.sizes) {
          expect(
            b.variants[c.name]?.[size],
            `${b.id} / ${c.name} / ${size}`
          ).toBeTypeOf("number");
        }
      }
    }
  });

  it("has no variants for colours that aren't listed", () => {
    for (const b of SHIRTS) {
      const listed = new Set(b.colors.map((c) => c.name));
      for (const name of Object.keys(b.variants)) {
        expect(listed.has(name), `${b.id} / ${name}`).toBe(true);
      }
    }
  });

  it("never reuses a variant id within a product", () => {
    for (const b of SHIRTS) {
      const ids = Object.values(b.variants).flatMap((m) => Object.values(m));
      expect(new Set(ids).size, b.id).toBe(ids.length);
    }
  });

  it("returns the listed hex, never the grey fallback, for every colour", () => {
    for (const b of SHIRTS) {
      for (const c of b.colors) {
        expect(getColorHex(b.id, c.name), `${b.id} / ${c.name}`).toBe(c.value);
      }
    }
  });

  it("lists colours light to dark, with name as the tiebreak", () => {
    for (const b of SHIRTS) {
      for (let i = 1; i < b.colors.length; i++) {
        const prev = b.colors[i - 1];
        const cur = b.colors[i];
        const lp = relativeLuminance(prev.value);
        const lc = relativeLuminance(cur.value);
        expect(lp, `${b.id}: ${prev.name} before ${cur.name}`).toBeGreaterThanOrEqual(lc);
        if (lp === lc) expect(prev.name < cur.name).toBe(true);
      }
    }
  });

  it("starts every list at White, which pickers use as the default", () => {
    for (const b of SHIRTS) expect(b.colors[0].name).toBe("White");
  });

  it("keeps every colour that was in the catalog before #14", () => {
    // Past orders reference colours by name.
    const kept: Record<string, string[]> = {
      "bella-canvas-3001": PINNED_PALETTE.map((c) => c.name),
      "cotton-heritage-mc1087": ["White", "Black", "Navy Blazer", "Vintage Black", "Vintage White"],
      "bella-canvas-6400": [
        "White", "Black", "Natural", "Vintage White", "Athletic Heather",
        "Dark Grey Heather", "Navy", "Maroon", "Forest Green", "Military Green",
        "Sage", "Leaf", "Mauve", "Heather Mauve", "Pink", "Light Violet",
        "Heather Blue Lagoon", "Heather Deep Teal", "Heather Navy",
        "Heather True Royal", "Heather Red", "Heather Stone",
      ],
    };
    for (const [id, names] of Object.entries(kept)) {
      const have = new Set(getBlankOrThrow(id).colors.map((c) => c.name));
      for (const n of names) expect(have.has(n), `${id} / ${n}`).toBe(true);
    }
  });
});

describe("BACKGROUND_PALETTE", () => {
  it("is exactly the 25 backdrops published designs were pinned against", () => {
    expect(BACKGROUND_PALETTE).toEqual(PINNED_PALETTE);
  });

  it("resolves every backdrop name to the same hex on the default blank", () => {
    for (const c of BACKGROUND_PALETTE) {
      expect(getColorHex("bella-canvas-3001", c.name)).toBe(c.value);
    }
  });
});
