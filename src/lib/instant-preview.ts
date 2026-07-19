/**
 * Instant artwork-on-color preview for /preview (#57).
 *
 * The exact Printful mockup takes seconds to render. Instead of hiding the
 * hero behind a spinner while it loads, the page shows the design artwork
 * centered on a flat panel of the selected shirt color immediately and
 * crossfades the real mockup in when it arrives.
 *
 * Pure — resolves which layers the hero shows from the render/mockup state,
 * plus the color math for the mockup backdrop.
 */

/** WCAG relative luminance of a #rgb/#rrggbb color (0 = black, 1 = white). */
export function relativeLuminance(hex: string): number {
  let h = hex.replace(/^#/, "");
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return 1; // unparseable → treat as white
  const channel = (i: number) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/** A shirt color dark enough to vanish against the dark site chrome. */
export function isDarkShirt(colorHex: string): boolean {
  return relativeLuminance(colorHex) < 0.35;
}

/**
 * Backdrop behind the Printful mockup. The mockup ships with a white studio
 * background baked in; rendering the <img> with mix-blend-multiply over this
 * backdrop makes those white pixels take the backdrop color. Multiply against
 * a dark tone would darken the shirt itself (the site background is near
 * black), so both branches are light: dark shirts get a clearly light
 * neutral so they read, light shirts get near-white so the blend doesn't
 * tint the garment.
 */
export function mockupBackdrop(colorHex: string): string {
  return isDarkShirt(colorHex) ? "#ececec" : "#f7f7f7";
}

export type HeroDisplayInput = {
  /** Placement-render state for the active (product, placement, source). */
  renderStatus: "idle" | "loading" | "ready" | "error";
  /** Artwork URL of the current ready render; null while loading. */
  artworkUrl: string | null;
  /** Most recent ready artwork for the active placement — keeps the instant
   * layer populated while a product/color change re-resolves the render. */
  lastArtworkUrl: string | null;
  /** The Printful mockup URL for the current selection, if fetched. */
  mockupUrl: string | null;
  mockupLoading: boolean;
  mockupError: boolean;
  /** URL of the mockup image the browser has finished loading (onLoad). */
  loadedMockupUrl: string | null;
};

export type HeroDisplay = {
  /** Placement render failed — the page shows its error overlay. */
  showError: boolean;
  /** Artwork for the instant layer (null → bare color panel). */
  artworkUrl: string | null;
  /** Mockup to mount (and fade in once its bytes load); null while a fetch
   * for the current selection is still in flight. */
  mockupUrl: string | null;
  /** True once the mounted mockup has actually loaded — drives the fade. */
  mockupVisible: boolean;
  /** Show the subtle "Rendering exact preview…" indicator. */
  pendingExact: boolean;
};

export function resolveHeroDisplay(i: HeroDisplayInput): HeroDisplay {
  const showError = i.renderStatus === "error";
  // While a new mockup is being fetched the previous one is already cleared
  // by the page; only mount a mockup that matches the current selection.
  const mockupUrl = !showError && !i.mockupLoading ? i.mockupUrl : null;
  const mockupVisible = mockupUrl !== null && i.loadedMockupUrl === mockupUrl;
  const artworkUrl =
    (i.renderStatus === "ready" ? i.artworkUrl : null) ?? i.lastArtworkUrl;
  // Pending whenever the exact mockup isn't on screen yet but is on its way:
  // render resolving, mockup fetch in flight, fetch about to auto-trigger,
  // or mockup fetched but image bytes still downloading. Suppressed on
  // errors (retry UI takes over) and in idle (nothing will be fetched).
  const pendingExact =
    !showError && !i.mockupError && !mockupVisible && i.renderStatus !== "idle";
  return { showError, artworkUrl, mockupUrl, mockupVisible, pendingExact };
}
