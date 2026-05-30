import { describe, it, expect } from "vitest";
import {
  isLocked,
  assertNotLocked,
  canFork,
  canBuyPublishedImage,
  buildForkChain,
  type ForkChainRow,
} from "../design-publish";
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

describe("canBuyPublishedImage", () => {
  const published = { publishedAt: new Date(), isHidden: false };
  const unpublished = { publishedAt: null, isHidden: false };
  const hidden = { publishedAt: new Date(), isHidden: true };

  it("allows buying a published, non-hidden image", () => {
    expect(canBuyPublishedImage(published)).toBe(true);
  });

  it("rejects an unpublished image (no owner shortcut — use the design flow)", () => {
    expect(canBuyPublishedImage(unpublished)).toBe(false);
  });

  it("rejects a hidden image even if published", () => {
    expect(canBuyPublishedImage(hidden)).toBe(false);
  });
});

describe("buildForkChain", () => {
  const published = (id: string, designer: string, parent: string | null): ForkChainRow => ({
    imageId: id,
    title: `Title ${id}`,
    designerName: designer,
    forkedFromImageId: parent,
    publishedAt: new Date("2026-05-27T00:00:00Z"),
    isHidden: false,
  });

  function makeFetcher(rows: ForkChainRow[]) {
    const map = new Map(rows.map((r) => [r.imageId, r]));
    return async (id: string) => map.get(id) ?? null;
  }

  it("returns empty array when startImageId is null", async () => {
    const chain = await buildForkChain(null, async () => null);
    expect(chain).toEqual([]);
  });

  it("returns single entry for one-hop chain", async () => {
    const fetcher = makeFetcher([published("a", "Alice", null)]);
    const chain = await buildForkChain("a", fetcher);
    expect(chain).toEqual([
      { imageId: "a", title: "Title a", designerName: "Alice" },
    ]);
  });

  it("walks multi-hop chain immediate-parent-first", async () => {
    const fetcher = makeFetcher([
      published("c", "Carol", "b"),
      published("b", "Bob", "a"),
      published("a", "Alice", null),
    ]);
    const chain = await buildForkChain("c", fetcher);
    expect(chain.map((c) => c.imageId)).toEqual(["c", "b", "a"]);
  });

  it("stops at first invisible link (unpublished)", async () => {
    const fetcher = makeFetcher([
      published("c", "Carol", "b"),
      { ...published("b", "Bob", "a"), publishedAt: null },
      published("a", "Alice", null),
    ]);
    const chain = await buildForkChain("c", fetcher);
    expect(chain.map((c) => c.imageId)).toEqual(["c"]);
  });

  it("stops at first invisible link (hidden)", async () => {
    const fetcher = makeFetcher([
      published("c", "Carol", "b"),
      { ...published("b", "Bob", "a"), isHidden: true },
      published("a", "Alice", null),
    ]);
    const chain = await buildForkChain("c", fetcher);
    expect(chain.map((c) => c.imageId)).toEqual(["c"]);
  });

  it("stops when row is missing from fetcher", async () => {
    const fetcher = makeFetcher([published("c", "Carol", "missing")]);
    const chain = await buildForkChain("c", fetcher);
    expect(chain.map((c) => c.imageId)).toEqual(["c"]);
  });

  it("respects maxDepth (no runaway)", async () => {
    const rows: ForkChainRow[] = [];
    for (let i = 0; i < 20; i++) {
      rows.push(published(`n${i}`, `D${i}`, i < 19 ? `n${i + 1}` : null));
    }
    const fetcher = makeFetcher(rows);
    const chain = await buildForkChain("n0", fetcher, 5);
    expect(chain).toHaveLength(5);
  });

  it("breaks on cycle without infinite loop", async () => {
    const fetcher = makeFetcher([
      published("a", "Alice", "b"),
      published("b", "Bob", "a"),
    ]);
    const chain = await buildForkChain("a", fetcher);
    expect(chain.map((c) => c.imageId)).toEqual(["a", "b"]);
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
