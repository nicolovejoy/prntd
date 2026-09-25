import { describe, it, expect } from "vitest";
import { resolveOrderEmailImages } from "../email-images";

// The /preview shape: the order's front pin IS the design's primary, so the
// source-less front key (a render of that primary) may stand for it.
const BASE = {
  productId: "bella-canvas-3001",
  color: "White",
  primaryImageId: "img-front",
  frontArtworkUrl: "https://r2/front.png",
  backArtworkUrl: "https://r2/back.png",
  backdropHex: "#ffffff",
};

describe("resolveOrderEmailImages", () => {
  it("front-only order → one image", () => {
    const images = resolveOrderEmailImages({
      ...BASE,
      placements: { front: "img-front" },
      mockupUrls: null,
    });
    expect(images).toHaveLength(1);
    expect(images[0].label).toBe("Front");
  });

  it("null placements (legacy order) → front-only", () => {
    const images = resolveOrderEmailImages({ ...BASE, placements: null, mockupUrls: null });
    expect(images).toHaveLength(1);
    expect(images[0].label).toBe("Front");
  });

  it("front+back order → two images, front first", () => {
    const images = resolveOrderEmailImages({
      ...BASE,
      placements: { front: "img-front", back: "img-back" },
      mockupUrls: null,
    });
    expect(images.map((i) => i.label)).toEqual(["Front", "Back"]);
  });

  it("prefers the cached Printful mockup over artwork (no backdrop)", () => {
    const images = resolveOrderEmailImages({
      ...BASE,
      placements: { front: "img-front" },
      mockupUrls: { "bella-canvas-3001:front:White:100": "https://printful/front-mock.png" },
    });
    expect(images[0].url).toBe("https://printful/front-mock.png");
    expect(images[0].backdrop).toBeNull();
  });

  it("falls back to artwork on a shirt-color backdrop when no mockup", () => {
    const images = resolveOrderEmailImages({
      ...BASE,
      placements: { front: "img-front" },
      mockupUrls: {},
    });
    expect(images[0].url).toBe("https://r2/front.png");
    expect(images[0].backdrop).toBe("#ffffff");
  });

  it("matches a cached mockup at a non-default scale (scale-agnostic)", () => {
    const images = resolveOrderEmailImages({
      ...BASE,
      placements: { front: "img-front" },
      mockupUrls: { "bella-canvas-3001:front:White:80": "https://printful/front-80.png" },
    });
    expect(images[0].url).toBe("https://printful/front-80.png");
  });

  it("back mockup keys on the pinned back source id", () => {
    const images = resolveOrderEmailImages({
      ...BASE,
      placements: { front: "img-front", back: "img-back" },
      mockupUrls: {
        "bella-canvas-3001:front:White:100": "https://printful/front-mock.png",
        "bella-canvas-3001:back:img-back:White:100": "https://printful/back-mock.png",
      },
    });
    expect(images.map((i) => i.url)).toEqual([
      "https://printful/front-mock.png",
      "https://printful/back-mock.png",
    ]);
    expect(images.every((i) => i.backdrop === null)).toBe(true);
  });

  it("does not include a back image when no back placement (iff ordered both)", () => {
    const images = resolveOrderEmailImages({
      ...BASE,
      placements: { front: "img-front" },
      mockupUrls: { "bella-canvas-3001:back:img-back:White:100": "https://printful/back-mock.png" },
    });
    expect(images.map((i) => i.label)).toEqual(["Front"]);
  });

  it("matches version-prefixed (v2, #102) cache keys, front and back", () => {
    const images = resolveOrderEmailImages({
      ...BASE,
      placements: { front: "img-front", back: "img-back" },
      mockupUrls: {
        "v2:bella-canvas-3001:front:White:100": "https://printful/v2-front.png",
        "v2:bella-canvas-3001:back:img-back:White:100": "https://printful/v2-back.png",
      },
    });
    expect(images.map((i) => i.url)).toEqual([
      "https://printful/v2-front.png",
      "https://printful/v2-back.png",
    ]);
  });

  it("a version segment alone is not a match (v2-only entries, old-format lookup misses)", () => {
    const images = resolveOrderEmailImages({
      ...BASE,
      placements: { front: "img-front" },
      mockupUrls: { "v2:other-product:front:White:100": "https://printful/wrong.png" },
    });
    expect(images[0].url).toBe("https://r2/front.png");
  });

  it("omits an image entirely when neither mockup nor artwork is available", () => {
    const images = resolveOrderEmailImages({
      ...BASE,
      frontArtworkUrl: null,
      placements: { front: "img-front" },
      mockupUrls: null,
    });
    expect(images).toHaveLength(0);
  });

  // #138: the front follows placements.front, not the design's primary.
  describe("front pin that is not the design's primary", () => {
    const SWAPPED = {
      ...BASE,
      // Seller's design primary is the page image A; the buyer swapped their
      // pick B onto the front.
      primaryImageId: "img-A",
      placements: { front: "img-B", back: "img-A" },
      frontArtworkUrl: "https://r2/B.png",
      backArtworkUrl: "https://r2/A.png",
    };

    it("a swapped order leads with the front pick's own mockup, not the primary's", () => {
      const images = resolveOrderEmailImages({
        ...SWAPPED,
        mockupUrls: {
          // The seller's /preview render of their primary (A)…
          "v2:bella-canvas-3001:front:White:100": "https://printful/A-front.png",
          // …and the image detail page's renders after the swap.
          "v2:bella-canvas-3001:front:img-B:White:100": "https://printful/B-front.png",
          "v2:bella-canvas-3001:back:img-A:White:100": "https://printful/A-back.png",
        },
      });
      expect(images.map((i) => [i.label, i.url])).toEqual([
        ["Front", "https://printful/B-front.png"],
        ["Back", "https://printful/A-back.png"],
      ]);
    });

    it("never substitutes the primary's source-less mockup: falls back to the pick's artwork", () => {
      const images = resolveOrderEmailImages({
        ...SWAPPED,
        mockupUrls: {
          "v2:bella-canvas-3001:front:White:100": "https://printful/A-front.png",
        },
      });
      expect(images[0]).toEqual({
        label: "Front",
        url: "https://r2/B.png",
        backdrop: "#ffffff",
      });
    });

    it("an unswapped buy of a non-primary listing uses that listing's source-keyed mockup", () => {
      const images = resolveOrderEmailImages({
        ...BASE,
        primaryImageId: "img-primary",
        placements: { front: "img-listing" },
        mockupUrls: {
          "v2:bella-canvas-3001:front:White:100": "https://printful/primary-front.png",
          "v2:bella-canvas-3001:front:img-listing:White:100": "https://printful/listing-front.png",
        },
      });
      expect(images[0].url).toBe("https://printful/listing-front.png");
    });

    it("a front pin equal to the primary prefers its source-keyed mockup, else the source-less one", () => {
      const keyed = resolveOrderEmailImages({
        ...BASE,
        placements: { front: "img-front" },
        mockupUrls: {
          "v2:bella-canvas-3001:front:White:100": "https://printful/sourceless.png",
          "v2:bella-canvas-3001:front:img-front:White:100": "https://printful/keyed.png",
        },
      });
      expect(keyed[0].url).toBe("https://printful/keyed.png");

      const sourceless = resolveOrderEmailImages({
        ...BASE,
        placements: { front: "img-front" },
        mockupUrls: {
          "v2:bella-canvas-3001:front:White:100": "https://printful/sourceless.png",
        },
      });
      expect(sourceless[0].url).toBe("https://printful/sourceless.png");
    });
  });
});
