/**
 * Mockup cache keys — the single source for both the `design.mockupUrls`
 * DB/client cache key and the R2 object key a mockup is uploaded under.
 *
 * The two keys must carry the same distinguishing parts. #102 was the two
 * drifting: the DB key included product/source/scale but the R2 key was only
 * `{color}-{placement}.jpg`, so every back-source (and product, and scale)
 * choice overwrote one shared object and stale cache entries served the
 * wrong artwork — always the last-rendered one.
 *
 * The `v2` version segment retires every pre-#102 cache entry: those URLs
 * point at collided objects whose bytes are whatever rendered last, so they
 * must never satisfy a lookup again. Old entries stay in the JSON untouched —
 * emails for already-placed orders still resolve them (content may be wrong
 * for old orders; that was true the moment the collision happened).
 */

const MOCKUP_CACHE_VERSION = "v2";

export type MockupKeyParts = {
  productId: string;
  placementId: string;
  /** Source image the placement was rendered from — non-front only. */
  sourceImageId?: string | null;
  colorName: string;
  /** Scale as an integer percentage, e.g. 100 for 1.0. */
  scaleKey: number;
};

/** DB/client cache key for `design.mockupUrls`. */
export function mockupCacheKey(p: MockupKeyParts): string {
  const src = p.sourceImageId ? `:${p.sourceImageId}` : "";
  return `${MOCKUP_CACHE_VERSION}:${p.productId}:${p.placementId}${src}:${p.colorName}:${p.scaleKey}`;
}

/** Prefix matching every current-version cache entry for a product. */
export function mockupCacheProductPrefix(productId: string): string {
  return `${MOCKUP_CACHE_VERSION}:${productId}:`;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/**
 * R2 object key for an uploaded mockup. Carries every part the cache key
 * distinguishes, plus a content hash so re-renders of the same combination
 * (e.g. after the design regenerates) get a fresh URL instead of mutating
 * bytes behind one the browser has cached.
 */
export function mockupObjectKey(
  designId: string,
  p: MockupKeyParts,
  contentHash: string
): string {
  const src = p.sourceImageId ? `-${slug(p.sourceImageId)}` : "";
  return `designs/${designId}/mockups/${slug(p.productId)}-${slug(p.colorName)}-${slug(p.placementId)}${src}-s${p.scaleKey}-${contentHash}.jpg`;
}
