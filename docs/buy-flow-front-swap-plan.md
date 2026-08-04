# Buy flow: change the front design, swap front/back (#138)

From Nico's 2026-07-30 phone smoke: on the purchase screen the back design is
pickable but the front is not. The front is whatever design you arrived from;
changing your mind means backing out and re-entering from another design.
There is also no way to exchange the two.

Two buy surfaces are in scope and they do **not** get the same treatment. The
reasons are below.

## Current state

### The front placement is implicit; the back is explicit

`/preview` (design-your-own) never asks which image goes on the front. The
front resolves server-side from `design.primaryImageId`:

- `createCheckoutSession` (`src/app/order/actions.ts:83`) sets
  `placements.front = found.primaryImageId`.
- `addToCart`'s designId entry (`src/app/cart/actions.ts:146`) does the same.
- The hero calls `getOrCreatePlacementRender(designId, productId)` with no
  source (`src/app/preview/page.tsx:343`), which anchors on
  `found.primaryImageId` (`src/app/preview/actions.ts:258`).

The back, by contrast, is a first-class client selection: `backImageId` state,
a `?back=` URL param, a source picker rendered in the hero
(`preview/page.tsx:676-715`), threaded into the render, the mockup, the price
and the checkout.

`/d/[imageId]` (the image detail page, buy-existing) pins the front to the
page's own image: `buyPublishedDesign` sets `placements.front = params.imageId`
(`src/app/d/actions.ts:333`) and `addToCart`'s `frontImageId` entry does the
same (#146). `BuyPanel` offers a back picker and nothing for the front.

So the machinery for "a placement is a picked image id" already exists end to
end. What's missing is the front half of it.

### What already generalizes

- `placements` is `Record<string, string>` on `order_item` and `cart_item`.
  `front` and `back` are just keys. Nothing in fulfillment, emails or the
  webhook treats front specially beyond a display fallback.
- `canUseAsPlacementSource` (`src/lib/design-publish.ts:129`) is placement-
  agnostic already — it takes an image, its owner, the order's design and the
  requesting user. PR #95 removed its thread allowance after it leaked the
  seller's private generations to a cross-owner buyer.
- `assertUsableBackImage` (`src/lib/back-sources.ts:42`) is the DB-backed
  wrapper called at the checkout choke points. Nothing in it is back-specific
  except the name and the error string.
- `getBackSourceGroups` / `getBuyPageBackSourceGroups`
  (`src/lib/back-sources.ts:79`, `:123`) assemble This design / My designs /
  Shop. Also not back-specific.
- `getOrCreatePlacementRender` and `generateMockup` both accept an optional
  `sourceImageId` and both guard it with `canUseAsPlacementSource`. Front
  currently passes nothing, which means "anchor on the primary".
- `mockupCacheKey` / `mockupObjectKey` (`src/lib/mockup-cache.ts`) and
  `placement_render.source_image_id` all carry the source id — #102 fixed
  exactly the collision this feature would otherwise reintroduce.

### Two defects found while reading

1. `/preview`'s client-side mockup invalidation is dead code. After a
   placement render settles it builds `const prefix =
   `${productId}:${placement}:`` (`preview/page.tsx:355`) and deletes matching
   keys, but keys come from `mockupCacheKey`, which prefixes `v2:`. The prefix
   has not matched anything since #102. Harmless today (the same effect also
   nulls `mockups[placement]`, and the server clears `design.mockupUrls` on a
   fresh render); it stops being harmless once one product+placement can hold
   several source-specific entries.
2. `findPlacementRender(designId, productId, "front")` with no `sourceImageId`
   matches **any** front render for that product and returns the most recent.
   Correct while every front render is anchored on the primary; wrong the
   moment a non-primary front render can exist. See §5.

## 1. What "change the front design" means, per surface

### /preview — a real front picker

The front becomes an explicit per-purchase pin, `frontImageId`, defaulting to
`design.primaryImageId`. It is picked from the same three groups the back
picker already offers: This design (the thread's own outputs), My designs (the
user's other designs' primary images), Shop (published, not admin-hidden).
Exactly symmetric with the back, using the same action, the same picker
component and the same guard.

The pin is per-order. It does **not** write `design.primaryImageId` — see
open question 2.

### /d — no front picker, only swap

The image detail page's subject *is* the front image: the URL, the title, the
"by {designer}" attribution and `order.designId` all name it. A general front
picker there would turn a listing page into a composer whose URL no longer
describes what's being bought, and would make the order's attribution to the
seller arbitrary.

