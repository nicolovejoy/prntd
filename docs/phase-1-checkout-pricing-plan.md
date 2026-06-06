# Phase 1 — Checkout & Pricing Foundation (issue #11)

Plan produced 2026-06-06. Umbrella issue #11. Blocks Phase 2 (#25 back-printing) per-placement pricing.

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
- **1D Multi-item shipping**: model/doc only. Capture per-additional-item shipping delta as data; flag the single-item assumptions (`buildCheckoutSessionParams`, `createOrder`, scalar order columns) as the Phase-2 cart surface.

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
