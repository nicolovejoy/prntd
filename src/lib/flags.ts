/**
 * Runtime feature flags, read from env so they can be flipped per-environment
 * in the Vercel dashboard without a code change (same pattern as
 * MULTI_PLACEMENT_ENABLED in products.ts).
 */

/**
 * Guest funnel (#26): when on, the design → preview → order surface is open to
 * signed-out visitors (a Better-Auth anonymous session is minted client-side on
 * entry); the sign-in gate moves to the purchase point. When off, those routes
 * stay behind the middleware auth check, exactly as before. Default off — flip
 * GUEST_FUNNEL_ENABLED=true once the abuse cap (A3) is in place.
 */
export function guestFunnelEnabled(): boolean {
  return process.env.GUEST_FUNNEL_ENABLED === "true";
}

/**
 * Multi-item cart (#26 Stage B): when on, the nav shows a Cart link and
 * /preview offers "Add to cart". When off, the cart entry points are hidden and
 * the single-item Buy-now flow is the only path (the /cart route and actions
 * still exist but are unreachable from the UI). Default off — flip CART_ENABLED
 * once the flow is verified.
 */
export function cartEnabled(): boolean {
  return process.env.CART_ENABLED === "true";
}
