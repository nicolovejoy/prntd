/**
 * Pure helpers for the per-purchase placement pins on the buy surfaces
 * (#138). The front pin is client state on /preview: null means "the front
 * is the primary this page loaded". That is a client-side shorthand only
 * (#269): the page still sends and URL-syncs the front it is showing, so a
 * later change of the conversation's primary can't change what is ordered.
 */

export type PlacementPins = {
  /** Front pin — null when the design's primary fills the front (default). */
  front: string | null;
  back: string | null;
};

/**
 * Normalize a front pick: choosing the primary image the page loaded is "no
 * pin" (null) in client state. That decides only the client's mockup cache
 * key shape and whether the pin's thumbnail needs loading; the front on
 * screen is still sent to the server and kept in the URL (#269).
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
 * image is always printed, because `order.designId`, the page URL and (on a
 * Shop sale) `order.storeProductId` all name it. So:
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

/**
 * Link into /preview for one image of a conversation, with that image named
 * as the front. Always carries `front`, even when the image is the
 * conversation's current primary: the primary can move (a generation lands,
 * another tab) between this tap and checkout, and a link that leaves the
 * front implicit would then order a different image than the one tapped.
 */
export function previewOrderHref(designId: string, frontImageId: string): string {
  return `/preview?id=${designId}&front=${frontImageId}`;
}

/**
 * `search` (a query string, with or without the leading "?") with `front`
 * set to the front image on screen. Used for the sign-in return path, which
 * must come back to the same shirt even if the conversation's primary moved
 * meanwhile. A null front (the design hasn't loaded) leaves the query alone.
 */
export function withFront(search: string, frontImageId: string | null): string {
  if (!frontImageId) return search;
  const params = new URLSearchParams(search);
  params.set("front", frontImageId);
  return `?${params.toString()}`;
}
