import { describe, it, expect } from "vitest";
import { isDesignEmpty } from "@/lib/design-view";

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
