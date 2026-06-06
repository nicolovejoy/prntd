import { describe, it, expect } from "vitest";
import { compareSummary, dedupeById } from "@/lib/compare";

describe("compareSummary", () => {
  it("reports a clean two-style compare with plural grammar", () => {
    expect(compareSummary(["Ideogram", "Recraft"], [])).toBe(
      "Drew 2 styles — tap one to keep working with it."
    );
  });

  it("uses singular grammar for a single success (no '1 styles')", () => {
    expect(compareSummary(["Ideogram"], [])).toBe(
      "Drew 1 style — tap it to keep working with it."
    );
  });

  it("is honest about a partial failure and names the missing style", () => {
    // This is the #19 case: one generator failed silently, the old copy said
    // "Compared 1 generators".
    expect(compareSummary(["Ideogram"], ["Recraft"])).toBe(
      "Drew 1 of 2 styles — Recraft didn't return an image. Tap it to keep working with it."
    );
  });

  it("names multiple failures with an oxford-comma list and plural verb", () => {
    expect(compareSummary(["Ideogram"], ["Recraft", "Flux"])).toBe(
      "Drew 1 of 3 styles — Recraft and Flux didn't return images. Tap it to keep working with it."
    );
  });

  it("keeps 'tap one' when more than one succeeded alongside a failure", () => {
    expect(compareSummary(["Ideogram", "Recraft"], ["Flux"])).toBe(
      "Drew 2 of 3 styles — Flux didn't return an image. Tap one to keep working with it."
    );
  });

  it("formats a three-name failure list with an oxford comma", () => {
    expect(compareSummary(["Ideogram"], ["A", "B", "C"])).toBe(
      "Drew 1 of 4 styles — A, B, and C didn't return images. Tap it to keep working with it."
    );
  });

  it("falls back to a retry nudge when nothing succeeded", () => {
    expect(compareSummary([], ["Ideogram", "Recraft"])).toBe(
      "No styles came back — try again?"
    );
  });
});

describe("dedupeById", () => {
  it("returns the list unchanged when ids are unique", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(dedupeById(items)).toEqual(items);
  });

  it("drops later items that repeat an id, keeping the first and order", () => {
    const a1 = { id: "a", n: 1 };
    const b = { id: "b", n: 2 };
    const a2 = { id: "a", n: 3 };
    expect(dedupeById([a1, b, a2])).toEqual([a1, b]);
  });

  it("handles an empty list", () => {
    expect(dedupeById([])).toEqual([]);
  });
});