So on `/d` the only front change is the swap (§2), which is reachable only
after a back has been picked and only promotes an image that already passed
the back guard.

A buyer who wants a different front on `/d` navigates to that image's page
(My Designs card → image detail page, or a Shop card). One extra tap, and the
URL then matches what they are buying.

**These two surfaces deliberately behave differently.** The alternative —
a front picker on `/d` too — is a coherent option and is open question 1.

## 2. What "swap front/back" means

A literal exchange of the two ids in the placements map:

```
{ front: A, back: B }  →  { front: B, back: A }
```

On `/preview` it is a client-side exchange of `frontImageId` and
`backImageId`, followed by the same invalidation both individual changes
already do. On `/d` it exchanges the page's image with the picked back.

**With no back, there is no swap.** Swapping into an empty back is really
"move the front to the back", which leaves the front — a required placement —
empty, and silently adds the $8 back upcharge to boot. The Swap control is
therefore hidden until both placements are filled.

Alternative considered and rejected: a "Move to back" action that immediately
opens the front picker and shows the +$8 line. That is a two-step operation
dressed as one tap, and the two steps are already available separately
("Add a back design" then "Change front"). Open question 3.

## 3. Pricing

Price is a function of `(product, size, hasBack)` and nothing else:

```
computePrice(generationCost, productId, size, { back })   // src/lib/pricing.ts:119
computeOrderTotal(itemPrice)                              // :78
```

The identity of the front image does not enter it, and neither does the
identity of the back — only whether a back exists. Consequences:

- Changing the front is price-neutral.
- Swap is price-neutral **by construction**: it is only offered when both
  placements are filled, so `hasBack` is true before and after.
- Adding or removing a back is the only price-moving action, and that path is
  unchanged.

The server re-derives the price at every choke point from its own view of the
placements — `createCheckoutSession` computes `!!backImageId` after guarding
it (`order/actions.ts:67-76`), `buyPublishedDesign` the same
(`d/actions.ts:314-324`), `getCart` from `!!r.placements?.back`
(`cart/actions.ts:229`). The client never sends a price and no new client
value can influence one. Nothing in this feature changes that; the display
price keeps coming from the same pure helpers.

## 4. Authorization

Every newly-pickable front source goes through `canUseAsPlacementSource`, via
the DB-backed wrapper. That wrapper is renamed `assertUsableBackImage` →
`assertUsablePlacementImage` (same body, same guard, name no longer lies) and
called for the front pin at all three checkout choke points.

Who can pick what as a **front**, after this work:

| Surface | Viewer | Newly pickable as front |
| --- | --- | --- |
| `/preview` | signed-in owner of the design | This design's own outputs; the owner's other designs' primaries; published + not-hidden Shop images |
| `/preview` | anonymous guest | This design's outputs; published Shop images (My designs is empty until they claim the account — `getBackSourceGroups` with `userId: null`) |
| `/d` | cross-owner buyer | **nothing new.** Swap can only promote an image that already passed the back guard |
| `/d` | owner of the listing | nothing new (same reason) |

Two properties worth stating outright:

1. **A front pin never grants reach a back pin didn't already have.** The
   pickable set is identical to today's back set, on every surface. The guard
   is the same function; the checkout choke points call it for both keys.
