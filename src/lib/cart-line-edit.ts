/**
 * The cart line's way back to the buy surface (#282, one buy surface slice
 * 5). A line stores its conversation (`designId`) and the images pinned on
 * each side. The image detail page is keyed on an image, so the Edit link has
 * to pick which pin is the page: the one linked to the line's conversation,
 * preferring the front; a swapped line has the page image on the back and
 * the link carries `swap=1`. A legacy line whose front is not linked (the
 * /preview path allowed any guarded image as the front) still opens on its
 * front; saving re-derives the line's design from that image, which is what
 * the add path does too. A line with no front pin cannot be re-opened.
 *
 * No DB access: the caller answers `linked` from one conversation_image query.
 */
import { buyPageHref } from "@/lib/buy-page-picks";

export const CART_LINE_MIN_QUANTITY = 1;
export const CART_LINE_MAX_QUANTITY = 12;

/** An integer from 1 to 12 (Nico, 2026-10-01). */
export function isValidCartQuantity(q: unknown): q is number {
  return (
    typeof q === "number" &&
    Number.isInteger(q) &&
    q >= CART_LINE_MIN_QUANTITY &&
    q <= CART_LINE_MAX_QUANTITY
  );
}

export type CartLineEdit = {
  pageImageId: string;
  back: string | null;
  swap: boolean;
};

export function cartLineEdit(
  line: { placements: Record<string, string> | null },
  linked: (imageId: string) => boolean
): CartLineEdit | null {
  const front = line.placements?.front;
  if (!front) return null;
  const back = line.placements?.back ?? null;
  if (back && !linked(front) && linked(back)) {
    return { pageImageId: back, back: front, swap: true };
  }
  return { pageImageId: front, back, swap: false };
}

export function cartLineEditHref(
  lineId: string,
  line: { productId: string; size: string; color: string },
  edit: CartLineEdit
): string {
  return buyPageHref(edit.pageImageId, {
    order: true,
    product: line.productId,
    size: line.size,
    color: line.color,
    back: edit.back,
    swap: edit.swap,
    line: lineId,
    from: "/cart",
  });
}
