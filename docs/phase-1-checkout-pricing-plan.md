# Phase 1 — Checkout & Pricing Foundation (issue #11)

Plan produced 2026-06-06. Umbrella issue #11. Blocks Phase 2 (#25 back-printing) per-placement pricing.

## Status / resume here

- **1A per-size pricing — SHIPPED to main 2026-06-06** (commit on main). `bella-canvas-3001.baseCost` → true per-size cost (S–XL $11.69, 2XL $13.69); new optional `Product.retailPrice` decouples display price from `baseCost × 1.5`; 3001 retail `{ "*": 19.43, "2XL": 21.43 }` (flat floor on S–XL, +$2.00 cost-delta passthrough on 2XL). COGS untouched. 254 tests / 0 lint errors / build green. **Open knob:** 2XL upcharge is straight cost-delta passthrough (+$2.00); switch to marked-up delta (2XL → $22.43) by editing `retailPrice["2XL"]` if Nico wants to hold the margin multiple.
- **Schema migration — SHIPPED to prod 2026-06-06.** Additive nullable `order.itemPrice` / `shippingPrice` / `taxCollected` via `db:push` (no backfill). Verify with `scripts/check-price-split-schema.ts`.
- **1B shipping split — DONE (pending commit) 2026-06-06.** Decision refined: hosted Stripe Checkout can't recompute shipping after the buyer enters their address (static `shipping_options`, no callback), so a destination-exact live quote isn't possible in this flow. Split the two concerns: **(a) the margin fix** — shipping now a separate Stripe `shipping_options` line (`fixed_amount`), so percentage promos discount only the product line — SHIPPED; **(b) the shipping number** — flat `FLAT_SHIPPING_USD = 4.69` (`estimateShipping(itemCount)` in `pricing.ts`, N-item-ready) for now; **live Printful `/orders/estimate-costs` deferred to #26**, where bundled multi-item shipping makes it worthwhile. `computeOrderTotal()` is the shared breakdown the `/order` + buy-panel UIs show and the checkout choke point charges. Webhook reconciles `itemPrice`/`shippingPrice` from Stripe's `amount_subtotal`/`total_details.amount_shipping`. 269 tests / 0 lint / build green.
- **1C tax — DONE 2026-06-07.** No customer tax collected; Stripe `automatic_tax` stays off; Printful's fulfillment tax stays in COGS; `order.taxCollected` reserved (null). Extracted pure `summarizeLedger` (`ledger.ts`) — `grossProfit` excludes any non sale/refund/stripe_fee/cogs type, so a future `tax` pass-through can't inflate profit; locked by test. Policy: `docs/tax-policy.md`.
- **1D multi-item — DONE 2026-06-07 (model-only).** Pricing is already N-item-shaped (`computeOrderTotal(itemPrice, itemCount)`, `estimateShipping(itemCount)` flat per order); added a test locking "shipping charged once per order, not per item" as the #26 contract, and flagged the single-item submission spots (`checkout.ts` single line item, `printful.ts` single `items[]`) in comments as the #26 cart surface. No UI. Full cart = **#26**.
- **#11 closed 2026-06-07** — 1A/1B/1C/1D all shipped.
- **Unrelated pending (not code):** ANTHROPIC_API_KEY + REPLICATE_API_TOKEN are Production-only in Vercel; add them to the **Preview** scope to fix the `/design` Preview 500 (IDEOGRAM already in Preview). Dashboard → env vars → edit each → check Preview.

## Reframe that shapes everything (money correctness)

There are **two different "Printful cost" numbers** and they must not be confused:

1. **`product.baseCost`** (`src/lib/products.ts`) — hardcoded estimate, used **only** to derive the customer price (`computePrice` → `baseCost × 1.5`). Never touches COGS.
2. **`printfulOrder.costs.total`** (`src/lib/webhook-handlers.ts:163`) — the **real** invoice, read back **after** submission, written to `order.printfulCost` + the `cogs` ledger entry.

Consequence: **per-size pricing accuracy is a pricing/revenue question, not a COGS question.** COGS is already accurate. Today's `baseCost: { "*": 12.95 }` overcharges S–XL (true $11.69) and undercharges 2XL+. Ledger profit (`totalPrice − printfulCost`) is already real.

**Hard rule: COGS must keep coming from `printfulOrder.costs`, never from `baseCost`.** Items 3 (tax) and 4 (shipping split) are the ones that genuinely reshape the ledger.

## Decisions (locked 2026-06-06 by Nico)

