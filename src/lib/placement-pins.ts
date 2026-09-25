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

/**
 * The front to pin on an image detail page purchase (#138 slice 3). That page
 * offers no front picker, only a swap (§1, open question 1): the page's own
 * image is always printed, because `order.designId`, `order.storeProductId`
 * and the page URL all name it. So:
 *
 *  - no `front`, or `front` equal to the page image → the page image;
 *  - any other `front` → allowed only as a swap, i.e. when the page image is
 *    the back. Anything else throws.
 *
 * This is the shape rule only. Callers still run the placement guard
 * (`assertUsablePlacementImage`) on a front that differs from the page image,
 * and must pass the back they will actually pin — after the
 * MULTI_PLACEMENT_ENABLED gate — so a back that gets dropped also refuses the
 * override instead of printing the other image alone.
 */
export function resolveBuyPageFront(params: {
  pageImageId: string;
  front: string | null | undefined;
  back: string | null | undefined;
}): string {
  const { pageImageId, front, back } = params;
  if (!front || front === pageImageId) return pageImageId;
  if (back !== pageImageId) {
    throw new Error("A different front needs this design on the back");
  }
  return front;
}

/** An image on one side of the shirt: its id and its artwork URL. */
export type PlacementPick = { id: string; imageUrl: string };

/**
 * The two sides the image detail page's buy panel shows (#138 slice 3):
 * `page` is the listing's own image, `added` the back design the buyer
 * picked, `swapped` whether they exchanged the two. Swapping with nothing
 * added changes nothing — there is no back to exchange with.
 */
export function buyPagePlacements(params: {
  page: PlacementPick;
  added: PlacementPick | null;
  swapped: boolean;
}): { front: PlacementPick; back: PlacementPick | null } {
  const { page, added, swapped } = params;
  if (!added) return { front: page, back: null };
  return swapped ? { front: added, back: page } : { front: page, back: added };
}
