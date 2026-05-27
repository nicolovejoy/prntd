import { describe, it, expect } from "vitest";
import { isLocked, assertNotLocked, canFork } from "../design-publish";
import { design, designImage } from "../db/schema";

describe("isLocked", () => {
  it("returns false when publishedAt is null", () => {
    expect(isLocked({ publishedAt: null })).toBe(false);
  });

  it("returns true when publishedAt is a Date", () => {
    expect(isLocked({ publishedAt: new Date("2026-05-26T00:00:00Z") })).toBe(true);
  });

  it("returns true even at the epoch (any Date locks)", () => {
    expect(isLocked({ publishedAt: new Date(0) })).toBe(true);
  });
});

describe("assertNotLocked", () => {
  it("does not throw when publishedAt is null", () => {
    expect(() => assertNotLocked({ publishedAt: null })).not.toThrow();
  });

  it("throws when publishedAt is set", () => {
    expect(() =>
      assertNotLocked({ publishedAt: new Date("2026-05-26T00:00:00Z") })
    ).toThrow(/locked/i);
  });
});

describe("canFork", () => {
  const published = { publishedAt: new Date(), isHidden: false };
  const unpublished = { publishedAt: null, isHidden: false };
  const hidden = { publishedAt: new Date(), isHidden: true };
  const ownerId = "user-A";
  const otherId = "user-B";

  it("owner can fork their own unpublished image", () => {
    expect(
      canFork({
        sourceImage: unpublished,
        sourceDesign: { userId: ownerId },
        callerId: ownerId,
      })
    ).toBe(true);
  });

  it("owner can fork their own published image", () => {
    expect(
      canFork({
        sourceImage: published,
        sourceDesign: { userId: ownerId },
        callerId: ownerId,
      })
    ).toBe(true);
  });

  it("owner can fork their own hidden image (self-fork bypasses moderation)", () => {
    expect(
      canFork({
        sourceImage: hidden,
        sourceDesign: { userId: ownerId },
        callerId: ownerId,
      })
    ).toBe(true);
  });

  it("non-owner can fork a published, non-hidden image", () => {
    expect(
      canFork({
        sourceImage: published,
        sourceDesign: { userId: ownerId },
        callerId: otherId,
      })
    ).toBe(true);
  });

  it("non-owner cannot fork an unpublished image", () => {
    expect(
      canFork({
        sourceImage: unpublished,
        sourceDesign: { userId: ownerId },
        callerId: otherId,
      })
    ).toBe(false);
  });

  it("non-owner cannot fork a hidden image", () => {
    expect(
      canFork({
        sourceImage: hidden,
        sourceDesign: { userId: ownerId },
        callerId: otherId,
      })
    ).toBe(false);
  });
});

describe("schema columns", () => {
  it("design_image.publishedAt is nullable with no default", () => {
    expect(designImage.publishedAt.notNull).toBe(false);
    expect(designImage.publishedAt.default).toBeUndefined();
  });

  it("design_image.isHidden defaults to false and is not null", () => {
    expect(designImage.isHidden.notNull).toBe(true);
    expect(designImage.isHidden.default).toBe(false);
  });

  it("design_image.title is nullable", () => {
    expect(designImage.title.notNull).toBe(false);
  });

  it("design_image.description is nullable", () => {
    expect(designImage.description.notNull).toBe(false);
  });

  it("design.originalDesignerId is nullable", () => {
    expect(design.originalDesignerId.notNull).toBe(false);
  });

  it("design.forkedFromImageId is nullable", () => {
    expect(design.forkedFromImageId.notNull).toBe(false);
  });
});
