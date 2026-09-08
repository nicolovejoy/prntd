import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

// "From $19.43" kept coming back. It first shipped in the landing hero on
// 2026-07-05 via minRetailPrice(), an item-price floor that excludes the flat
// shipping line — so it is a number no customer pays. It was deleted from the
// hero (#214) and the Pricing section (#215), then reappeared on the Shop
// card (#222) and the image detail page (#224) because the helper survived
// and the design docs still prescribed "a price line". Owner rule (Nico,
// 2026-09-08): no price before the buyer has picked garment and size.
//
// This guard fails CI if product code grows a "From $" string or a
// catalog-floor helper again. Sibling of no-window-alert.test.ts.
const SRC = join(__dirname, "../..");

const FROM_PRICE = /From \$/;
const FLOOR_HELPER = /\b(minRetailPrice|cheapestActiveBlank|cardPriceLine)\b/;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      sourceFiles(full, out);
      continue;
    }
    if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("no price before garment + size are picked", () => {
  it("finds source files to scan", () => {
    expect(sourceFiles(SRC).length).toBeGreaterThan(100);
  });

  it('has no "From $" copy in product code', () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => FROM_PRICE.test(readFileSync(file, "utf-8")))
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });

  it("has no catalog-floor price helper", () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => FLOOR_HELPER.test(readFileSync(file, "utf-8")))
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });
});
