/**
 * Attribution label for an order: the name of the person who designed what
 * was bought, but only when that's someone other than the buyer. Self-
 * designed orders (the design-your-own flow, where buyer === designer)
 * return null so the UI shows nothing — "designed by you" is just noise.
 * Buy-existing orders, where the buyer purchased someone else's published
 * design, return the designer's name.
 *
 * Pure so the rule is unit-tested independently of the order queries.
 */
export function designerAttribution(params: {
  designerId: string | null;
  designerName: string | null;
  buyerId: string;
}): string | null {
  const { designerId, designerName, buyerId } = params;
  if (!designerId || designerId === buyerId) return null;
  return designerName || null;
}
