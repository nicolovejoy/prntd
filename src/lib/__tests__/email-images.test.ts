import { describe, it, expect } from "vitest";
import { resolveOrderEmailImages } from "../email-images";

const BASE = {
  productId: "bella-canvas-3001",
  color: "White",
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

  it("omits an image entirely when neither mockup nor artwork is available", () => {
    const images = resolveOrderEmailImages({
      ...BASE,
      frontArtworkUrl: null,
      placements: { front: "img-front" },
      mockupUrls: null,
    });
    expect(images).toHaveLength(0);
  });
});
