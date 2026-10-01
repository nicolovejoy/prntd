/**
 * prefetchProductMockups sends one bulk Printful task. Against a real
 * in-memory libSQL; Printful and R2 are mocked. The assertions are on the
 * variant ids handed to createMockupTask.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb } from "@/lib/__tests__/test-db";
import { makeUser, makeDesign, makeSourceImage } from "@/lib/__tests__/factories";

const h = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("@/lib/db", () => ({
  get db() {
    return h.db;
  },
}));

const printful = vi.hoisted(() => ({
  createMockupTask: vi.fn<(...args: unknown[]) => Promise<string>>(async () => "task-key"),
  pollMockupTask: vi.fn(async () => [] as unknown[]),
}));
vi.mock("@/lib/printful", () => printful);

vi.mock("@/lib/r2", () => ({
  uploadMockupImage: vi.fn(async () => "https://r2.example/mockup.jpg"),
}));

import { prefetchProductMockups } from "@/lib/mockup-prefetch";
import { BLANKS, DEFAULT_BLANK_ID, getBlankOrThrow } from "@/lib/blanks";

type Db = Awaited<ReturnType<typeof createTestDb>>;

// The Classic Tee's colours on main before #14 added more; the prefetch warms
// exactly these.
const CLASSIC_PREFETCHED = [
  "White", "Vintage White", "Soft Cream", "Heather Dust", "Natural", "Tan",
  "Pebble", "Athletic Heather", "Dark Grey", "Black", "Red", "Maroon",
  "Burnt Orange", "Orange", "Mustard", "Pink", "Mauve", "Team Purple", "Sage",
  "Forest", "Kelly", "Aqua", "Baby Blue", "True Royal", "Navy",
];

async function seedDesign(db: Db) {
  await makeUser(db, "seller");
  const design = await makeDesign(db, "seller");
  await makeSourceImage(db, {
    designId: design.id,
    ownerId: "seller",
    imageUrl: "https://img.example/art.png",
  });
  return design;
}

function sentVariantIds(): number[] {
  expect(printful.createMockupTask).toHaveBeenCalledTimes(1);
  return printful.createMockupTask.mock.calls[0][1] as number[];
}

function mVariant(productId: string, color: string): number {
  const b = getBlankOrThrow(productId);
  const sizes = b.variants[color];
  return sizes["M"] ?? Object.values(sizes)[0];
}

beforeEach(async () => {
  h.db = await createTestDb();
  printful.createMockupTask.mockClear();
  printful.pollMockupTask.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("prefetchProductMockups", () => {
  it("sends exactly the Classic Tee's original 25 colours (size M)", async () => {
    const design = await seedDesign(h.db as Db);
    await prefetchProductMockups(design.id, "bella-canvas-3001");
    expect(sentVariantIds().sort((a, b) => a - b)).toEqual(
      CLASSIC_PREFETCHED.map((c) => mVariant("bella-canvas-3001", c)).sort(
        (a, b) => a - b
      )
    );
  });

  it.each([
    "cotton-heritage-mc1087",
    "bella-canvas-6400",
  ])("sends every colour of %s, as before", async (id) => {
    const design = await seedDesign(h.db as Db);
    await prefetchProductMockups(design.id, id);
    const b = getBlankOrThrow(id);
    expect(sentVariantIds().sort((x, y) => x - y)).toEqual(
      b.colors.map((c) => mVariant(id, c.name)).sort((x, y) => x - y)
    );
  });

  it("does not send a colour that was added without joining the prefetch list", async () => {
    const blank = getBlankOrThrow("bella-canvas-3001");
    const original = { colors: blank.colors, variants: blank.variants };
    blank.colors = [...blank.colors, { name: "Test Colour", value: "#123456" }];
    blank.variants = { ...blank.variants, "Test Colour": { M: 999001 } };
    try {
      const design = await seedDesign(h.db as Db);
      await prefetchProductMockups(design.id, "bella-canvas-3001");
      expect(sentVariantIds()).not.toContain(999001);
    } finally {
      blank.colors = original.colors;
      blank.variants = original.variants;
    }
  });

  it("leaves the phone case on the all-colours default", () => {
    // Its only placement is "default", so prefetchProductMockups returns at
    // getPlacement(product, "front") on main as well; nothing is sent either way.
    expect(getBlankOrThrow("clear-case-iphone").prefetchColors).toBeUndefined();
  });

  it("only lists prefetch colours the blank actually offers", () => {
    for (const b of BLANKS) {
      const names = new Set(b.colors.map((c) => c.name));
      for (const n of b.prefetchColors ?? []) {
        expect(names.has(n), `${b.id} / ${n}`).toBe(true);
      }
    }
  });

  it("includes the default colour a buyer lands on, for every blank", () => {
    for (const b of BLANKS) {
      const prefetched = b.prefetchColors ?? b.colors.map((c) => c.name);
      expect(prefetched, b.id).toContain(b.colors[0].name);
      if (b.type === "shirt") expect(prefetched, b.id).toContain("White");
    }
    expect(getBlankOrThrow(DEFAULT_BLANK_ID).prefetchColors).toHaveLength(25);
  });
});
