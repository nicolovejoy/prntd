"use server";

import { isAdminUser } from "@/app/admin/actions";
import { getCartCount } from "@/app/cart/actions";

export type HeaderState = {
  isAdmin: boolean;
  cartCount: number;
};

/**
 * One round trip for the header's two session/DB-dependent checks (Admin nav
 * entry, cart count), replacing what used to be two separate server-action
 * calls (#127). Feature-flag checks (cart/stores enabled) don't need a round
 * trip at all — they're resolved server-side in layout.tsx and passed down as
 * props.
 *
 * cartOn skips the cart query entirely when the cart is disabled or the
 * caller already knows it's not shown.
 */
export async function getHeaderState(cartOn: boolean): Promise<HeaderState> {
  const [isAdmin, cartCount] = await Promise.all([
    isAdminUser(),
    cartOn ? getCartCount() : Promise.resolve(0),
  ]);
  return { isAdmin, cartCount };
}
