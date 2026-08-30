import { describe, it, expect } from "vitest";
import { getGenerator, DEFAULT_GENERATOR_ID, GENERATORS } from "../registry";

describe("getGenerator", () => {
  it("returns the default for a null id", () => {
    expect(getGenerator(null).id).toBe(DEFAULT_GENERATOR_ID);
  });

  it("returns the default for an unknown id", () => {
    expect(getGenerator("nope").id).toBe(DEFAULT_GENERATOR_ID);
  });

  it("returns the requested adapter when known", () => {
    expect(getGenerator("ideogram").id).toBe("ideogram");
  });

  it("falls back to the default for a removed adapter id (historical rows)", () => {
    expect(getGenerator("recraft").id).toBe(DEFAULT_GENERATOR_ID);
  });

  it("every adapter prices an edit above a generation", () => {
    for (const g of Object.values(GENERATORS)) {
      const generate = g.costFor({
        kind: "generate",
        spec: { subject: "a cat", elements: [{ type: "obj", desc: "a cat" }] },
      });
      const edit = g.costFor({
        kind: "edit",
        instruction: "bigger",
        anchorImageUrl: "https://r2/a.png",
      });
      expect(edit).toBeGreaterThan(generate);
    }
  });

  it("the default id is a registered adapter", () => {
    expect(GENERATORS[DEFAULT_GENERATOR_ID]).toBeDefined();
  });
});
