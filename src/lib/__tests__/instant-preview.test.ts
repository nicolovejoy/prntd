import { describe, it, expect } from "vitest";
import {
  isDarkShirt,
  mockupBackdrop,
  relativeLuminance,
  resolveHeroDisplay,
  type HeroDisplayInput,
} from "../instant-preview";

const base: HeroDisplayInput = {
  renderStatus: "ready",
  artworkUrl: "https://r2/art.png",
  lastArtworkUrl: null,
  mockupUrl: null,
  mockupLoading: false,
  mockupError: false,
  loadedMockupUrl: null,
};

describe("resolveHeroDisplay", () => {
  it("first load: render resolving, no artwork yet -> bare shirt + pending", () => {
    const d = resolveHeroDisplay({
      ...base,
      renderStatus: "loading",
      artworkUrl: null,
    });
    expect(d).toEqual({
      showError: false,
      artworkUrl: null,
      mockupUrl: null,
      mockupVisible: false,
      pendingExact: true,
    });
  });

  it("render ready, mockup fetch not yet triggered -> artwork + pending", () => {
    const d = resolveHeroDisplay(base);
    expect(d.artworkUrl).toBe("https://r2/art.png");
    expect(d.mockupUrl).toBeNull();
    expect(d.pendingExact).toBe(true);
  });

  it("mockup fetch in flight -> artwork stays, pending", () => {
    const d = resolveHeroDisplay({ ...base, mockupLoading: true });
    expect(d.artworkUrl).toBe("https://r2/art.png");
    expect(d.mockupUrl).toBeNull();
    expect(d.pendingExact).toBe(true);
  });

  it("mockup fetched but image bytes not loaded -> mounted, hidden, pending", () => {
    const d = resolveHeroDisplay({ ...base, mockupUrl: "https://r2/mock.png" });
    expect(d.mockupUrl).toBe("https://r2/mock.png");
    expect(d.mockupVisible).toBe(false);
    expect(d.pendingExact).toBe(true);
  });

  it("mockup image loaded -> visible, not pending", () => {
    const d = resolveHeroDisplay({
      ...base,
      mockupUrl: "https://r2/mock.png",
      loadedMockupUrl: "https://r2/mock.png",
    });
    expect(d.mockupVisible).toBe(true);
    expect(d.pendingExact).toBe(false);
  });

  it("returning to a cached, already-loaded mockup shows it immediately", () => {
    // Color A -> B -> A: A's URL is still the last-loaded image.
    const d = resolveHeroDisplay({
      ...base,
      mockupUrl: "https://r2/mock-a.png",
      loadedMockupUrl: "https://r2/mock-a.png",
    });
    expect(d.mockupVisible).toBe(true);
    expect(d.pendingExact).toBe(false);
  });

  it("stale loaded URL from a previous selection does not show the new mockup", () => {
    const d = resolveHeroDisplay({
      ...base,
      mockupUrl: "https://r2/mock-b.png",
      loadedMockupUrl: "https://r2/mock-a.png",
    });
    expect(d.mockupVisible).toBe(false);
    expect(d.pendingExact).toBe(true);
  });

  it("re-resolving render (product/color change) falls back to last artwork", () => {
    const d = resolveHeroDisplay({
      ...base,
      renderStatus: "loading",
      artworkUrl: null,
      lastArtworkUrl: "https://r2/prev-art.png",
    });
    expect(d.artworkUrl).toBe("https://r2/prev-art.png");
    expect(d.pendingExact).toBe(true);
  });

  it("render error -> error overlay, nothing pending, no mockup mounted", () => {
    const d = resolveHeroDisplay({
      ...base,
      renderStatus: "error",
      artworkUrl: null,
      mockupUrl: "https://r2/mock.png",
    });
    expect(d.showError).toBe(true);
    expect(d.mockupUrl).toBeNull();
    expect(d.pendingExact).toBe(false);
  });

  it("mockup error -> artwork stays, indicator suppressed (retry UI takes over)", () => {
    const d = resolveHeroDisplay({ ...base, mockupError: true });
    expect(d.artworkUrl).toBe("https://r2/art.png");
    expect(d.pendingExact).toBe(false);
  });

  it("idle (back placement, no source picked) -> nothing pending", () => {
    const d = resolveHeroDisplay({
      ...base,
      renderStatus: "idle",
      artworkUrl: null,
    });
    expect(d.pendingExact).toBe(false);
    expect(d.artworkUrl).toBeNull();
  });

  it("in-flight fetch never mounts a mockup even if state briefly overlaps", () => {
    const d = resolveHeroDisplay({
      ...base,
      mockupLoading: true,
      mockupUrl: "https://r2/mock.png",
    });
    expect(d.mockupUrl).toBeNull();
  });
});

describe("relativeLuminance", () => {
  it("black is 0, white is 1", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1);
  });

  it("supports 3-digit hex", () => {
    expect(relativeLuminance("#fff")).toBeCloseTo(1);
  });

  it("unparseable input is treated as white (no dark-shirt branch)", () => {
    expect(relativeLuminance("navy")).toBe(1);
  });
});

describe("mockupBackdrop", () => {
  it("dark shirts get the light-neutral backdrop", () => {
    expect(isDarkShirt("#000000")).toBe(true);
    expect(mockupBackdrop("#000000")).toBe("#ececec");
    // Navy (Bella 3001 palette)
    expect(mockupBackdrop("#212642")).toBe("#ececec");
  });

  it("light shirts get near-white so multiply doesn't tint the garment", () => {
    expect(isDarkShirt("#ffffff")).toBe(false);
    expect(mockupBackdrop("#ffffff")).toBe("#f7f7f7");
    // Yellow
    expect(mockupBackdrop("#ffd667")).toBe("#f7f7f7");
  });
});
