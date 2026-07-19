# Preview + order collapse — one purchase screen

Spec only, no implementation. Collapses `/preview` (mockup, product, color,
back design) and `/order` (size, price, checkout) into a single mobile-first
screen. Also implements #44 (remembered product/size defaults) since the
combined screen is where defaults land.

Decisions locked with Nico 2026-07-19:

- **One screen:** mockup hero on top; product/color/size/back controls, price,
  and CTA in a sticky bottom area.
- **Remembered defaults (#44):** signed-in users get product + size from their
  previous purchase. Color is NOT remembered — default is the design's pinned
  backdrop color when there is one, else white.
- **No silent size (PR #66):** a remembered size may pre-select but must be
  visibly selected; a first-ever purchase starts with no size and a disabled
  CTA.
- **Hero loading (PR #65):** instant artwork-on-color preview
  (`resolveHeroDisplay`, `src/lib/instant-preview.ts`) is the hero's loading
  behavior — artwork on a shirt-colored silhouette immediately, exact Printful
  mockup crossfaded in.
- **Auth gate stays at checkout** — guest funnel (#26 Stage A) unchanged.

Prerequisite: PRs #65 (`feat/instant-color-preview`) and #66
(`fix/buy-panel-explicit-size`) merge first. This plan builds on both — the
hero comes from #65, the nullable-size `SizePicker` and CTA gating come
from #66.

## Why

The funnel is `/design` → `/preview` → `/order` → Stripe. `/preview` and
`/order` are two screens showing the same thing (design on a shirt) with the
controls split arbitrarily between them: product + color + back live on
`/preview`, size + price + Buy/Add-to-cart on `/order`. Costs of the split
today, from the code:

- `/order` re-fetches its own Printful mockup at `scale=1.0`
  (`src/app/order/page.tsx`, `generateMockup(designId, color, productId, 1.0)`)
  while `/preview` renders at the user's chosen scale — the checkout image can
  differ from the one just approved.
- Color is pickable on both screens; changing it on `/order` re-renders a
  mockup the user already waited for on `/preview`.
- The handoff (`handleApprove` in `src/app/preview/page.tsx`) is an extra tap
  and a full page load on the phone-first path.
- "Add to cart" sits on `/order` only because `/preview` had no size picker
  (noted in the #26 plan). Merged, that constraint disappears.

## 1. Target screen

### Phone layout (primary)

Top to bottom:

1. **Hero** — the `/preview` hero as of PR #65: `ProductSilhouette` instant
   layer with the exact Printful mockup crossfaded on top
   (`resolveHeroDisplay`), lightbox zoom, "Rendering exact preview…" pill,
   error overlay + retry. Front/Back toggle and the back-source picker (#25
   2.4b) stay attached to the hero. Height capped (~50vh) so the controls
   are reachable without scrolling on common phones — same treatment as the
   `/d/[imageId]` mobile buy page (image capped at 40vh).
2. **Controls** (scroll region): product selector (`ACTIVE_BLANKS` buttons,
   from `/preview`), `ColorPicker`, `SizePicker` (nullable value per #66),
   back-design affordance ("Back design +$8.00" rides the Front/Back toggle
   as today), scale slider (existing visibility rule: only while no mockup
   for the active placement), price breakdown (item / back line / shipping /
   total — the `/order` block, driven by `calculatePrice` +
   `computeOrderTotal`).
3. **Sticky bottom bar** (fixed, safe-area aware — the `/order` mobile bar +
   `/d` BuyPanel pattern): `Buy now — $NN.NN` primary, `Add to cart`
   secondary (behind `CART_ENABLED`), "Choose a size" hint when size is null
   (#66). Page reserves matching bottom padding.

### Desktop adaptation (brief)

Two-column grid like `/order` today: hero left, controls + price + inline
CTAs right. No sticky bar. Nothing else changes between breakpoints.

### Reused components

- `resolveHeroDisplay` + `ProductSilhouette` (PR #65) — hero.
- `SizePicker` / `ColorPicker` (`src/components/product-options.tsx`, PR #66
  versions: nullable size value, `aria-pressed`, `note` prop on ColorPicker).
- Front/Back toggle + back-source picker + mockup cache/refs from
  `src/app/preview/page.tsx` (#25 2.4b).
- Price breakdown block + sticky bar from `src/app/order/page.tsx`.
- `Breadcrumbs` / `breadcrumbTrail`.

### What the merge removes

- `/order`'s duplicate `scale=1.0` mockup fetch — one mockup pipeline, the
  hero's.
- The `handleApprove` handoff (`approveDesign` + `router.push("/order?…")`).
  `approveDesign` flips `design.status` to `approved` and warms the mockup
  cache; the prefetch half is already covered by `ensureMockupsPrefetched`
  on preview load. What happens to the status flip is open question 2.

## 2. Route plan

**`/preview` survives as the combined screen; `/order` redirects.**

Rationale: every entry link points at `/preview` (`/design` routes
`/preview?id=` on accept, `/designs` cards link `/preview?id=`), and the
merged screen is mostly the preview page's machinery (placement renders,
mockup cache, back picker). `/order` is only reached via the preview handoff
and Stripe cancel URLs. Keeping `/order` instead would mean rewriting every
entry link for no gain. The name also matches the screen: you're previewing
the shirt you're about to buy.

- `src/app/order/page.tsx` → a server-component redirect:
  `redirect("/preview?" + searchParams)` preserving `id`, `product`, `size`,
  `color`, `back`. This keeps in-flight Stripe sessions working — their
  cancel URLs (built in `createCheckoutSession`) point at `/order?id=…` until
  the deploy, and sessions live ~24h.
- `/order/confirm` stays untouched (Stripe success page; the directory
  survives).
- `src/app/order/actions.ts` stays where it is — `createCheckoutSession`,
  `createStripeCheckoutForOrder`, `calculatePrice` are imported cross-
  directory today (`d/actions.ts`, cart) and moving them buys nothing.

### Query-param contract on `/preview`

`id` (design, required), `product`, `size`, `color`, `back` — the union of
both pages' params. All selections sync to the URL via
`window.history.replaceState` (the `/order` pattern), so Stripe cancel →
back restores the full selection. Standardize on `replaceState`: `/preview`
currently uses `router.replace` for product changes, and the maker-landing
work established that `router.replace` issued next to a server-action call
gets cancelled by the action. `back` keeps `/order`'s capture-once-on-mount
handling and the `multiPlacementEnabled()` double-gate (client + checkout).

`createCheckoutSession`'s `cancelUrl` changes to
`/preview?id=…&size=…&color=…&product=…[&back=…]`.

### nav.ts

- Delete the `/order` trail case (`[HOME, myDesigns, designStep,
  previewStep]`) — the route only redirects.
- `/preview` keeps `[HOME, myDesigns, designStep]`; up/Escape from the
  combined screen lands on the design thread, which is right — the step
  above "buy it" is "edit it".
- `/order/confirm` case unchanged (`[HOME, Orders]`).

## 3. Remembered defaults (#44)

### Source: last purchase, server-side

New server action, e.g. `getLastPurchaseDefaults()` (in
`src/app/preview/actions.ts`, DB work in a lib helper so it's testable):

1. Session user; return null for guests/anonymous (`isAnonymousUser`).
2. Most recent order for the user with `status NOT IN ('pending',
   'canceled')` — pending never paid, canceled shouldn't re-seed —
   `ORDER BY createdAt DESC LIMIT 1`, plus its `order_item` rows
   (`orderBy(createdAt)`, the #41 convention).
3. `resolveOrderLines(order, items)` (`src/lib/order-lines.ts`) → first
   line's `blankId` + `size`. Every checkout writes an `order_item` since
   Phase 1b (PR #54); legacy scalar orders resolve through the same helper.
4. Validate: `blankId` must be in `ACTIVE_BLANKS` (a discontinued blank never
   comes back as a default — the #44 requirement); `size` must be in that
   blank's `sizes`. Drop whichever fails.

Returns `{ blankId, size } | null`. One query pair at page load, no schema
change.

### Guests: skip, no localStorage

Recommendation: no fallback for guests. A guest's first purchase has no
history by definition; after sign-in the claim flow (`onLinkAccount`)
re-parents orders to the account, so history follows them without a second
store. localStorage would add a stale-able duplicate source of truth and
another path through the no-silent-default rule for marginal benefit.
Tradeoff: a signed-out returning buyer re-picks size once per device; that's
acceptable.

### Precedence and the no-silent-default rule

For each control: **URL param (validated) > remembered default > static
default**. URL wins so Stripe-cancel restore and deep links behave.

- **Product:** URL `product` → remembered `blankId` → `DEFAULT_BLANK_ID`.
- **Size:** URL `size` (if in the product's sizes) → remembered `size`,
  rendered as a **visibly selected** chip (`aria-pressed`, accent border —
  the #66 SizePicker selected state) → `null`. Null size keeps Buy/Add
  disabled with the "Choose a size" hint (#66). This reconciles #44 with
  #66: #66's bug was an *invisible* default (`sizes[1] ?? "M"`) silently
  charging a size the user never saw; a remembered size shown as a selected
  chip the user can change is not that. First-ever purchase → no history →
  starts unselected.
- **Color (not remembered):** URL `color` → the design's pinned backdrop
  color when set and present in the product's palette (the BuyPanel
  precedent: `preferredColor` from `design_image.background_color`,
  validated with `colors.some`) → `"White"` when the product has it →
  `colors[0]`. Plumbing: extend `getDesign` (or the combined screen's load)
  to expose the primary image's `backgroundColor` — the `/d` actions already
  select that column. Optional: reuse ColorPicker's `note` prop ("Designer's
  pick") when the backdrop default is active, as #66 does on the buy page.

## 4. Add to cart / cart flow

"Add to cart" moves to the combined screen — secondary button in the sticky
bar (mobile) / inline (desktop), still behind `CART_ENABLED`
(`isCartEnabled()`), still disabled until size is picked. `addToCart({
designId, size, color, productId, back? })` is unchanged, as are `/cart`,
`checkoutCart`, and the cart webhook path. The historical reason cart lived
on `/order` only ("no size on /preview") is void once the screen has a size
picker. Post-add navigation stays `router.push("/cart")`.

## 5. Server-action changes (small — choke points untouched)

- `createCheckoutSession` (`src/app/order/actions.ts`): `cancelUrl` string
  `/order?…` → `/preview?…`. Everything else identical — auth gate
  (`needsAuth` for anon), ownership check, `multiPlacementEnabled()` back
  gate, image pinning, `createStripeCheckoutForOrder` (order + `order_item`
  batch, `buildCheckoutSessionParams`).
- New `getLastPurchaseDefaults()` (§3).
- `getDesign` gains the primary image's `backgroundColor` (§3 color default).
- `approveDesign` loses its only caller (open question 2 decides the status'
  fate; the action can be deleted or repurposed accordingly).
- Unchanged: `calculatePrice`, `generateMockup`,
  `getOrCreatePlacementRender`, `ensureMockupsPrefetched`, `addToCart`,
  `buyPublishedDesign`, both checkout-session builders, the Stripe webhook.

## 6. Migration / rollout

**Straight swap, no feature flag.** Reasons: no schema change; the money path
is byte-identical except a cancel-URL string; a flag would mean maintaining
two purchase surfaces and adding Preview-scope env plumbing (the
`STORES_ENABLED` branch-scoping lesson) for a UI-only change whose rollback
is a PR revert. Tradeoff: no gradual prod exposure — mitigated by shipping in
slices (§7) so `/order` keeps working until the combined screen has been
live-verified.

### e2e updates

- `e2e/cart.spec.ts`: `addToCartFromOrderPage` navigates to
  `/order?id=…&product=…&color=Black&size=M` — becomes `/preview?…` with the
  same params (URL `size` pre-selects visibly per §3, so the flow still
  needs no click). The "Total" wait, Add-to-cart clicks, bundled-shipping
  invariant, and sign-in gate assertions carry over.
- `e2e/guest-funnel.spec.ts`: no `/order` URLs (comment only) — verify, no
  change expected.
- The size-gate behavior (CTA disabled until size) is covered by PR #66's
  component tests; an e2e assertion is optional.
- Remembered defaults: real-DB integration test on the new action (seed a
  user + order + `order_item` via the #41 factories; assert active-blank
  filtering and size validation). Not e2e — needs a signed-in session with
  order history, which the e2e harness doesn't mint.

### What dies

- `src/app/order/page.tsx` as a screen (replaced by the redirect).
- The `/order` case in `src/lib/nav.ts` + its tests.
- The order page's own mockup fetch/state.
- The `handleApprove` handoff on `/preview`.

`/order/confirm/`, `/order/actions.ts`, and everything below the server
actions stay.

## 7. Build checklist (PR-shaped slices)

- **Slice 0 — prerequisites.** Merge PRs #65 and #66. No new work.
- **Slice 1 — combined screen.** Add size picker, price breakdown, Buy now,
  Add to cart, sticky bar, and the `size`/`color` URL params to
  `/preview`; drop the `handleApprove` push. `/order` stays functional and
  reachable via existing cancel URLs — nothing links to it anymore, but the
  slice is shippable and revertable on its own. Live-verify the combined
  screen (mobile viewport, guest + signed-in, front+back, promo-code
  Stripe run optional).
- **Slice 2 — retire `/order`.** Redirect page preserving params;
  `cancelUrl` → `/preview`; `nav.ts` cleanup; `cart.spec.ts` URL swap;
  delete dead order-page code.
- **Slice 3 — remembered defaults (#44).** `getLastPurchaseDefaults` +
  integration test; wire precedence (§3) including the pinned-backdrop
  color default; `getDesign` backgroundColor plumbing. Independent of slice
  2 — can land in parallel after slice 1.

## 8. Open questions

1. **Buy gate vs mockup.** Today "Use this design" on `/preview` is disabled
   until the exact Printful mockup renders (`approveReady`), while `/order`'s
   Buy now never waits. On the combined screen, should Buy now wait for the
   exact mockup, or is size the only gate (buy while the instant preview is
   still crossfading)? Waiting preserves "you saw exactly what you bought";
   not waiting is faster and the webhook pins the primary image regardless.
2. **`design.status` "approved".** With no approve step, does the status
   retire (draft → ordered only), flip at buy/add-to-cart intent, or stay
   as-is unused? It currently feeds the `/designs` status badge, so this is
   user-visible.
3. **Scope of remembered defaults.** `/preview` only for now, or also the
   `/d/[imageId]` and `/shop` buy panels (issue #44's open question 1)?
4. **Mobile price breakdown.** Full item/shipping/total lines in the scroll
   region (transparent, taller), or total-only in the sticky bar with the
   breakdown behind a tap (tighter)?
