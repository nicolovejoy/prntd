# Paper slice 6 — Shop feed (#188) — progress ledger

Branch `feat/188-paper-shop-feed`. Plan: `docs/superpowers/plans/2026-09-07-paper-shop-feed.md`.

## Controller rulings (pre-implementation)

1. **`cardPriceLine` takes only the garment identity, not a price override.**
   `product.price` is always NULL on a Shop mirror (`buildMirrorProductRow`
   hard-codes it) and organizer products cannot reach this feed (`isShopMirror`
   requires `design_id IS NULL`; `store-service.createProduct` always sets one).
   A price branch would be unexercisable code on a customer-facing money
   surface. Cost if wrong: one argument, added later, with a row proving it.

2. **Always "From $X", and the garment name follows the price.** A card shows no
   size and a blank's price varies by size (Classic Tee $19.43 S–XL / $21.43
   2XL), so a bare price would be false for some buyer. Separately, the brief's
   "minRetailPrice() + the default garment's name" pairs two facts that agree
   only by coincidence today (both are Classic Tee / 19.43) — added
   `cheapestActiveBlank()` returning both from one scan, with `minRetailPrice()`
   delegating to it (identical output, existing tests unchanged).

3. **`blankId` is optional on `PublishedImage`.** `ImagePage` derives from that
   type via `Omit`, and `getImagePage` lives in a file a sibling slice owns this
   session; making the field required would force an edit there for no gain (the
   detail page renders a real per-size buy panel, not a card price line).
   `undefined` ≡ `null` ≡ "buyer picks", which is the literal truth for every
   mirror row in production.

4. **`md:` → `lg:` for the fourth column drags `sizes` with it.** `GRID_SIZES`
   encodes the breakpoints as media queries; moving the columns alone would make
   768–1023px fetch a 25vw source for a 33vw slot — a softness regression on
   exactly the widths #144 addressed.

5. **No e2e edits.** `e2e/landing.spec.ts` is anchored on `maker-hero`, its
   textbox/submit and `example-chip`s — nothing in the teaser. `prod-smoke.yml`
   probes `/shop` for `data-testid="published-grid"`, which stays on the same
   element. Verified by reading both files.

## Grounding spike (controller, before planning)

`next/image` renders in this repo's jsdom + Vitest with **no mock**: a
`PublishedGrid` render produced a real `<img loading="lazy" decoding="async"
sizes="…" srcset="/_next/image?…">`. So the lazy-attribute regression test
asserts against the real DOM. Mocking `next/image` would make it vacuous — the
plan forbids it.

## Task log

(appended as tasks complete)
