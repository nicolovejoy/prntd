# The composition gap: conversation, image, blank, and the missing shirt

Written 2026-08-04, from Nico's question mid-#138: "how are we thinking about
the difference between a design, a conversation, and a product like a t-shirt
that can have one or two designs on it?" His read — that a Shop of bare images
"seems a little bit off and I don't think we've thought it through correctly" —
is correct. This doc names the gap. It does not decide it.

## What exists today

**Conversation** (`design`). The chat thread. Produces images, has `closed_at`,
has `primary_image_id` naming its canonical output. Not sellable. Since Model B
it correctly owns nothing but the conversation itself.

**Image** (`image`). The artifact. Owned, with lineage (`parentImageId`,
`seedImageId`, `originalDesignerId`), living independently of any conversation
via the `conversation_image` join. Publishable: `listing` is a row keyed on
`imageId`, existing iff the image is public.

**Blank** (`blanks.ts`). The physical garment and its printable areas. Config,
not a table.

**Composition** — one or more images mapped onto a blank's placements. What a
t-shirt actually is. **Not first-class.** It is materialized in exactly two
places, which do not agree:

- `product` (schema.ts:243) — the organizer sellable. `designId` + `blankId` +
  `placements: Record<placementKey, imageId>` + `price` + `storeId`. A real
  persisted, priced, listable composition. The only one that exists before
  purchase.
- `order_item` / `cart_item` — `designId` + `productId` (a **blank** id — the
  known naming foot-gun) + size + color + `placements`. Also a composition, but
  born at add-to-cart or checkout from client state, and never persisted
  otherwise.

## The gap

**The Shop sells images. The organizer storefront sells compositions. Both are
called shops.**

`listing` is keyed on a single `imageId`. There is no slot for "this shop item
is a shirt with A on the front and B on the back." Every Shop purchase
re-composes from scratch: arrive at an image, pick blank/color/size, optionally
bolt on a back; the composition is born at checkout and dies with the order
line.

Three consequences already visible:

1. **A shop item cannot be two-sided.** Not unbuilt UI — there is nowhere to
   put it.
2. **Attribution has no defined answer once a shirt carries two images.**
   "Designed by X" derives from the design owner via `order.designId`. #138 Q5
   (a Shop image as YOUR front) puts two owners' images on one shirt.
   Attribution belongs to the composition — a contributor set — and there is no
   composition to hang it on. `image.originalDesignerId` is per-image and
   cannot answer "who made this shirt."
3. **`/d` does two jobs**: the image's canonical page AND the buy page. This is
   exactly why #138 Q1 (front picker on `/d`?) is awkward — the page is
   identified by an image but sells a composition. The awkwardness is a symptom
   of the missing layer, not a UI problem to design around.

Stale debt found while reading: `product.placements`' comment still says
"design_image id" — that table was dropped in Model B slice 5; those are
`image` ids now. And `product.designId` is `notNull`, so an organizer product
is welded to one conversation — a composition drawing on two threads cannot be
expressed there either.

## Two coherent directions

**A — images stay the unit; composition stays ephemeral.** The Shop is a
gallery of art; the shirt is configured per purchase. This is what is built.
Honest about what PRNTD is: you buy *art*, the shirt is the delivery mechanism.
Cost: no two-sided shop items ever; the seller has no say in the product; the
two storefronts stay conceptually different forever.

**B — promote composition to first-class; the Shop sells compositions.**
`product` is already ~80% of this object. Generalize it: drop the `designId`
FK (derive contributors from the placement images), allow a PRNTD-owned product
with no `storeId`, let a listing *be* a composition. A single-image front-only
listing becomes the degenerate case rather than a separate concept. Unifies
both storefronts, gives attribution a home, makes two-sided shop items
expressible, and makes pricing a function of the composition rather than of
`hasBack`.

Claude's recommendation: **B eventually, but not next**, and #138 should not
wait on it.

## Consequence for #138 (unresolved as of this writing)

- **Slices 1 + 2** (`/preview` front pin + swap) are pure per-purchase
  configuration. The pin lands in `order_item.placements`, which is the
  composition-at-purchase under either model. Correct work regardless, and
  slice 2 is what closes the issue's actual complaint. Slice 1 is already
  built and merged (inert).
- **Slice 3** (`/d` front row + swap) is the model-dependent one — and it is
  the slice whose open question felt wrong. Not a coincidence.

Proposal on the table: ship 1+2, hold 3, settle the composition question before
touching the image detail page's buy flow. That also turns #138 Q1 into "not
yet, pending the model call" rather than a permanent design stance, and gives
Q5's attribution wrinkle a real home.

## Open questions for Nico

1. Does B match where this is going — a shop that sells *shirts* (composed,
   possibly two-sided, seller-defined) rather than a gallery of art you can put
   on a shirt?
2. If yes, is the organizer `product` the thing to generalize, or do the PRNTD
   Shop and organizer storefronts stay separate products long-term?

## Status of #138's six questions

Discussed: Q1 and Q2 (below). Q6 is moot — #135 slice 1 shipped 2026-08-04, so
"land #135 slice 1 first" already happened. Q3, Q4, Q5 not yet discussed.

- **Q1 — front picker on `/d`, or swap only?** Claude recommended swap only
  (the page's URL/title/attribution stop describing what's being bought
  otherwise; navigating to the image's own page is one tap; additive later
  since slice 3 already adds the guarded override). **Now superseded by the
  composition question** — see above.
- **Q2 — does changing the front on `/preview` also set
  `design.primaryImageId`?** Claude recommended **no**: keep the pin
  per-purchase. #149's "Use this one" is the explicit curation action and
  deliberately works on closed conversations; a purchase silently re-curating
  the thread (My Designs thumbnail, `/d` landing image, every future default
  front) is an unrequested side effect. Cost: ordering a non-primary front
  twice means picking it twice. **Nico has not ruled on either.**
