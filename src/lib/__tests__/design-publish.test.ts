import { describe, it, expect } from "vitest";
import {
  imageReferencedByOrders,
  canBuyPublishedImage,
  canUseAsPlacementSource,
  buildForkChain,
  dedupeFeedByDesign,
  type ForkChainRow,
} from "../design-publish";
import { design, designImage } from "../db/schema";

describe("imageReferencedByOrders", () => {
  it("returns false when the design has no orders", () => {
    expect(imageReferencedByOrders("img1", "img1", [])).toBe(false);
  });

  it("returns true when the image is pinned in an order's placements", () => {
    expect(
      imageReferencedByOrders("img1", "other", [
        { placements: { front: "img1" } },
      ])
    ).toBe(true);
  });

  it("returns false when placements reference a different image", () => {
    expect(
      imageReferencedByOrders("img1", "other", [
        { placements: { front: "img2" } },
      ])
    ).toBe(false);
  });

  it("returns true for the primary image when a legacy order has null placements", () => {
    expect(
      imageReferencedByOrders("img1", "img1", [{ placements: null }])
    ).toBe(true);
  });

  it("returns true for the primary image when a legacy order has empty placements", () => {
    expect(
      imageReferencedByOrders("img1", "img1", [{ placements: {} }])
    ).toBe(true);
  });

  it("returns false for a non-primary image when the only order has null placements", () => {
    expect(
      imageReferencedByOrders("img2", "img1", [{ placements: null }])
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

  it("design_image.generator is nullable", () => {
    expect(designImage.generator.notNull).toBe(false);
  });

  it("design.activeGeneratorId is nullable", () => {
    expect(design.activeGeneratorId.notNull).toBe(false);
  });
});

describe("dedupeFeedByDesign", () => {
  const row = (imageId: string, designId: string, iso: string) => ({
    imageId,
    designId,
    publishedAt: new Date(iso),
  });

  it("returns one entry per design", () => {
    const out = dedupeFeedByDesign([
      row("img1", "dA", "2026-05-01T00:00:00Z"),
      row("img2", "dA", "2026-05-03T00:00:00Z"),
      row("img3", "dB", "2026-05-02T00:00:00Z"),
    ]);
    expect(out.map((r) => r.designId)).toEqual(["dA", "dB"]);
  });

  it("keeps the most-recently-published image for a design", () => {
    const out = dedupeFeedByDesign([
      row("old", "dA", "2026-05-01T00:00:00Z"),
      row("new", "dA", "2026-05-05T00:00:00Z"),
      row("mid", "dA", "2026-05-03T00:00:00Z"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].imageId).toBe("new");
  });

  it("orders the result newest-first regardless of input order", () => {
    const out = dedupeFeedByDesign([
      row("a", "dA", "2026-05-01T00:00:00Z"),
      row("c", "dC", "2026-05-09T00:00:00Z"),
      row("b", "dB", "2026-05-05T00:00:00Z"),
    ]);
    expect(out.map((r) => r.designId)).toEqual(["dC", "dB", "dA"]);
  });

  it("returns an empty array for empty input", () => {
    expect(dedupeFeedByDesign([])).toEqual([]);
  });

  it("passes through extra fields on the kept row", () => {
    const out = dedupeFeedByDesign([
      { imageId: "x", designId: "dA", publishedAt: new Date("2026-05-02T00:00:00Z"), title: "Keep me" },
      { imageId: "y", designId: "dA", publishedAt: new Date("2026-05-01T00:00:00Z"), title: "Drop me" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("Keep me");
  });
});

describe("canUseAsPlacementSource (#72)", () => {
  const base = { designId: "d-other", publishedAt: null, isHidden: false };
  const ctx = { imageOwnerId: "owner", orderDesignId: "d-order", userId: "buyer" };

  it("allows an unpublished image from the order's design when the user owns it (This design on /preview)", () => {
    expect(
      canUseAsPlacementSource({
        image: { ...base, designId: "d-order" },
        ...ctx,
        imageOwnerId: "buyer",
      })
    ).toBe(true);
  });

  it("rejects a private image from the order's design thread when the user does NOT own it", () => {
    // The /d cross-owner case: orderDesignId is the SELLER's design, so a
    // forged id from that thread must not print the seller's private work.
    expect(
      canUseAsPlacementSource({
        image: { ...base, designId: "d-order" },
        ...ctx,
      })
    ).toBe(false);
  });

  it("allows an image whose design the user owns (My Designs)", () => {
    expect(
      canUseAsPlacementSource({
        image: base,
        ...ctx,
        imageOwnerId: "buyer",
      })
    ).toBe(true);
  });

  it("allows a published, not-hidden image from anyone (Shop)", () => {
    expect(
      canUseAsPlacementSource({
        image: { ...base, publishedAt: new Date() },
        ...ctx,
      })
    ).toBe(true);
  });

  it("rejects a stranger's unpublished image", () => {
    expect(canUseAsPlacementSource({ image: base, ...ctx })).toBe(false);
  });

  it("rejects a published-but-hidden image (moderation wins)", () => {
    expect(
      canUseAsPlacementSource({
        image: { ...base, publishedAt: new Date(), isHidden: true },
        ...ctx,
      })
    ).toBe(false);
  });
});
