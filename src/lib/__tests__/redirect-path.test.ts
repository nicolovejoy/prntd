import { describe, it, expect } from "vitest";
import { pathWithSearch } from "@/lib/redirect-path";

describe("pathWithSearch", () => {
  it("returns the bare path when there is nothing to carry", () => {
    expect(pathWithSearch("/designs", {})).toBe("/designs");
  });

  it("appends a single param", () => {
    expect(pathWithSearch("/designs", { x: "1" })).toBe("/designs?x=1");
  });

  it("repeats a key for an array value", () => {
    expect(pathWithSearch("/designs", { x: ["1", "2"] })).toBe(
      "/designs?x=1&x=2"
    );
  });

  it("drops undefined values", () => {
    expect(pathWithSearch("/designs", { x: "1", y: undefined })).toBe(
      "/designs?x=1"
    );
  });

  it("carries multiple keys", () => {
    expect(pathWithSearch("/designs", { x: "1", y: "2" })).toBe(
      "/designs?x=1&y=2"
    );
  });
});
