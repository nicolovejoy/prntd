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

// Every (colour, size) -> Printful variant id the catalog had before #14,
// copied from main at that point. Orders reference these ids, so a typo in
// an existing entry must fail here.
const PRE_14_VARIANTS: Record<string, Record<string, Record<string, number>>> = {
  "bella-canvas-3001": {
    "White": { S: 4011, M: 4012, L: 4013, XL: 4014, "2XL": 4015 },
    "Vintage White": { S: 14714, M: 14715, L: 14716, XL: 14717, "2XL": 14718 },
    "Soft Cream": { S: 4151, M: 4152, L: 4153, XL: 4154, "2XL": 4155 },
    "Heather Dust": { S: 10360, M: 10361, L: 10362, XL: 10363, "2XL": 10364 },
    "Natural": { S: 14682, M: 14683, L: 14684, XL: 14685, "2XL": 14686 },
    "Tan": { S: 14674, M: 14675, L: 14676, XL: 14677, "2XL": 14678 },
    "Pebble": { S: 4131, M: 4132, L: 4133, XL: 4134, "2XL": 4135 },
    "Athletic Heather": { S: 6948, M: 6949, L: 6950, XL: 6951, "2XL": 6952 },
    "Dark Grey": { S: 21578, M: 21579, L: 21580, XL: 21581, "2XL": 21582 },
    "Black": { S: 4016, M: 4017, L: 4018, XL: 4019, "2XL": 4020 },
    "Red": { S: 4141, M: 4142, L: 4143, XL: 4144, "2XL": 4145 },
    "Maroon": { S: 4106, M: 4107, L: 4108, XL: 4109, "2XL": 4110 },
    "Burnt Orange": { S: 4051, M: 4052, L: 4053, XL: 4054, "2XL": 4055 },
    "Orange": { S: 4126, M: 4127, L: 4128, XL: 4129, "2XL": 4130 },
    "Mustard": { S: 10376, M: 10377, L: 10378, XL: 10379, "2XL": 10380 },
    "Pink": { S: 4136, M: 4137, L: 4138, XL: 4139, "2XL": 4140 },
    "Mauve": { S: 9395, M: 9396, L: 9397, XL: 9398, "2XL": 9399 },
    "Team Purple": { S: 4166, M: 4167, L: 4168, XL: 4169, "2XL": 4170 },
    "Sage": { S: 22050, M: 22051, L: 22052, XL: 22053, "2XL": 22054 },
    "Forest": { S: 8451, M: 8452, L: 8453, XL: 8454, "2XL": 8455 },
    "Kelly": { S: 4086, M: 4087, L: 4088, XL: 4089, "2XL": 4090 },
    "Aqua": { S: 4021, M: 4022, L: 4023, XL: 4024, "2XL": 4025 },
    "Baby Blue": { S: 4036, M: 4037, L: 4038, XL: 4039, "2XL": 4040 },
    "True Royal": { S: 4171, M: 4172, L: 4173, XL: 4174, "2XL": 4175 },
    "Navy": { S: 4111, M: 4112, L: 4113, XL: 4114, "2XL": 4115 },
  },
  "cotton-heritage-mc1087": {
    "Black": { S: 23577, M: 23578, L: 23579, XL: 23580, "2XL": 23581, "3XL": 23582, "4XL": 23583 },
    "Navy Blazer": { S: 23584, M: 23585, L: 23586, XL: 23587, "2XL": 23588, "3XL": 23589, "4XL": 23590 },
    "Vintage Black": { S: 23591, M: 23592, L: 23593, XL: 23594, "2XL": 23595, "3XL": 23596, "4XL": 23597 },
    "Vintage White": { S: 23598, M: 23599, L: 23600, XL: 23601, "2XL": 23602, "3XL": 23603, "4XL": 23604 },
    "White": { S: 23605, M: 23606, L: 23607, XL: 23608, "2XL": 23609, "3XL": 23610, "4XL": 23611 },
  },
  "bella-canvas-6400": {
    "White": { S: 10252, M: 10253, L: 10254, XL: 10255, "2XL": 10256, "3XL": 10257 },
    "Black": { S: 10187, M: 10188, L: 10189, XL: 10190, "2XL": 10191, "3XL": 10192 },
    "Natural": { S: 46501, M: 46502, L: 46503, XL: 46504, "2XL": 46505, "3XL": 46506 },
    "Vintage White": { S: 46513, M: 46514, L: 46515, XL: 46516, "2XL": 46517, "3XL": 46518 },
    "Athletic Heather": { S: 10176, M: 10177, L: 10178, XL: 10179, "2XL": 10180, "3XL": 10181 },
    "Dark Grey Heather": { S: 10193, M: 10194, L: 10195, XL: 10196, "2XL": 10197, "3XL": 10198 },
    "Navy": { S: 10235, M: 10236, L: 10237, XL: 10238, "2XL": 10239, "3XL": 10240 },
    "Maroon": { S: 10230, M: 10231, L: 10232, XL: 10233, "2XL": 10234, "3XL": 46519 },
    "Forest Green": { S: 46520, M: 46521, L: 46522, XL: 46523, "2XL": 46524, "3XL": 46525 },
    "Military Green": { S: 46532, M: 46533, L: 46534, XL: 46535, "2XL": 46536, "3XL": 46537 },
    "Sage": { S: 46526, M: 46527, L: 46528, XL: 46529, "2XL": 46530, "3XL": 46531 },
    "Leaf": { S: 10225, M: 10226, L: 10227, XL: 10228, "2XL": 10229, "3XL": 14285 },
    "Mauve": { S: 46507, M: 46508, L: 46509, XL: 46510, "2XL": 46511, "3XL": 46512 },
    "Heather Mauve": { S: 10205, M: 10206, L: 10207, XL: 10208, "2XL": 10209, "3XL": 13424 },
    "Pink": { S: 10241, M: 10242, L: 10243, XL: 10244, "2XL": 10245, "3XL": 14158 },
    "Light Violet": { S: 46538, M: 46539, L: 46540, XL: 46541, "2XL": 46542, "3XL": 46543 },
    "Heather Blue Lagoon": { S: 14258, M: 14259, L: 14260, XL: 14261, "2XL": 14262, "3XL": 14286 },
    "Heather Deep Teal": { S: 46550, M: 46551, L: 46552, XL: 46553, "2XL": 46554, "3XL": 46555 },
    "Heather Navy": { S: 46544, M: 46545, L: 46546, XL: 46547, "2XL": 46548, "3XL": 46549 },
    "Heather True Royal": { S: 46556, M: 46557, L: 46558, XL: 46559, "2XL": 46560, "3XL": 46561 },
    "Heather Red": { S: 14268, M: 14269, L: 14270, XL: 14271, "2XL": 14272, "3XL": 14288 },
    "Heather Stone": { S: 14273, M: 14274, L: 14275, XL: 14276, "2XL": 14277, "3XL": 14289 },
  },
};

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
        if (lp === lc) expect(prev.name.localeCompare(cur.name), ).toBeLessThanOrEqual(0);
      }
    }
  });

  it("starts every list at White, which pickers use as the default", () => {
    for (const b of SHIRTS) expect(b.colors[0].name).toBe("White");
  });

  it("keeps every pre-#14 variant id unchanged", () => {
    for (const [id, colors] of Object.entries(PRE_14_VARIANTS)) {
      const b = getBlankOrThrow(id);
      for (const [color, sizes] of Object.entries(colors)) {
        for (const [size, variantId] of Object.entries(sizes)) {
          expect(b.variants[color]?.[size], ).toBe(variantId);
        }
      }
    }
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
