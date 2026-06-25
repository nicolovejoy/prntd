# Phase 3 — `/shop/[slug]` storefront (organizer pivot, section B)

The public destination for a store's Copy-link (currently 404s). A shopper browses
an organizer's live store and buys a composed product. Behind `STORES_ENABLED`.

Status: PLAN (2026-06-24). Builds on slice-2 (compose) + the existing buy flow.

## What already exists (reuse, don't rebuild)

- **Buy choke point** — `createStripeCheckoutForOrder` (`src/app/order/actions.ts`)
  takes `userId, designId, productId (blank), size, color, itemPrice, placements,
  checkoutImageUrl, cancelUrl`; inserts the order, builds the Stripe session
  (product line + separate shipping line), persists `stripeSessionId`. The
  published-design buy (`buyPublishedDesign`, `src/app/d/actions.ts`) is the exact
  template — same anon→sign-in gate, `placements.front` pinning.
- **Pricing** — `computeOrderTotal(itemPrice)` splits item/shipping/total (the
  customer view); `computeProceeds(price, cogs)` is the organizer split (internal).
- **Store data layer** — `getStoreBySlug`, `getStoreProducts` (position order),
  `storeIsPublic`/`canViewStore`, `storeShareUrl(slug, origin)` → `/shop/{slug}`.
- **UI** — `SizePicker`/`ColorPicker` (`src/components/product-options.tsx`),
  `BuyPanel` shape.
- **Webhook** — `handleStripeCheckoutCompleted` prints `placements`, records
  `sale`/`stripe_fee`/`cogs` ledger. No fulfillment change needed.

## The one gap — order→store attribution (schema)

`order` has **no `storeId`**, and `order.productId` holds a **blank id**
(`bella-canvas-3001`), not the organizer `product.id`. Without attribution a
storefront sale can't be tied back to the store/organizer for a future payout.

**Migration (additive, nullable, no backfill):**

- `order.store_id` — text, nullable, FK → `store.id`.
- `order.store_product_id` — text, nullable, FK → `product.id`. Named distinctly
  from the legacy blank-bearing `order.product_id`.

Flow: edit `schema.ts` → `db:generate` → review SQL in the diff → apply to
`prntd-preview` (so e2e/dev see it; CI already migrates preview) → **prod at the
section-C merge gate, not before.**

## Routes

- **`/shop/[slug]`** (RSC) — resolve store by slug. Public sees it only when
  `live`; the owner previews any state (`canViewStore`). 404 otherwise. Renders a
  phone-first grid of `listed` products (owner also sees `draft`/`hidden`), each a
  card: design artwork on the blank color + blank name + price. Accent color
  drives the page chrome. Empty store → a friendly empty state.
- **`/shop/[slug]/[productId]`** (RSC shell + client buy panel) — the product:
  larger preview, blank name, `StoreBuyPanel` (size + color from the blank palette,
  price + shipping + total, Buy CTA). Signed-out → "Sign in to buy"
  `?next=/shop/{slug}/{productId}` (browsing stays open; gate at buy, per the
  guest-funnel model).

## Buy action

`buyStoreProduct({ storeProductId, size, color })` (new, `src/app/shop/actions.ts`):

1. Resolve the product; guard it is `listed` **and** its store is `live` (a
   `canBuyStoreProduct` pure helper, mirroring `canBuyPublishedImage`).
2. Anonymous/no session → `{ url: null, needsAuth: true }` (sign-in gate).
3. Derive `designId = product.designId`, blank = `product.blankId`,
   `placements = product.placements`, `itemPrice = product.price ?? computed
   default`. Customer pays `itemPrice + shipping`.
4. Call `createStripeCheckoutForOrder(...)` — **extended** to accept + persist
   optional `storeId` + `storeProductId` on the order insert. cancelUrl =
   `/shop/{slug}/{productId}`.

## Proceeds / payout — OUT of scope for B

B **attributes** sales (storeId/storeProductId) so a later payout phase can sum
them; it does **not** move money (no Stripe Connect, no disbursement). One cheap
add: stash `orgProceeds` (from `computeProceeds`) in the `sale` ledger entry's
metadata at webhook time, so reconciliation later doesn't have to re-derive it.
No new ledger type.

## Tests

- **Money-path integration** (`money-path.integration.test.ts`, real in-memory
  libSQL): a store-product order → webhook → `paid`/`submitted` + `sale`/`fee`/
  `cogs`; assert the order row carries `storeId`/`storeProductId` and the proceeds
  metadata.
- **e2e** (`store-compose.spec.ts` already has a signed-in organizer with a live
  store + listed product): publish the store, open `/shop/{slug}` as the same
  browser, open the product, reach the Buy CTA / sign-in gate. A full purchase
  needs Stripe test mode — assert up to the checkout redirect like `cart.spec.ts`.

## Build order

1. Schema: add the two nullable columns → `db:generate` → apply to preview.
2. `canBuyStoreProduct` helper + unit tests.
3. Extend `createStripeCheckoutForOrder` to persist `storeId`/`storeProductId`.
4. `buyStoreProduct` action + `getStorefront(slug)` / `getStoreProductForBuy(...)`.
5. `/shop/[slug]` grid + `/shop/[slug]/[productId]` + `StoreBuyPanel`.
6. Money-path integration test; e2e storefront-browse assertion.
7. (Section C) merge gate: prod backup → migration-smoke → prod migrate → merge →
   flip `STORES_ENABLED`.

## Open question

- **Product display name.** `product` has no title column — cards show artwork +
  blank name + price. Good enough for B; a `product.title` is an additive
  follow-up if organizers want named listings.