2. **Thread membership still grants nothing.** `canUseAsPlacementSource` has
   no `image.designId === orderDesignId` branch (#95). On a `/d` purchase
   `orderDesignId` is the *seller's* design, so a forged image id from the
   seller's thread is rejected for the front exactly as it is for the back.

Enforcement points:

- `createCheckoutSession` — guard `front`, then `placements.front = front ??
  primaryImageId`.
- `addToCart` — guard `front` on the designId entry; the `frontImageId` entry
  already guards (#146).
- `buyPublishedDesign` — guard the front override (slice 3).
- `getOrCreatePlacementRender` and `generateMockup` — already guard an
  explicit source; they now receive one on the front path too.

A forged `front` id therefore fails in two independent places: the render
never happens, and the checkout throws before an order row exists.

## 5. Mockups

Changing the front invalidates the rendered mockup for that
product × color × sourceImageId. Everything needed is already keyed; the work
is threading the id and closing the loose-lookup hole.

**Cache-key rule.** Pass `sourceImageId` on the front path **only when the pin
differs from the design's primary**. When it equals the primary, pass nothing
— which produces the exact key shape in use today
(`v2:{product}:front:{color}:{scale}`), so every warm entry in
`design.mockupUrls` (including everything `prefetchProductMockups` bulk-warms)
stays valid. A non-default front gets its own key
(`v2:{product}:front:{imageId}:{color}:{scale}`) and cannot collide. Same rule
for the R2 object key, which `mockupObjectKey` derives from the same parts.

**DB-lookup rule.** `findPlacementRender(designId, productId, "front")` with
no source matches any front render for the product and returns the newest. As
soon as a non-primary front render exists, that can hand back a render of a
different image — the #102 bug shape one layer down. Fix, in the slice that
first produces such a render:

- `getOrCreatePlacementRender` already computes
  `anchorId = sourceImageId ?? found.primaryImageId` before the lookup; pass
  `anchorId` to `findPlacementRender` instead of `sourceImageId`.
- `generateMockup` has the design row in hand; pass
  `sourceImageId ?? found.primaryImageId` the same way.

Consequence to accept: an existing front render whose design's primary has
changed since now misses and re-renders once ($0.03, and only when the source
aspect actually needs regeneration for that placement). That is the correct
outcome — the cached row is a render of an image that is no longer the front.

**Hero re-resolution.** The `/preview` hero already re-runs its render effect
on `[designId, productId, hasPrimary, renderNonce, activePlacement,
backImageId]`; `frontImageId` joins that dependency list, and the front branch
passes it as the source. A front change then follows the same path a back
change does today: clear `mockups.front` and `lastArtwork.front`, invalidate
the latest-wins token (`mockupReq.invalidate()`), let the auto-trigger effect
re-fire `renderMockupFor("front")`. The instant artwork-on-color layer covers
the gap (`resolveHeroDisplay`), so there is no blank hero.

**And fix the dead prefix** (defect 1 above) in the same slice:
`v2:{productId}:{placement}` via `mockupCacheProductPrefix`, so the client map
is actually pruned when several front entries can exist.

On `/d`, the hero is currently static artwork. #135 slice 1 replaces it with
the `/preview`-style layered mockup hero driven by a client wrapper holding
product/color. Contract with that work: **the hero's mockup source is the
current front pin, defaulting to the page's `imageId`.** `getListingMockup`
already plans to take an explicit `sourceImageId` for exactly this reason
(`docs/d-buy-checkout-plan.md` "Authorization: a listing-scoped mockup
action"), so this is one extra argument, not a restructure.

## 6. The UI, on a phone

### /preview

The purchase-controls column gets a **Placements block**, sitting where the
standalone "Add a back design" link is today (between the size picker and the
price breakdown):

```
Front   [44px thumb]  Change
Back    [44px thumb]  Change   ×          ← or: Add a back design (+$8.00)
        [ ⇅ Swap front and back ]          ← only when both are filled
```

- Each row is a 44px thumbnail plus a text label and text actions; every tap
  target is ≥44px (memory `feedback_mobile_ux`).
- "Change" opens the **existing** hero source picker, now parameterized by
  which placement it is picking for; only its heading changes ("Pick an image
  to print on the front." / "…on the back."). The picker already caps at
  `max-h-[50vh]` and scrolls, and already nudges the phone to the top when
  opened from the controls column.
- The "Add a back design (+$8.00)" affordance becomes the Back row's empty
  state instead of a separate link, so the two placements read as peers —
  which is the point of the issue.
- The Front/Back hero toggle above the mockup is unchanged, including staying
  hidden until a back is in play (#61).
- The sticky bottom bar is untouched; the total already lives there.

### /d (BuyPanel, expanded)

The back row already renders as thumbnail + label + Change + ×
(`buy-panel.tsx:286-313`). It grows a peer above it:

```
Front   [44px thumb]  (no Change — see §1)
Back    [44px thumb]  Change   ×
        [ ⇅ Swap front and back ]          ← only when a back is picked
```

The Front row exists mainly so a swap is legible: after swapping, the hero
still shows the listing artwork until #135 slice 1 lands, and the Front row is
what tells the buyer which image is on the front. Once #135 slice 1 is in, the
hero follows the pin and the row becomes confirmation rather than the only
signal.

The 40vh mobile hero cap (`published-image-view.tsx:77`) is untouched — both
rows live inside the picker stack, which already scrolls, and the mobile CTA
stays pinned to the bottom.

## 7. Slices

Each is independently shippable and independently useful.

**Slice 1 — server-side front pin (inert).**
Rename `assertUsableBackImage` → `assertUsablePlacementImage` (mechanical; 4
call sites + 3 test files). `createCheckoutSession` and `addToCart`'s designId
entry accept an optional `front`, guard it, and pin
`placements.front = front ?? primaryImageId`. The Stripe line thumbnail
resolves the pin rather than the design's display image, mirroring #156's
cart-thumbnail fix. No UI sends `front` yet, so behaviour is unchanged.
Real-DB tests in the `add-to-cart-front-pin.integration.test.ts` shape:
guarded (private/hidden cross-owner id throws), owner grant, published grant,
pin survives into `order_item.placements`, absent `front` still resolves the
primary.

**Slice 2 — /preview front picker + swap.**
`frontImageId` client state seeded from the design's `primaryImageId`;
`?front=` URL param (written only when it differs from the primary); the
source picker generalized to take a target placement; the Placements block;
the Swap button. Render/mockup threading per §5, plus the
`findPlacementRender` front tightening and the dead cache-prefix fix. This is
the slice that closes the issue's main complaint.

**Slice 3 — /d front row + swap.**
`buyPublishedDesign` gains an optional `frontImageId` (guarded, defaults to
the page image); `addToCart`'s `frontImageId` entry accepts a front override
the same way. Front row + Swap button in `BuyPanel`. Hero source contract with
#135 slice 1.

**Ordering against #135.** Slices 1 and 2 do not touch `/d` at all, so they
can run in parallel with #135 slices 1–2 without conflict. Slice 3 edits
`BuyPanel` and the `/d` hero, which #135 slice 1 restructures (client wrapper
lifting product/color state) — land #135 slice 1 first and build slice 3 on
top of the wrapper rather than racing it. Open question 6.

## 8. Open questions

Each has a recommendation; "go with recommendations" is a sufficient reply.

1. **Front picker on `/d`, or swap only?**
   Recommendation: **swap only**. A general front picker makes the page's URL,
   title and seller attribution stop describing what's being bought, and the
   "navigate to that image's page instead" path already exists and is one tap.
   Cost of being wrong: it's additive later — `getBuyPageBackSourceGroups`
   already returns the right groups for a buyer, and slice 3 already adds the
   front override to `buyPublishedDesign`.

2. **Does changing the front on `/preview` also set `design.primaryImageId`?**
   Recommendation: **no.** The pin is per-purchase; #149's "Use this one" on
   the image detail page is the explicit curation action, and it deliberately
   also works on closed conversations. Letting a purchase silently re-curate
   the thread (changing the My Designs thumbnail, the /d landing image, and
   every future default front) is a side effect nobody asked for. Tradeoff: a
   buyer who orders a non-primary front twice picks it twice — acceptable, and
   remembered-defaults (#44) do not cover image identity anyway.

3. **Swap when there is no back: hide it, or offer "Move to back"?**
   Recommendation: **hide it.** Front is required, so "move to back" strands
   the front empty and adds $8 in the same tap. The two-step path exists.

4. **`?front=` in the URL: always, or only when it differs from the primary?**
   Recommendation: **only when it differs.** Keeps existing links, cancel URLs
   and the Stripe round-trip byte-identical for the common case, and keeps the
   URL honest — a `front` param means "not the default".

5. **Should the `/preview` front picker offer Shop images (someone else's
   published image as YOUR front)?**
   Recommendation: **yes.** It is already allowed as a back, through the same
   guard; refusing it on the front would be a rule with no principle behind
   it. One wrinkle to note either way: if the picked image's aspect doesn't
   fit the target placement, `getOrCreatePlacementRender` regenerates it
   anchored on the seller's prompt at the buyer's $0.03 — a derivative of
   someone else's work. That is already true for back picks today (#72/#95);
   this does not make it more true, but it is the moment to notice it. If that
   feels wrong, the fix is a separate decision that should cover both
   placements.

6. **Slice 3 ordering vs #135.**
   Recommendation: **land #135 slice 1 first**, then build slice 3 on its
   client wrapper. Both edit `BuyPanel` and the `/d` hero; sequencing costs
   nothing since slices 1–2 here are the ones that close the issue.

## Status

- **Slice 1: built** in this PR (server-side front pin, inert). Tests:
  `src/app/order/__tests__/front-pin.integration.test.ts`.
- Slices 2 and 3: not started. Slice 2 is gated on nothing; slice 3 waits on
  open questions 1 and 6.
</content>
</invoke>
