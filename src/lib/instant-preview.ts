/**
 * Instant artwork-on-color preview for /preview (#57).
 *
 * The exact Printful mockup takes seconds to render. Instead of hiding the
 * hero behind a spinner while it loads, the page shows the design artwork on
 * a shirt-colored silhouette immediately (the same fallback treatment the
 * order emails use) and crossfades the real mockup in when it arrives.
 *
 * Pure — resolves which layers the hero shows from the render/mockup state.
 */

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
  /** Artwork for the instant silhouette layer (null → bare shirt). */
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
