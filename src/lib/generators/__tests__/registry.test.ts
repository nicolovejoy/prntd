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

  it("every adapter's adaptPrompt is identity in v1", () => {
    for (const g of Object.values(GENERATORS)) {
      expect(g.adaptPrompt("hello world")).toBe("hello world");
    }
  });

  it("the default id is a registered adapter", () => {
    expect(GENERATORS[DEFAULT_GENERATOR_ID]).toBeDefined();
  });
});
