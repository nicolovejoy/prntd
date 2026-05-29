import { stripe } from "@/lib/stripe";

/**
 * Single source of truth for the active homepage promotion.
 *
 * Set to `null` when no campaign is running — the banner disappears.
 * When launching or swapping a campaign, edit this one constant. `code`
 * must match the Stripe *promotion code* exactly (Stripe stores codes
 * case-sensitively, usually uppercased); the liveness check looks it up
 * by that string.
 *
 * Background: on May 4, 2026 the "Launch Special" code hit its redemption
 * cap and silently went dead while the homepage kept advertising it. The
 * banner now renders only after confirming the code is still redeemable
 * (see `getActivePromo`). Issue #13.
 */
export type ActivePromo = {
  /** Exact Stripe promotion code, e.g. "MOTHERSDAY". Case-sensitive. */
  code: string;
  /** Short banner blurb, e.g. "50% off". */
  blurb: string;
};

export const ACTIVE_PROMO: ActivePromo | null = null;

/**
 * Returns true if the promotion code is currently redeemable. Stripe marks
 * a promotion code `active` only when its underlying coupon is also valid
 * (not deleted, expired, or past its redemption cap), so `active` already
 * covers the coupon side; we additionally enforce the code's own expiry
 * and redemption cap — the latter is the May 4 failure mode (a code that
 * hit max_redemptions). Any Stripe error or a missing code is treated as
 * "not live" (fail closed — better to drop the banner than advertise a
 * dead code).
 */
export async function checkPromoLive(promo: ActivePromo): Promise<boolean> {
  try {
    const { data } = await stripe.promotionCodes.list({
      code: promo.code,
      limit: 1,
    });
    const pc = data[0];
    if (!pc || !pc.active) return false;
    if (pc.expires_at != null && pc.expires_at * 1000 <= Date.now()) return false;
    if (pc.max_redemptions != null && pc.times_redeemed >= pc.max_redemptions) {
      return false;
    }

    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`checkPromoLive(${promo.code}) failed:`, msg);
    return false;
  }
}

// Module-level TTL memo. Fluid Compute reuses function instances, so this
// caps Stripe round-trips to ~one per instance per TTL window rather than
// one per pageview. Cross-instance sharing isn't needed at this volume.
const LIVENESS_TTL_MS = 5 * 60 * 1000;
let livenessCache: { code: string; live: boolean; at: number } | null = null;

/**
 * The promo to display on the homepage, or `null` to hide the banner.
 * Returns the active promo only when its liveness check passes; result is
 * cached for `LIVENESS_TTL_MS`.
 */
export async function getActivePromo(): Promise<ActivePromo | null> {
  if (!ACTIVE_PROMO) return null;

  const now = Date.now();
  if (
    livenessCache &&
    livenessCache.code === ACTIVE_PROMO.code &&
    now - livenessCache.at < LIVENESS_TTL_MS
  ) {
    return livenessCache.live ? ACTIVE_PROMO : null;
  }

  const live = await checkPromoLive(ACTIVE_PROMO);
  livenessCache = { code: ACTIVE_PROMO.code, live, at: now };
  return live ? ACTIVE_PROMO : null;
}
