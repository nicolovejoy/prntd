/**
 * Runtime feature flags, read from env so they can be flipped per-environment
 * in the Vercel dashboard without a code change (same pattern as
 * MULTI_PLACEMENT_ENABLED in products.ts).
 */

/**
 * Guest funnel (#26): when on, the design → preview → order surface is open to
 * signed-out visitors (a Better-Auth anonymous session is minted client-side on
 * entry); the sign-in gate moves to the purchase point. When off, those routes
 * stay behind the proxy auth check, exactly as before. Default off — flip
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

/**
 * Organizer stores (pivot Phase 2): when on, the nav shows a Dashboard link and
 * the /dashboard back office + /shop/[slug] storefront are reachable. When off,
 * those surfaces stay hidden and their actions refuse — merge dark, flip
 * STORES_ENABLED=true once the flow is verified. Default off.
 */
export function storesEnabled(): boolean {
  return process.env.STORES_ENABLED === "true";
}

/**
 * Embedded checkout (#135 slice 2): the raw on/off switch, nothing else. When
 * on, purchases started on the image detail page open Stripe Embedded
 * Checkout on our own /checkout page instead of the hosted Stripe page. This
 * is only "the flag is on" — it says nothing about whether a usable
 * publishable/secret key pair is configured. Callers that actually create or
 * mount an embedded session use the config resolvers in
 * src/lib/embedded-checkout.ts, which also validate the keys and fail closed
 * to hosted checkout when they're missing or mismatched: creating on the
 * image detail page uses `embeddedCheckoutConfig()`, creating on /preview uses
 * `previewEmbeddedCheckoutConfig()`, and mounting (/checkout, its loader, the
 * confirm page's resume link) uses `embeddedCheckoutPageConfig()`. Default off.
 */
export function embeddedCheckoutFlag(): boolean {
  return process.env.EMBEDDED_CHECKOUT_ENABLED === "true";
}

/**
 * Embedded checkout for /preview (#135 slice 3): the raw on/off switch for
 * purchases started on /preview, separate from `embeddedCheckoutFlag()` so
 * each buy surface is switched on independently. Like that one, this says
 * nothing about the key pair; callers that create a session use
 * `previewEmbeddedCheckoutConfig()` (src/lib/embedded-checkout.ts), which
 * fails closed to hosted checkout. Default off.
 */
export function previewEmbeddedCheckoutFlag(): boolean {
  return process.env.PREVIEW_EMBEDDED_CHECKOUT_ENABLED === "true";
}

/**
 * Whether the /checkout page and the confirm page's open-session branch
 * exist: true when either buy surface is switched on. A session created on
 * one surface stays reachable while only the other switch is on.
 */
export function embeddedCheckoutPageFlag(): boolean {
  return embeddedCheckoutFlag() || previewEmbeddedCheckoutFlag();
}
