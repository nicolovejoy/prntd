import { describe, it, expect } from "vitest";
import {
  imageDeleteSkipCopy,
  type ImageDeleteSkipReason,
} from "@/lib/library-view";

describe("imageDeleteSkipCopy", () => {
  it("names the order case explicitly", () => {
    expect(imageDeleteSkipCopy("order")).toBe("Used in an order");
  });

  it("collapses the reference cases into one phrase", () => {
    expect(imageDeleteSkipCopy("in-use")).toBe("Used elsewhere");
  });

  it("says the same thing for an id it will not touch", () => {
    expect(imageDeleteSkipCopy("not-owned")).toBe(
      imageDeleteSkipCopy("not-found")
    );
  });

  it("covers every reason with a non-empty phrase", () => {
    const reasons: ImageDeleteSkipReason[] = [
      "order",
      "in-use",
      "not-owned",
      "not-found",
    ];
    for (const r of reasons) expect(imageDeleteSkipCopy(r).length).toBeGreaterThan(0);
  });
});
