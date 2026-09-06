import { describe, it, expect } from "vitest";
import {
  bulkImageDeleteConsequence,
  bulkImageDeleteNotice,
  bulkImageDeleteTitle,
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

  it("distinguishes a failed write from a kept image", () => {
    expect(imageDeleteSkipCopy("failed")).toBe("Couldn't delete");
    expect(imageDeleteSkipCopy("failed")).not.toBe(imageDeleteSkipCopy("in-use"));
  });

  it("covers every reason with a non-empty phrase", () => {
    const reasons: ImageDeleteSkipReason[] = [
      "order",
      "in-use",
      "not-owned",
      "not-found",
      "failed",
    ];
    for (const r of reasons) expect(imageDeleteSkipCopy(r).length).toBeGreaterThan(0);
  });
});

describe("bulkImageDeleteTitle", () => {
  it("names the one-image case without a number", () => {
    expect(bulkImageDeleteTitle(1)).toBe("Delete this image?");
  });

  it("counts the rest", () => {
    expect(bulkImageDeleteTitle(3)).toBe("Delete 3 images?");
  });
});

describe("bulkImageDeleteConsequence", () => {
  it("is one line, the same either way", () => {
    expect(bulkImageDeleteConsequence(1)).toBe(
      "Images used in an order are kept."
    );
    expect(bulkImageDeleteConsequence(4)).toBe(bulkImageDeleteConsequence(1));
  });
});

describe("bulkImageDeleteNotice", () => {
  it("says nothing when nothing was skipped", () => {
    expect(bulkImageDeleteNotice([])).toBeNull();
  });

  it("states the one skipped image's reason", () => {
    expect(bulkImageDeleteNotice([{ imageId: "a", reason: "order" }])).toBe(
      "1 image wasn't deleted — Used in an order."
    );
  });

  it("groups by reason with counts, in one sentence", () => {
    expect(
      bulkImageDeleteNotice([
        { imageId: "a", reason: "order" },
        { imageId: "b", reason: "in-use" },
        { imageId: "c", reason: "order" },
      ])
    ).toBe("3 images weren't deleted — Used in an order (2), Used elsewhere (1).");
  });

  it("collapses not-owned and not-found into one group", () => {
    expect(
      bulkImageDeleteNotice([
        { imageId: "a", reason: "not-owned" },
        { imageId: "b", reason: "not-found" },
      ])
    ).toBe("2 images weren't deleted — No longer available (2).");
  });

  it("reports a failed write with the rest", () => {
    expect(
      bulkImageDeleteNotice([
        { imageId: "a", reason: "failed" },
        { imageId: "b", reason: "order" },
      ])
    ).toBe("2 images weren't deleted — Used in an order (1), Couldn't delete (1).");
  });
});
