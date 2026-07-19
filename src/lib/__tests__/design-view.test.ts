import { describe, it, expect } from "vitest";
import { isDesignEmpty, dedupeById } from "@/lib/design-view";

describe("isDesignEmpty", () => {
  it("is empty with zero messages and zero images", () => {
    expect(isDesignEmpty(0, 0)).toBe(true);
  });

  it("is not empty once there is a chat message", () => {
    expect(isDesignEmpty(1, 0)).toBe(false);
  });

  it("is not empty once there is an image (e.g. R2-recovered design)", () => {
    expect(isDesignEmpty(0, 1)).toBe(false);
  });

  it("is not empty with both messages and images", () => {
    expect(isDesignEmpty(3, 2)).toBe(false);
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
