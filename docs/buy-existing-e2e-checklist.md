# Buy-existing (#6) — end-to-end test-mode checklist

The buy-existing flow (Phases 0–3) is built and unit-tested, but no purchase
has been run through it whole. This is the deliberate pass to do that. Run it
**in Stripe test mode with a test card** (`4242 4242 4242 4242`, any future
expiry / any CVC) — never a real card. Nico is the only customer; every real
order is real money + a real Printful fulfillment.

## Setup

- Confirm the app is pointed at **test-mode** Stripe keys (`STRIPE_SECRET_KEY`
  + `STRIPE_WEBHOOK_SECRET` for the test endpoint). On a preview deploy or
  local with test keys — not prod.
- Have the Stripe test dashboard open to watch the Checkout Session +
  `checkout.session.completed` webhook fire.
- If testing locally, run the Stripe CLI listener so the webhook reaches the
  dev server: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`.
- Pick a published, non-hidden image and note its `imageId` and which account
  owns it (the designer). Buy from a **different** account than the designer so
  the cross-owner behavior is actually exercised.

## Buy-specific checks (the parts unique to this flow)

1. **Auth gate.** Signed out, `/d/[imageId]` shows "Sign in to buy" → sign-in
   honors `?next=/d/[imageId]` and returns to the image.
2. **Buy panel.** Product/size/color selectors work; total updates with
   size/product; "Buy this design — $X" is the primary CTA, "Make one like
   this" is secondary.
3. **Order record.** After paying, the new `order` row has: `userId` = buyer
   (not the designer), `designId` = the image's source design, `placements`
   = `{ front: <imageId> }`, `totalPrice` = `computePrice(0, …)` (no
   generation cost billed).
4. **Printed image.** The Printful submission prints `placements.front` — the
   exact published image bought — not the design's current display image.
   Verify the mockup/submitted artwork matches the published image even if the
   source design has since been regenerated. (This is the Phase 0 guarantee.)
5. **Attribution.** "Designed by <designer>" shows on the buyer's `/orders`
   card and on the admin order detail. It must NOT show on a self-designed
   order.
6. **Validation guard.** A crafted call with a bad size/color/product is
   rejected before checkout (resolveOrderVariant). Not user-facing, but if you
   tamper with the request it should error rather than create an order.

## Known edge to watch (candidate followup)

- **Seller's design flips to `ordered`.** The webhook sets
  `design.status = "ordered"` on `order.designId`. For a buy order that's the
  *seller's* design, so buying someone's published design mutates their
  design's status. Mostly cosmetic today (status drives `/designs` + the design
  loop), but it's another user's state changing on your purchase. Decide
  whether to scope the status flip to self-designed orders or leave it. Note
  the actual behavior observed during the run.

## General per-order checklist (from the test-orders runbook)

1. Order row appears in `/orders` (customer) and `/admin` (admin) with correct
   status.
2. Status advances: `pending → paid → submitted` (or `paid_printful_failed` if
   Printful errors).
3. Ledger entries in `/admin/orders/[id]`: `sale`, `stripe_fee`, `cogs`.
4. Revenue reflects actual paid amount (post-discount if a promo was applied).
5. Discount captured: `discountCode` + `discountAmount` if a code was used.
6. Customer confirmation email received.
7. Owner alert email received (with discount line if applicable).
8. Printful order ID populated + visible in the Printful dashboard.
9. Shipping address matches what was entered in Stripe checkout.
10. Design status flips to `ordered` (see the cross-owner caveat above).
11. If discounted: ledger `sale` entry = actual paid amount, not list price.
12. After Printful ships: `package_shipped` webhook updates status, tracking
    number populated, shipping notification email sent.

## Cleanup

- Classify the test order with the `test` classification so it's excluded from
  real financials.
- Cancel the Printful order if it auto-submitted (test mode shouldn't bill, but
  don't leave a fulfillment hanging).
