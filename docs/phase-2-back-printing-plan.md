# Phase 2 — Back-of-shirt printing / multi-placement (issue #25)

Plan produced 2026-06-06. Reuses the same machinery #17 (inside-shirt branding) needs.

## Locked decisions (2026-06-07)

- **Not COGS-blocked on #11.** COGS always comes from Printful's post-submission invoice (`printfulOrder.costs.total`), so adding a back file raises COGS automatically — margin stays accurate. The only thing #25 needs is a **pricing decision** (what to *charge* for a back) plus Printful's additional-placement fee to set it sensibly. The earlier "blocked on #11 per-placement cost" conflated COGS with pricing.
- **Sequencing:** #11 (1C/1D) closed first (2026-06-07); #25 is the next build.
- **Back image source:** reuse an existing source image from the **same design thread** (`getDesignSourceImages`). No fresh-generate, no published-image fork in this slice (the latter inherits buy-existing royalty questions). [decision 2 → (a)]
- **Opt-in, not default:** front stays required; back is an explicit "Add a back design" on `/preview`. Protects the phone-first front-only path from doubled render/mockup cost. [decision 1 → opt-in; decision 5 confirmed]
- **Upcharge rides the product (discountable) Stripe line**, not a separate line — a back is product value, so promos should apply to it. Shipping stays the only non-discountable line. `BACK_PLACEMENT_COST` set from Printful's additional-placement fee (discover in 2.0). [decision 3]
- **Mockup lazy / back-on-demand** [decision 4 confirmed].

## Honest framing

The **schema is already multi-placement-ready**; the **runtime is hardcoded to `front`**. This phase teaches the runtime to carry a second key, not rebuild the data model.

- `order.placements` is already `Record<string,string>` (placement id → `design_image` id). Schema comment at `src/lib/db/schema.ts:121-124` anticipates `back`. **Zero DB migration for the order table.**
- `Product.placements` is a typed array (`products.ts:49-55`) but every product defines one `front`. Deprecated top-level `mockupPosition`/`printArea` mirror `placements[0]`, still read by `preview/actions.ts:73,291`.
- `getDefaultPlacement` (`products.ts:455`) = `placements[0]` — pipeline assumes single placement.
- Webhook (`webhook-handlers.ts:119-123`) resolves `placements.front` via optional `resolveImageUrlById`, falls back to design display image (buy-existing Phase 0 pattern). **Reads `.front` only.**
- Printful order submission (`printful.ts:26-81`) hardcodes single-element `files: [{ type: "default", url }]`. Mockup (`createMockupTask`, `printful.ts:97`) already takes a `placement` arg.
- Pricing (`pricing.ts`) = `baseCost(size) × 1.5`, no per-placement term.
- Funnel: `/design` (chat + sources) → `/preview` (product/color, placement render, mockup) → `/order` (size/color/price) → Stripe. `/preview` already does per-placement on-demand regen via `getOrCreatePlacementRender` — but only for `getDefaultPlacement`.

