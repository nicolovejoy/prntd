/**
 * Pure helpers for the per-purchase placement pins on the image detail page's
 * buy panel (#138). The page's own image is the front unless the buyer swaps
 * it with a back design; these decide what is printed on each side.
 */

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
