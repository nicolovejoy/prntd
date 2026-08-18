/**
 * Pure helpers for the per-purchase placement pins on the buy surfaces
 * (#138). The front pin is client state on /preview: null means "the
 * design's primary image" — the default that keeps URLs, cancel links and
 * checkout payloads byte-identical to the pre-#138 shape (open question 4:
 * a `front` param means "not the default").
 */

export type PlacementPins = {
  /** Front pin — null when the design's primary fills the front (default). */
  front: string | null;
  back: string | null;
};

/**
 * Normalize a front pick: choosing the design's primary image is the
 * default, not a pin. Everything downstream (URL param, checkout `front`,
 * mockup source threading) keys off "pin present", so collapsing
 * picked-the-primary to null keeps the common case on the exact code path
 * and cache keys in use before the picker existed.
 */
export function normalizeFrontPin(
  pickedId: string,
  primaryImageId: string | null
): string | null {
  return pickedId === primaryImageId ? null : pickedId;
}

/**
 * Literal exchange of the two placement ids (§2): {front: A, back: B} →
 * {front: B, back: A}. Callers only offer Swap when both placements are
 * filled — swapping into an empty back would strand the front (a required
 * placement) empty and silently add the back upcharge.
 */
export function swapPlacementPins(params: {
  /** The effective front id (the pin, or the primary when unpinned). */
  frontImageId: string;
  backImageId: string;
  primaryImageId: string | null;
}): PlacementPins {
  return {
    front: normalizeFrontPin(params.backImageId, params.primaryImageId),
    back: params.frontImageId,
  };
}
