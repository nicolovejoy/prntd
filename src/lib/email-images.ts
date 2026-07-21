/**
 * Resolve the hero image(s) shown in product emails (order confirmation, owner
 * alert, shipping notification).
 *
 * Prefers the real Printful shirt mockup cached on `design.mockupUrls` (the same
 * render the customer approved on /preview). Falls back to the design artwork on
 * a shirt-color backdrop — the /orders thumbnail treatment — when no mockup is
 * cached (e.g. buy-existing or a scale we didn't render). A back image is
 * included only when the order actually has a `back` placement (#25): front-only
 * orders show one image, front+back orders show two.
 *
 * Pure — no I/O. Callers resolve the mockup map and fallback artwork URLs.
 */
export type EmailImage = {
  label: string; // "Front" | "Back"
  url: string;
  /** Hex backdrop when `url` is a bare transparent artwork PNG; null when it's
   * a full shirt mockup photo (which needs no backdrop). */
  backdrop: string | null;
};

/**
 * Find a cached mockup URL by matching key segments, ignoring the trailing
 * scale segment so a mockup rendered at a non-default scale still resolves.
 * Front keys are `${product}:front:${color}:${scale}`; back keys (which pin a
 * source image) are `${product}:back:${sourceId}:${color}:${scale}`. Keys
 * written since #102 lead with a version segment (`v2:…`) — skip it so both
 * generations resolve: old orders only have old-format entries.
 */
function findCachedMockup(
  mockupUrls: Record<string, string> | null | undefined,
  segments: string[]
): string | null {
  for (const [key, url] of Object.entries(mockupUrls ?? {})) {
    const parts = key.split(":");
    const offset = /^v\d+$/.test(parts[0]) ? 1 : 0;
    if (segments.every((seg, i) => parts[i + offset] === seg)) return url;
  }
  return null;
}

export function resolveOrderEmailImages(opts: {
  productId: string;
  color: string;
  placements: Record<string, string> | null;
  mockupUrls: Record<string, string> | null;
  frontArtworkUrl: string | null;
  backArtworkUrl: string | null;
  backdropHex: string;
}): EmailImage[] {
  const { productId, color, placements, mockupUrls, frontArtworkUrl, backArtworkUrl, backdropHex } = opts;
  const images: EmailImage[] = [];

  // Front — every order has one. Legacy orders may have null placements; treat
  // those as front-only.
  const frontMockup = findCachedMockup(mockupUrls, [productId, "front", color]);
  if (frontMockup) {
    images.push({ label: "Front", url: frontMockup, backdrop: null });
  } else if (frontArtworkUrl) {
    images.push({ label: "Front", url: frontArtworkUrl, backdrop: backdropHex });
  }

  // Back — included iff the order actually pinned a back placement.
  const backSourceId = placements?.back ?? null;
  if (backSourceId) {
    const backMockup = findCachedMockup(mockupUrls, [productId, "back", backSourceId, color]);
    if (backMockup) {
      images.push({ label: "Back", url: backMockup, backdrop: null });
    } else if (backArtworkUrl) {
      images.push({ label: "Back", url: backArtworkUrl, backdrop: backdropHex });
    }
  }

  return images;
}
