/**
 * Runtime feature flags, read from env so they can be flipped per-environment
 * in the Vercel dashboard without a code change (same pattern as
 * MULTI_PLACEMENT_ENABLED in products.ts).
 */

/**
 * Guest funnel (#26): when on, the studio and the image detail page (buy) are open to
 * signed-out visitors (a Better-Auth anonymous session is minted client-side on
 * entry); the sign-in gate moves to the purchase point. When off, those routes
 * stay behind the proxy auth check, exactly as before. Default off. The daily
 * generation, checkout and upload caps (generation-quota.ts) apply whether or not it is on.
 */
export function guestFunnelEnabled(): boolean {
  return process.env.GUEST_FUNNEL_ENABLED === "true";
}

/**
 * Multi-item cart (#26 Stage B): when on, the nav shows a Cart link and
 * the image detail page offers "Add to cart". When off, the cart entry points are hidden and
 * the single-item Buy-now flow is the only path (the /cart route and actions
 * still exist but are unreachable from the UI). Default off — flip CART_ENABLED
 * once the flow is verified.
 */
export function cartEnabled(): boolean {
  return process.env.CART_ENABLED === "true";
}

/**
 * Embedded checkout (#135 slice 2): the raw on/off switch, nothing else. When
 * on, purchases started on the image detail page or from the cart (#278 slice
 * 6b) open Stripe Embedded Checkout on our own /checkout page instead of the
 * hosted Stripe page, and /checkout itself exists (it 404s when this is off).
 * This is only "the flag is on" — it says nothing about whether a usable
 * publishable/secret key pair is configured. Callers that create or mount an
 * embedded session (the buy action, the cart, /checkout's loader, the confirm
 * page's resume link) use `embeddedCheckoutConfig()` in
 * src/lib/embedded-checkout.ts, which also validates the keys and fails closed
 * to hosted checkout when they're missing or mismatched. Default off.
 */
export function embeddedCheckoutFlag(): boolean {
  return process.env.EMBEDDED_CHECKOUT_ENABLED === "true";
}
