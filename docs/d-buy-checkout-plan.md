# /d buy flow — mockup preview + embedded checkout (#135)

Plan only, no implementation. Two related pieces from issue #135:

1. The pared-down `/d/[imageId]` buy page (PRs #129/#130/#131) lost the
   Printful shirt-mockup preview — nothing in that flow shows the design on
   an actual shirt before paying.
2. Checkout moves onto our URL via Stripe Embedded Checkout, with the mockup
   shown on the checkout page after all selections are made (Nico's ask:
   "improve the stripe checkout experience, move it into our url, and show
   the preview there").

## Current state

### /d hero — artwork only, no mockup

`PublishedImageView` (`src/app/d/[imageId]/published-image-view.tsx:20`)
renders the raw artwork PNG on its pinned backdrop color
(`publishedBackdrop`) — a flat color panel, not a shirt. `BuyPanel`
(`src/app/d/[imageId]/buy-panel.tsx:31`) collapses to a bare "Order" button
(#128); expanding shows product/size/color/back pickers and a price
breakdown, but the hero never changes. The buyer picks a color they never
see on a garment.

The mockup machinery all exists and serves `/preview`:

- `generateMockup(designId, colorName, productId, scale, placementId,
  sourceImageId?)` (`src/app/preview/actions.ts:89`) — checks the
  `design.mockupUrls` cache, renders via Printful, uploads to R2, persists
  the cache entry. **Owner-gated**: it throws Unauthorized unless the caller
  owns the design (`src/app/preview/actions.ts:100-107`), so a cross-owner
  `/d` buyer (the normal Shop case) cannot call it today.
- Cache keys come from `src/lib/mockup-cache.ts:31` (`mockupCacheKey`,
  `v2:` prefix, carries product/placement/sourceImageId/color/scale — #102)
  and `mockupObjectKey` (`:51`) for R2.
- `resolveHeroDisplay` (`src/lib/instant-preview.ts:73`) is the loading
  pattern: artwork on a flat shirt-color panel instantly, exact Printful
  mockup crossfaded in when it arrives (PR #91's `mix-blend-multiply` over a
  light `mockupBackdrop`, `src/lib/instant-preview.ts:39`). Built exactly
  because the Printful render takes seconds.

### Checkout — hosted Stripe, off-site

All four purchase flows funnel through Checkout Sessions with the default
hosted UI:

- `buildCheckoutSessionParams` (`src/lib/checkout.ts:14`) and
  `buildCartCheckoutSessionParams` (`:82`) — pure builders. Both set
  `success_url: {appUrl}/order/confirm?session_id={CHECKOUT_SESSION_ID}`
  (`:70`, `:128`) and a per-flow `cancel_url`.
- `createStripeCheckoutForOrder` (`src/app/order/actions.ts:111`) — shared
  single-item choke point: order + `order_item` batch insert, `stripe
  .checkout.sessions.create` (`:173`), persists `stripeSessionId`, returns
  `{ url }` (`:193`); the client does `window.location.href = url`
  (`buy-panel.tsx:145`).
- Cancel URLs today: `/preview?id=…&size=…&color=…` for design-your-own
  (`src/app/order/actions.ts:99`), `/d/{imageId}` for buy-existing
  (`src/app/d/actions.ts:338`), `/cart` for cart checkout
  (`src/app/cart/actions.ts:261`), `/shop/{slug}/{productId}` for
  storefront (`src/app/shop/actions.ts:208`).
- Webhook: `src/app/api/webhooks/stripe/route.ts` verifies the signature,
  `toStripeSessionData` (`src/lib/stripe-session.ts:15`) normalizes the
  retrieved session (metadata orderId/designId, amounts, shipping,
  discount), then the paid-claim → Printful submission → ledger pipeline.
  Nothing in it knows or cares which UI rendered the payment form.
- `/order/confirm` (`src/app/order/confirm/page.tsx:21`) is a client page
  keyed on `?session_id=`, polling `getOrderBySession`.
- No Stripe publishable key exists anywhere in the repo (`NEXT_PUBLIC_
  STRIPE_PUBLISHABLE_KEY` absent from env docs, `.env.tpl`, and code) and no
  `@stripe/stripe-js` client dep — the hosted flow never needed either.

### Stripe Embedded Checkout — verified against current docs (2026-08-03)

From https://docs.stripe.com/checkout/embedded/quickstart and
https://docs.stripe.com/api/checkout/sessions/create:

- `ui_mode` accepts `hosted_page` (default), `embedded_page`, `custom`,
  `elements`. The embedded value is now **`embedded_page`** (docs previously
  said `embedded`; verify what stripe-node 20.4.1's typings accept at build
  time and pin to whatever the SDK exports).
- Same Checkout Session object, same payment form, rendered in a Stripe
  iframe mounted in our page. Server still creates the session with the
  secret key; the response's `client_secret` goes to the browser, which
  mounts via `@stripe/stripe-js` (`createEmbeddedCheckoutPage` /
  `checkout.mount`) or the React wrapper (`EmbeddedCheckoutProvider` +
  `EmbeddedCheckout` from `@stripe/react-stripe-js`).
- `return_url` is **required** and must carry `{CHECKOUT_SESSION_ID}`;
  `cancel_url` is **not allowed** ("This parameter is not allowed if
  ui_mode is `embedded_page`"). There is no cancel redirect at all — the
  buyer leaves by navigating our page.
- `allow_promotion_codes`, `shipping_options`, and
  `shipping_address_collection` are all supported in `embedded_page` mode —
  our promo-skips-shipping margin structure carries over unchanged.
- After a payment attempt Stripe redirects the iframe's parent to
  `return_url`; retrieve the session there — `status: "complete"` means
  paid, `status: "open"` means failed/abandoned (remount or send the buyer
  back).
- The webhook flow (`checkout.session.completed`) is identical to hosted.

Payment Element (`ui_mode: "custom"`/`elements`) was considered and
rejected: it means building the address form, promo-code entry, and payment
state machine ourselves for no benefit — Embedded Checkout keeps Stripe's
whole form, our session/webhook plumbing, and just changes where it renders.

## Target

- `/d` shows the design on the actual shirt: once the buyer expands Order
  and a color is in play, the hero swaps from artwork-on-backdrop to the
  `/preview`-style layered hero — artwork on the shirt color instantly,
  Printful mockup crossfaded in. Product/color changes re-drive it.
- Checkout renders on prntd.org: a `/checkout` page with the mockup + line
  summary as a review pane and the Stripe Embedded Checkout form below it.
  `/order/confirm` stays the post-payment landing (it is the `return_url`).
- Behind a new flag, staged per surface: `/d` first, `/preview`
  (design-your-own) second, cart last. Hosted checkout remains the fallback
  and the cart's flow until the last slice.

## Part 1 — mockup on /d

### Authorization: a listing-scoped mockup action

`generateMockup`'s owner gate is correct for `/preview` but wrong for `/d`.
New action in `src/app/d/actions.ts`:

```
getListingMockup({ imageId, productId, colorName })
  → { mockupUrl }
```

- Authorizes the way the page itself does: image visible per
  `canViewImagePage` semantics (published && !hidden, or owner). No
  ownership requirement — anyone who can see the buy page can see the
  mockup.
- Delegates to the same pipeline `generateMockup` uses, with
  `placementId: "front"` and **explicit `sourceImageId: imageId`** — the
  order pins `placements.front = imageId`
  (`src/app/d/actions.ts:333-336`), which may not be the design's primary
  image, so the mockup must render the listed image, not the design's
  display image. `mockupCacheKey` already distinguishes `sourceImageId`
  (`src/lib/mockup-cache.ts:32`), so cache entries can't collide with
  `/preview`'s front renders.
- Scale is fixed at 1.0 (no scale control on `/d`); cache stays on the
  seller design's `design.mockupUrls` under the existing v2 keys, so
  repeat buyers and the seller's own `/preview` visits share renders where
  keys match. Refactor note: extract the render-and-cache body shared by
  `generateMockup` and `getListingMockup` into a lib helper rather than
  duplicating it; the two actions keep only their own auth.
- Rate/abuse surface: the action triggers paid Printful renders on a public
  page. The cache bounds it (one render per product×color per image); no
  extra quota needed initially.

### UI: hero swap on Order-expand

- Collapsed state (just "Order" + remix CTA): unchanged —
  artwork-on-backdrop, no mockup fetch, page stays cheap for browsers.
- On expand, `BuyPanel` owns a product+color selection from its first
  render, so the page swaps `PublishedImageView`'s panel for the layered
  hero: instant layer = artwork centered on the selected shirt color
  (exactly `/preview`'s instant layer), `getListingMockup` fired for the
  current product×color, mockup crossfaded via `resolveHeroDisplay` +
  `mix-blend-multiply`/`mockupBackdrop` (PR #91). Color/product changes
  re-resolve; the previous instant layer holds during the fetch
  (`lastArtworkUrl` behavior).
- Buy is never gated on the mockup — same decision as
  `docs/preview-order-collapse-plan.md` §8 Q1: size remains the only gate,
  "Rendering exact preview…" indicates a pending exact render.
- State plumbing: `BuyPanel` currently doesn't share color/product with the
  hero (they are sibling components under `page.tsx`). Lift the selection
  into a small client wrapper that renders both, or move the hero into
  `BuyPanel`. Prefer the wrapper — `PublishedImageView` also serves the
  owner's backdrop-picker mode and shouldn't grow buy logic.
- Back designs: out of scope for the hero (front mockup only, same as
  `/preview`'s default view). The picked back thumbnail row is unchanged.
- Mobile: hero already caps at 40vh (`published-image-view.tsx:77`); the
  swap keeps that cap so the picker stack stays reachable. Phone-first: the
  crossfade must not reflow the page (fixed aspect container, as on
  `/preview`).

## Part 2 — embedded checkout

### Route: a dedicated /checkout page

New route `src/app/checkout/page.tsx` (+ sibling `actions.ts`), reached by
client navigation after the session is created:

1. Buyer taps the buy CTA on `/d` (later `/preview`). The existing server
   action runs unchanged through order insert + session create, but with
   `ui_mode: "embedded_page"`, `return_url` instead of
   `success_url`/`cancel_url`, and returns
   `{ clientSecret, sessionId }` instead of `{ url }` when the flag is on
   (hosted `{ url }` when off — one action, two shapes).
2. Client navigates to
   `/checkout?session={sessionId}&from={originPath}` carrying the client
   secret in memory (sessionStorage keyed by session id as the
   refresh-survival fallback; the page can also re-fetch the secret by
   session id via a server action that re-reads the order's
   `stripeSessionId` and retrieves the session — Stripe returns the
   client_secret on retrieve for open sessions).
3. `/checkout` renders, top to bottom (single scroll column on phones):
   - **Review pane**: the cached mockup for the ordered product×color
     (`getListingMockup` result is already warm from the `/d` hero; the
     design-your-own flow reuses `/preview`'s cache the same way), falling
     back to the instant artwork-on-color layer when no mockup has
     resolved yet — never a blank box. Below it, the line summary: product,
     color/size, back-design line if any, shipping, total. Data via
     `resolveOrderLines` on the just-created order.
   - **Payment form**: `<EmbeddedCheckout>` mounted with the client secret.
     Stripe's iframe is responsive; no extra work for phones beyond not
     constraining its width.
   - **"← Back"** link to `?from` (see cancel behavior).
4. Alternative considered — mounting the form inline on `/d` under the
   picker stack: rejected. The order row must exist before the session
   (mount = order created), so an inline mount either creates orders on
   expand (orphan-row spam) or restructures the panel around a two-step
   anyway; a route also gives the design-your-own and cart flows the same
   destination later, and matches "show the preview there, after all
   selections are made".

### Cancel/back behavior

Embedded mode has no `cancel_url` — backing out is just leaving our page,
so the per-flow cancel URLs (`order/actions.ts:99`, `d/actions.ts:338`,
`cart/actions.ts:261`) become the `?from` param `/checkout` navigates back
to. Browser Back works identically (the `/d` or `/preview` page is the
previous history entry, state re-derived from URL params/remembered
defaults as today). The abandoned session stays `open` until Stripe expires
it (24h); the `pending` order row it references is the same orphan class
hosted checkout already produces on abandonment (known-open audit item —
no change).

### return_url and /order/confirm

`return_url: {appUrl}/order/confirm?session_id={CHECKOUT_SESSION_ID}` — the
literal current `success_url`. `/order/confirm` keeps working as-is for the
success case. One addition: with embedded, a **failed/abandoned** attempt
can also land on `return_url` with `session.status === "open"`.
`getOrderBySession` will find the order still `pending`; the confirm page
should render a "payment didn't complete" state with a link back to
`/checkout?session=…` instead of the current indefinite pending copy.
Small, and it's a correctness fix for hosted too (a buyer can hit the
confirm URL early today).

### What does not change

- `buildCheckoutSessionParams` / `buildCartCheckoutSessionParams` grow a
  `uiMode` branch (hosted keeps `success_url`+`cancel_url`, embedded sets
  `ui_mode`+`return_url`); line items, `shipping_options`,
  `allow_promotion_codes`, metadata are byte-identical.
- Webhook route, `toStripeSessionData`, paid-claim/fulfillment/ledger:
  untouched. `checkout.session.completed` fires the same either way.
- Order/`order_item` insert shape, `stripeSessionId` persistence.

### New dependencies and env

- `@stripe/stripe-js` + `@stripe/react-stripe-js` (client-side, small).
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — does not exist anywhere today.
  Needs: Vercel Production + Preview scope (Preview because the e2e/CI
  preview exercises checkout), `.env.tpl` entry (1P item alongside
  `prntd-stripe-secret-test` for the test-mode pk), CLAUDE.md env list.
  Live/test mismatch between pk and sk fails loudly at mount — the local
  template already pins the test sk, so pin the test pk with it.
- New flag `EMBEDDED_CHECKOUT_ENABLED` in `src/lib/flags.ts` (same
  `=== "true"` pattern), default off. Per the standing rule, add to Vercel
  Preview scope before any e2e spec depends on it.

### Rollout

Flag-gated per surface, in this order:

1. `/d` buy-existing — smallest blast radius, the surface #135 is about.
2. `/preview` design-your-own (`createCheckoutSession`) — the main funnel;
   flip after `/d` has taken real orders.
3. Cart — **hosted stays for cart initially**. Cart checkout shares the
   session machinery (`buildCartCheckoutSessionParams`) so the switch is
   mechanical, but its cancel semantics (#38: cart must survive backing
   out) and the N-line review pane deserve their own slice after the
   single-item flows have soaked. Nothing about embedded threatens #38 —
   the webhook still clears purchased lines — but don't churn two flows at
   once.

Kill switch = flip the flag off; hosted path stays fully wired underneath.

### Stripe e2e migration

`e2e/stripe-money-path.spec.ts` drives the **hosted** page:
`waitForURL(/checkout\.stripe\.com/)` (`:209`), top-document selectors for
email/address/card, the #103 hardenings (card accordion expanders `:108`,
`/^Pay(\s*\$…)?$/` matcher `:159`, Link save-info uncheck `:147`). The
nightly (#110) runs it against a local server whose env decides the flag.

- Slices 1–2 don't touch the spec: it buys via `/preview`, which stays
  hosted until slice 3, and the nightly env won't set the new flag.
- Slice 3 (flipping `/preview`) migrates the spec in the same PR:
  - Navigation assert becomes `waitForURL(/\/checkout\?/)` on our origin;
    session id read from the page (expose `data-testid` carrying it) rather
    than the URL host.
  - Form fills move inside the iframe:
    `page.frameLocator('iframe[name^="embedded-checkout"]')` (verify the
    actual name/title attribute against a live mount — Stripe owns it).
    The field candidates, accordion expanders, and Link workaround carry
    over as frame-scoped locators; expect one calibration run, same as
    #103.
  - Everything from redirect onward is unchanged: `waitForURL(/\/order\/
    confirm/)`, webhook poll to `submitted`, ledger asserts.
- The nightly then covers embedded; hosted keeps unit coverage
  (`checkout.ts` builders) and remains exercised by cart until its slice.
  Accepting no nightly hosted coverage in the interim is deliberate — the
  nightly's job is the flow customers use.

## Build checklist (PR-shaped slices)

- **Slice 1 — mockup on /d.** `getListingMockup` (+ shared render helper
  extraction from `generateMockup`), client wrapper lifting product/color
  state, hero swap with instant layer + crossfade. No checkout changes. On
  its own this closes the regression half of #135.
- **Slice 2 — embedded checkout on /d, flagged.** Deps + publishable key +
  `EMBEDDED_CHECKOUT_ENABLED`; `uiMode` branch in the session-param
  builders (unit tests: embedded params have `ui_mode`/`return_url`, no
  `cancel_url`; hosted unchanged); `createStripeCheckoutForOrder` returns
  `{ clientSecret, sessionId }` under the flag; `/checkout` page (review
  pane + EmbeddedCheckout + back link); `/order/confirm` open-session
  state; `buyPublishedDesign` wired. Live-verify on a phone with the test
  key before flipping prod.
- **Slice 3 — /preview flow + e2e migration.** `createCheckoutSession`
  under the flag; `/checkout` review pane fed from the `/preview` mockup
  cache; stripe-money-path spec migrated to the embedded iframe (one
  calibration run of `npm run e2e:stripe` locally); nightly env gets the
  flag.
- **Slice 4 — cart (separate decision point).** N-line review pane,
  `buildCartCheckoutSessionParams` branch, cart spec updates. Only after
  slices 2–3 have soaked; hosted until then.

## Open questions

1. **Where/when the mockup appears on /d.** Recommendation: swap the hero
   in place when the buyer expands Order (collapsed page stays
   artwork-on-backdrop and fetch-free); instant artwork-on-color layer
   immediately, Printful mockup crossfaded in; no separate review step on
   /d — the review step is the `/checkout` page.
2. **Checkout on a dedicated route vs inline on /d.** Recommendation:
   dedicated `/checkout` page (mockup review pane + embedded form + back
   link). Inline mount would create order rows on panel-expand and can't be
   shared with /preview and cart later.
3. **Rollout order and cart scope.** Recommendation: flag `/d` first,
   `/preview` second, cart stays on hosted checkout until a later slice 4
   decided separately.
4. **Back/cancel behavior.** Embedded has no cancel_url; recommendation:
   `/checkout` carries `?from=` and renders a "← Back" link to it (plus
   normal browser Back); abandoned open sessions/pending orders are left to
   Stripe's 24h expiry, same as hosted today.
5. **/order/confirm.** Recommendation: keep it as the `return_url` target
   unchanged for success, and add an open-session branch ("payment didn't
   complete" + link back to `/checkout`) — which also fixes a latent hosted
   gap.
6. **Nightly e2e coverage during and after the switch.** Recommendation:
   leave the spec on hosted until slice 3 flips `/preview`, then migrate it
   to the embedded iframe in that same PR; accept that hosted then has no
   nightly coverage (builders stay unit-tested, cart still exercises hosted
   until slice 4).

"Go with recommendations" is a sufficient reply.

## Answers (Nico, 2026-08-03)

All six: **go with recommendations.** No deviations. Build order is the
checklist above, starting at slice 1.