## Blocked on Phase 1 (#11)
1. **Per-placement COGS** — Printful's additional-placement fee. `computePrice` has no term. Need the real number per product.
2. **How the upcharge surfaces** — separate Stripe line item vs bundled `unit_amount` (#11 owns this; also tied to the discount-eats-margin issue).
3. **Back variant/print-area constraints** — read from Printful, don't assume Bella 3001 back == front geometry.

**Not blocked (build now behind a flag with a placeholder upcharge):** data-model plumbing, back render loop, back mockup, webhook multi-file submission, UX skeleton.

## Open product decisions
1. **Opt-in or default-visible back?** Recommend **opt-in** ("Add a back design" on `/preview`) — protects phone-first front-only common case from doubled render/mockup cost.
2. **Where does the back image come from?** (a) reuse an existing source image from the *same* design thread (recommended default, cheapest, no new thread); (b) generate a fresh back image in a `/preview` sub-flow; (c) pick any published image (powerful but inherits buy-existing cross-owner/royalty questions).
3. **Per-placement price display** — line item vs bundled (owned by #11).
4. **Mockup eager vs lazy for two placements** — recommend lazy/back-on-demand (Printful mockups are free but cost wall-time; phone-first).
5. **Back always optional** (`required: false`); front stays `required: true`. Confirm.
6. **#17 overlap** — inside-shirt branding wants the same second placement. Build generic "secondary placement" machinery here; #17 becomes "add an `inside-label` placement entry + auto-filled branding image," not new infra.

## Phased steps

### 2.0 Data-model + catalog (no UX), behind `MULTI_PLACEMENT_ENABLED` flag
- Discover back geometry: run `scripts/fetch-mockup-templates.ts 71` (Bella 3001), `917`, `360` — prints `placement_options` + per-placement print area / mockupPosition. **Nico runs it** (mutating env-file script). Don't assume front geometry.
- `products.ts`: add `back` to `placements[]` for shirts (`bella-canvas-3001`, `cotton-heritage-mc1087`, `bella-canvas-6400`); phone case stays single. Add helpers: `getPlacement`, `getOptionalPlacements`, `productSupportsPlacement`. Keep `getDefaultPlacement` as `front`. Don't remove deprecated top-level `mockupPosition`/`printArea` yet.
- `MULTI_PLACEMENT_ENABLED` env flag (gated like `PRINTFUL_DRY_RUN`), server-side kill-switch.
- Tests: `products.test.ts` — shirts expose valid `back` placement, phone case doesn't, helpers resolve.

### 2.1 Back render + mockup on `/preview`
- Generalize `getOrCreatePlacementRender(designId, productId, placementId = "front")` (`preview/actions.ts:157`). Thread `placementId` to `getPlacement`, `findPlacementRender` (already placement-keyed, `design-images.ts:122`), `insertDesignImage({ placementId })`. Add `sourceImageId?` param for decision-2a (anchor regen on chosen source, not `primary_image_id`).
- `generateMockup` (`preview/actions.ts:29`): add `placementId`; use `getPlacement(product, placementId).mockupPosition`. **Cache key must include placement**: `${productId}:${placementId}:${colorName}:${scale}` (today lacks placement) — safe migration since back didn't exist.
- `createMockupTask` already accepts `placement` — pass `back`; verify Printful returns a back-template mockup.
- `prefetchProductMockups` stays front-only (don't double prefetch); back renders on-demand.
- Tests: `printful.test.ts` `createMockupTask` (currently asserts `files[0].placement === "front"`) — add `back` case.

### 2.2 Printful multi-file order + webhook
- `createOrder` (`printful.ts:69-76`): replace single `designImageUrl` with `files: { placement, url }[]` (keep `designImageUrl` as back-compat alias → `[{ placement: "front", url }]`). **Reconcile the API shape:** mockup path keys by `placement` (`printful.ts:111`), order path uses `type: "default"` (`printful.ts:70`) — confirm whether order files use `type: "back"` or `placement: "back"` against live `/orders` docs. This is the "READ the integration, don't assume" spot.
- `handleStripeCheckoutCompleted` (`webhook-handlers.ts:119-123`): build placement→url map resolving **every** key in `placements`, falling back to display image for `front` only (back missing → log + submit front-only, don't fail order). Keep single-`front` behavior identical for historical orders.
- Tests: `webhook-handlers.test.ts` — front+back resolves both; back missing → front-only + log; front-only unchanged. `printful.test.ts` — multi-file shape, dry-run still short-circuits.

### 2.3 Pricing (per-placement term) — **gated on #11 number**
- `computePrice`: add optional `placementCount`/`{ back?: boolean }`. `BACK_PLACEMENT_COST` constant (placeholder until #11). Callers: `order/actions.ts:14,46`, `d/actions.ts:223` — thread the back flag from the order's `placements.back`.
- `buildCheckoutSessionParams`: per #11's line-item-vs-bundled decision.
- Tests: `pricing.test.ts` — front-only unchanged, front+back adds exactly the upcharge, ceil holds.

### 2.4 UX (phone-first) — lives on `/preview`
Rationale: `/design` is placement-agnostic by design-doc decision (`print-targets.md:75-88` — pairing on the order, not the design); `/order` is size/color/price. `/preview` owns product + placement + mockup.
- `preview/page.tsx`: front/back segmented control below product selector. State: `frontImageId` + optional `backImageId`. "Add back design" CTA when no back. Mockup loop deps (`preview/page.tsx:127,210`) include active placement.
- Back source UI per decision 2: reuse-existing picker (`getDesignSourceImages`, `design-images.ts:264`) or fresh-generate input.
- `handleApprove` (`preview/page.tsx:244`): require front + (if chosen) back mockups rendered; pass `back=<imageId>` to `/order`.
- `order/page.tsx` + `order/actions.ts`: carry `backImageId` into `createCheckoutSession`; widen `createStripeCheckoutForOrder` `placements` to `Record<string,string>`; show back upcharge in price block.
- Order thumbnails (`resolveOrderImageUrls`, front-only): leave list front-only; front+back composite is an admin-detail nice-to-have.
- Validate front/back toggle + dual mockup on iPhone Safari before done.

### 2.5 Verification + flag flip
- Real test-mode front+back order: 2 files reach Printful (or dry-run logs both), webhook 200, both placements pinned, post-purchase regen doesn't change either printed image.
- `npm test`/`lint`/`build` green. Flip `MULTI_PLACEMENT_ENABLED` once #11 pricing wired.

## Data-model answers
- `order.placements` already `Record<string,string>` — start writing `back`, zero migration. Historical orders resolve via existing fallback.
- Back image is its own `design_image` row + own R2 key (`insertDesignImage`/`uploadDesignImage`), `placementId="back"`, `parent_image_id` → source. Existing placement-render mechanism.
- Reuse the **same design thread** (pairing on the order, not the design). Forking a published image (2c) inherits buy-existing royalty questions — out of this slice.

## Critical files
`products.ts` (back placement + helpers + flag), `printful.ts` (multi-file `createOrder`; verify order-file API shape), `webhook-handlers.ts` (resolve+submit all placements), `preview/actions.ts` (`getOrCreatePlacementRender`/`generateMockup` by `placementId`; cache-key change), `preview/page.tsx` (front/back toggle, dual mockup, phone-first). Plus `pricing.ts` + `checkout.ts` for the #11-blocked price/line-item wiring.
