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

### Task 1 — `cheapestActiveBlank` + `cardPriceLine` (commit 308602a)
Complete, review clean (spec ✅, quality approved). Deferred minors: the
tie-break branch in `cheapestActiveBlank` is reachable only by reasoning (the
live catalog never ties — $19.43 vs $26.18), the "agrees with minRetailPrice"
test is circular by construction (the sibling "sold at that price" and
"$19.43 today" tests carry the independent verification), and an empty
`ACTIVE_BLANKS` would render `From $Infinity` rather than throw (unreachable —
an empty catalog breaks checkout outright).

### Task 2 — feed carries `product.blank_id` (commit f364e56)
Complete, review clean, no findings. The reviewer mutation-verified the
fixed-blank test is non-vacuous (stubbing the select to NULL fails it) and
independently confirmed `buildMirrorProductRow` is the sole mirror writer and
hardcodes `blankId: null`, so the docblock's claim about production is true.

### Task 3 — Paper card anatomy (commit 4a3d4a6)
Complete, review clean. Mutation-verified on four axes: reintroducing
`rounded-md`/`border-accent`, reverting to `md:grid-cols-4`, reverting
`GRID_SIZES` to the 767px boundary, and flipping `loading` to `eager` are each
caught. Contrast checked: `--text-muted` 8.25:1, `--text-faint` 4.74:1, both AA
at 11px.
Implementer ruling: no `focus-visible:outline-none` on the `<Link>` — the
well's `group-focus-visible:border-border-hover` sits inside the native focus
outline's box, so both remain visible and the reset would be cosmetics.
Deferred minor: `loading="lazy"`/`decoding="async"` are also next/image's
defaults, so deleting those props alone does not fail the test (an `eager`
regression does).
Open, and only a browser can close it: real layout at 390px with two columns
and a long title.

### Task 4 — `/shop` masthead + homepage teaser (commit be6b2f2)
Complete, review clean. `src/app/__tests__/page.test.tsx` and every
`e2e/*.spec.ts` are byte-identical to main, verified by both the reviewer and
the controller.

**Ruling (controller, pre-flight): the teaser test goes in a NEW file**
`src/app/__tests__/home-shop-teaser.test.tsx` that stubs
`@/components/maker-hero`, overriding the plan's "extend page.test.tsx".
`MakerHero` is a client component calling `useRouter`, and `page.test.tsx`
mocks `next/navigation` with `redirect` only — rendering `Home()` there would
throw, and widening that mock would convert a deliberately-never-rendered
decision test (its docblock says the non-render is the point) into a render
test. Cost if wrong: one extra 40-line test file.

**Ruling: keep `from="/"` on the teaser's `PublishedGrid` although it is inert
today.** Implementer and reviewer independently confirmed `nav.ts`
`detailParent()` has no `"/"` case and falls to the same Shop default as an
omitted prop. Keeping it records the link's real origin, matches every other
call site, and makes a future `"/"` case a nav.ts-only change. Cost if wrong:
one inert prop and its comment, a one-line revert.

**Ruling: the `→` is dropped from "See all".** The link is now plain
underlined text in a masthead row rather than a centred button-ish affordance,
so the arrow was carrying weight the underline now carries.

**Controller verification of the reported build failure:** the implementer's
`npm run build` failed because an agent shell in a worktree has no `.env.local`
and therefore no env at all. Re-run with CI's exact dummy-env block from
`.github/workflows/ci.yml`, the build SUCCEEDS and emits every route. Not a
defect.

### Whole-branch Opus review — 2 Important, 4 Minor, 0 Critical
Exactly the class of finding per-task reviews cannot see: three of the six live
in comments and copy that no task diff touched.

**Important 1 (fixed): `cardPriceLine`'s docblock claimed "the card and the
till cannot disagree".** They differ by `FLAT_SHIPPING_USD` ($4.69) —
`computePrice` is the ITEM price and the till adds shipping as a separate
Stripe line. This is the same conflation that made `"From $19.43, shipped."`
false and got it deleted in #214. The rendered card copy is honest (it claims
no delivered price); the sentence a future reader would rely on was the
problem. Now states the item/delivered split explicitly.

**Important 2 (fixed): the price line truncated on common phones.** ~165px of
Geist Mono at 11px against a ~163.5px card at 375px (iPhone SE/mini) and
~156px at 360px — every card reading `From $19.43 · Classic T…`, on the money
line, on a phone-first product, invisible to jsdom.
**Ruling: remove `truncate` from the price line rather than resolve a marginal
font-metric estimate in a browser.** The string is generated from the catalog
(garment names are short constants), never adversarial user text, so wrapping
is safe where the title's `truncate` is not; every card carries the same string
today, so cards wrap in step. Cost if wrong: a two-line price on the narrowest
phones.

**Minor 1 (fixed): `{img.title ?? "Untitled"}` rendered an empty `<p>` for an
empty-string title** — reachable, since `EditableNaming` has no blank guard and
`updatePublishedNaming` writes `title.trim()`. The pre-branch code omitted the
line entirely, so this was a regression this branch introduced. `||` restores
the fallback, with a test.

**Minor 2 (fixed): stale docblock** calling `/d/[imageId]` "the buy page" —
since #145 it serves owner-private images, and this repo's required vocabulary
is "image detail page" (memory `feedback-image-detail-page`).

**Minor 3 — Ruling: DEFER to a follow-up.** `src/lib/db/schema.ts` still says
"Nothing reads mirrors yet." next to `blankId`, which this branch makes false.
But the drift predates the branch (#182 did the read swap, #186 the writer
cutover), schema.ts is not in this slice's allowed file set, and a parallel
slice may hold it this session. A comment-only edit there buys nothing
user-visible and risks a merge conflict. Cost if wrong: one stale sentence
survives one more PR.

**Minor 4 (fixed here):** this ledger's task log was empty and two Task 4
judgement calls were unrecorded. Both are now above.

Reviewer notes carried to the PR body rather than filed: every live card reads
"· Classic Tee" because all production mirror rows are `blankId` NULL while the
detail page offers three garments (internally correct — the garment name
follows the price, so it can never quote blank A's price beside blank B's
name); and `/admin/published` is now the last surface on `md:grid-cols-4` +
`rounded-md` + the old `sizes` string, which belongs to a parallel slice's file
this session.
