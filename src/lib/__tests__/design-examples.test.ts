import { describe, expect, it } from "vitest";
import {
  EXAMPLE_CATEGORIES,
  EXAMPLES,
  pickExamplePrompts,
} from "@/lib/design-examples";

const MAX_CHIP_LENGTH = 38;

/** A deterministic, seedable PRNG so picks are reproducible in tests. */
function seededRand(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 9301 + 49297) % 233280;
    return state / 233280;
  };
}

function categoryOf(prompt: string): string | undefined {
  return EXAMPLE_CATEGORIES.find((c) => c.prompts.includes(prompt))?.name;
}

describe("design-examples", () => {
  it("has exactly 12 categories of exactly 25 prompts each", () => {
    expect(EXAMPLE_CATEGORIES).toHaveLength(12);
    for (const category of EXAMPLE_CATEGORIES) {
      expect(category.prompts).toHaveLength(25);
    }
  });

  it("flattens to exactly 300 prompts", () => {
    expect(EXAMPLES).toHaveLength(300);
  });

  it("has no duplicate prompts across the whole library", () => {
    const unique = new Set(EXAMPLES);
    expect(unique.size).toBe(EXAMPLES.length);
  });

  it("keeps every prompt non-empty and within the chip character cap", () => {
    for (const prompt of EXAMPLES) {
      expect(prompt.length).toBeGreaterThan(0);
      expect(prompt.length).toBeLessThanOrEqual(MAX_CHIP_LENGTH);
    }
  });

  it("picks 3 prompts from 3 distinct categories with a deterministic rand", () => {
    const rand = seededRand(42);
    const picked = pickExamplePrompts(3, rand);

    expect(picked).toHaveLength(3);
    const categories = picked.map((p) => categoryOf(p));
    expect(categories.every((c) => c !== undefined)).toBe(true);
    expect(new Set(categories).size).toBe(3);
  });

  it("is deterministic for a given rand sequence", () => {
    const first = pickExamplePrompts(3, seededRand(7));
    const second = pickExamplePrompts(3, seededRand(7));
    expect(first).toEqual(second);
  });

  it("does not throw when count exceeds the category count", () => {
    const rand = seededRand(1);
    expect(() => pickExamplePrompts(20, rand)).not.toThrow();
    const picked = pickExamplePrompts(20, rand);
    expect(picked).toHaveLength(20);
    for (const prompt of picked) {
      expect(EXAMPLES).toContain(prompt);
    }
  });

  it("returns an empty array for a zero or negative count", () => {
    expect(pickExamplePrompts(0, seededRand(3))).toEqual([]);
    expect(pickExamplePrompts(-1, seededRand(3))).toEqual([]);
  });
});
