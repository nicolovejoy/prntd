# Phase 1 — Checkout & Pricing Foundation (issue #11)

Plan produced 2026-06-06. Umbrella issue #11. Blocks Phase 2 (#25 back-printing) per-placement pricing.

## Reframe that shapes everything (money correctness)

There are **two different "Printful cost" numbers** and they must not be confused:

1. **`product.baseCost`** (`src/lib/products.ts`) — hardcoded estimate, used **only** to derive the customer price (`computePrice` → `baseCost × 1.5`). Never touches COGS.
2. **`printfulOrder.costs.total`** (`src/lib/webhook-handlers.ts:163`) — the **real** invoice, read back **after** submission, written to `order.printfulCost` + the `cogs` ledger entry.

Consequence: **per-size pricing accuracy is a pricing/revenue question, not a COGS question.** COGS is already accurate. Today's `baseCost: { "*": 12.95 }` overcharges S–XL (true $11.69) and undercharges 2XL+. Ledger profit (`totalPrice − printfulCost`) is already real.

**Hard rule: COGS must keep coming from `printfulOrder.costs`, never from `baseCost`.** Items 3 (tax) and 4 (shipping split) are the ones that genuinely reshape the ledger.

## Open product decisions (resolve before coding)

1. **Does customer price change with per-size accuracy?** (a) keep flat price, correct `baseCost` for honest reporting; (b) float price per size (price cut for common S–XL); (c) flat floor + upcharge only 2XL+ (recommended, common retail pattern).
2. **Tax — merchant of record / do we collect in Stripe?** Printful's fulfillment tax already sits in COGS. Collecting customer tax via Stripe is a registration/nexus question. **Do not enable Stripe `automatic_tax` without confirming registration** — real-world liability. Likely Phase-1 answer: document current state, defer collection.
3. **Multi-item: cart now, or just make pricing/model multi-item-ready?** Recommend NO cart UI in Phase 1. Codebase is hard single-item (`quantity: 1`, single line item, scalar order columns).
4. **Shipping: real-time Printful quote or flat estimate?** Recommend flat constant (~$4–5 first-item domestic), reconcile against actual in ledger. Real-time quoting (`/orders/estimate-costs`) is heavier — Phase 2 candidate.

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
