import { describe, it, expect } from "vitest";
import { defaultSortForShirt, sortBySuitability } from "@/lib/back-source-sort";

const img = (id: string, luminance: number | null) => ({ id, luminance });

describe("defaultSortForShirt (#139)", () => {
  it("puts dark designs first on a light shirt and light designs first on a dark one", () => {
    expect(defaultSortForShirt("#ffffff")).toBe("dark-first");
    expect(defaultSortForShirt("#000000")).toBe("light-first");
  });

  it("splits at relative luminance 0.18: #808080 (0.216) is light, #666666 (0.133) is dark", () => {
    expect(defaultSortForShirt("#808080")).toBe("dark-first");
    expect(defaultSortForShirt("#666666")).toBe("light-first");
  });
});

describe("sortBySuitability (#139)", () => {
  const input = [img("mid", 0.5), img("none1", null), img("light", 0.9), img("dark", 0.1), img("none2", null)];

  it("light-first: lightest to darkest, unscored last in their own order", () => {
    expect(sortBySuitability(input, "light-first").map((i) => i.id)).toEqual(["light", "mid", "dark", "none1", "none2"]);
  });

  it("dark-first: darkest to lightest, unscored still last", () => {
    expect(sortBySuitability(input, "dark-first").map((i) => i.id)).toEqual(["dark", "mid", "light", "none1", "none2"]);
  });

  it("is stable on ties and does not mutate its input", () => {
    const tied = [img("a", 0.4), img("b", 0.4), img("c", 0.4)];
    const copy = [...tied];
    expect(sortBySuitability(tied, "dark-first").map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(sortBySuitability(tied, "light-first").map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(tied).toEqual(copy);
  });

  it("all unscored keeps the incoming order", () => {
    const all = [img("x", null), img("y", null)];
    expect(sortBySuitability(all, "light-first").map((i) => i.id)).toEqual(["x", "y"]);
  });
});