1. **Price model: flat floor + 2XL+ upcharge.** Keep ~$19.43 for S–XL; add the real cost delta only for 2XL and up. → display price decouples from a pure `baseCost × 1.5`, so add a separate display/floor concept (don't overload `baseCost`).
2. **Tax: not registered — defer.** Document that Printful's fulfillment tax sits in COGS, add the nullable `taxCollected` column for future use, collect **no** customer tax. Do NOT enable Stripe `automatic_tax`. 1C is doc + schema only.
3. **Multi-item: model-only (no cart UI).** Make pricing/data forward-compatible; flag the single-item assumptions as the Phase-2 cart surface.
4. **Shipping: real-time Printful quote** (Nico chose the heavier path over a flat constant). 1B must call Printful **`/orders/estimate-costs` pre-checkout** to get the exact shipping amount, then set it as the Stripe `shipping_option`. This is more work than a flat rate: a synchronous Printful estimate call on the order path before the Stripe redirect, with a sane fallback if the estimate call fails/times out (don't block checkout — fall back to a flat constant and reconcile). Still use `shipping_options` (not a line item) so percentage promos skip shipping.

### Original open-decision notes (superseded by the above, kept for context)

- Per-size: options were (a) flat honest-reporting, (b) float per size, (c) flat floor + 2XL+ upcharge → **(c) chosen.**
- Tax: register-and-collect vs defer → **defer chosen.**
- Shipping: flat constant vs real-time quote → **real-time quote chosen.**

## Data-model implications

- **`baseCost` shape:** no structural change — `Record<string,number>` with `"*"` default already supports per-size (see `cotton-heritage-mc1087`, `bella-canvas-6400`). If price decouples from cost (decision 1a/1c), add a separate `displayPrice?`/floor field rather than overloading `baseCost`.
- **`order` row — new nullable columns** for items 3 & 4: `shippingPrice`, `taxCollected`, optionally `itemPrice` (so `totalPrice = itemPrice + shippingPrice + taxCollected` is auditable). Keep `totalPrice` as grand total for back-compat (admin margin math reads it). All nullable, **no backfill** (consistent with ledger-starts-April-1 convention). Push via `db:push`, verify on prod Turso with a `scripts/check-*-schema.ts`-style script.
- **Ledger:** if tax is ever collected, add a `tax` pass-through type **excluded from profit** everywhere (`getFinancialSummary`, both admin margin computations). For Phase 1 (tax deferred) no new type — but design `recordSale` so `sale` = item + shipping only, never collected tax.

## Phased steps (ordered to not break existing orders)

- **1A Per-size pricing** (smallest, first): edit `bella-canvas-3001.baseCost` to true per-size values; `computePrice` unchanged if price stays `baseCost × 1.5`. **COGS untouched.** `pricing.test.ts` assertions (`baseCost==12.95`, `total==19.43`) will break — that's the signal. UI already renders `pricing.total` live, so price now changes per size — eyeball on mobile.
- **Schema migration**: additive nullable columns via `db:push`, verified on prod before any reader.
- **1B Separate Stripe shipping line** (highest value — promos currently eat margin to zero): **use Stripe `shipping_options`/`shipping_rate_data`, NOT a second line item** — Stripe natively excludes shipping from percentage coupons. Changes `buildCheckoutSessionParams` return shape. Persist Stripe's `total_details.amount_shipping`/`amount_subtotal`/`amount_discount` to the new columns (add to `StripeSessionData`, make optional so pre-1B sessions parse). `/order` price block (hardcoded "Shipping … Free") + sticky mobile bar must show the real line.
- **1C Tax**: likely "measure & document" — add nullable `taxCollected`, document Printful tax sits in COGS, no Stripe change. Full collection (Stripe `automatic_tax`, `tax` ledger type) only if registration confirmed — may push to Phase 2.
- **1D Multi-item shipping**: model/doc only *in Phase 1*, but the full cart is now a committed near-term feature → **issue #26** (Nico, 2026-06-06). In Phase 1: make the pricing/shipping logic forward-compatible (shipping is per-*order* from the real-time estimate, not per-item; `computePrice` ready to sum item subtotals) and flag the single-item assumptions (`buildCheckoutSessionParams` `quantity:1`/single line, `createOrder` single `items`, scalar `order` columns) as the #26 surface. The real-time quote decision (4) is what makes #26's bundled-shipping savings visible — build 1B's estimate call to accept N items even while only sending 1.

## Riskiest parts
1. Confusing `baseCost` (pricing) with `costs.total` (COGS) — never feed `baseCost` into the ledger.
2. Promo scope on shipping — a plain second line item gets discounted too; must use `shipping_options`.
3. Tax as revenue vs liability — misclassifying inflates profit + creates remittance error.
4. Tax legal exposure — hard gate on registration confirmation.
5. Phone-first regression — `/order` block + sticky bar + BuyPanel must agree with the Stripe page.

## Critical files
`src/lib/checkout.ts` (shipping line / promo protection), `src/lib/pricing.ts` (per-size, possible display/cost decouple), `src/lib/products.ts` (3001 baseCost data + `getBaseCost`), `src/lib/webhook-handlers.ts` (persist split, keep COGS from Printful, ledger reconcile), `src/lib/db/schema.ts` (additive nullable columns). Supporting: `order/actions.ts`, `order/page.tsx`, `d/actions.ts`, `d/[imageId]/buy-panel.tsx`, `api/webhooks/stripe/route.ts`, `ledger.ts`.

## Test priority (by money-risk)
`checkout.test.ts` (shipping line / coupon-applies-to-item-only — highest), `pricing.test.ts` (per-size; existing assertions break), webhook-handler tests (split persistence + ledger reconciliation), `ledger.test.ts` (tax pass-through excluded from profit, if added).
