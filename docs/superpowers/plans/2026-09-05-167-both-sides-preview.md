# Plan: preview the shirt as an object — both sides at once (#167)

**Spec authority:** issue #167 (decisions 1 and 2, made with Nico
2026-08-17); `docs/buy-flow-front-swap-plan.md` for the placement state
model on `/preview` (slice 2 shipped in PR #164; slice 3 stays HELD — do not
build a front picker on `/d`). **Branch:** this one (`cloud/167-both-sides-preview`).
Migration-free.

## What changes

**Decision 1 — retire the Front/Back toggle on BOTH buy surfaces.**
Replace the single hero + mode toggle with: front hero + smaller back tile
beside/below it; tapping the back tile swaps prominence (back large, front
small). When there is no back design the tile slot shows the existing "Add a
back design (+$8.00)" entry point (`/preview` has it under the size picker;
`/d` has it in `buy-panel.tsx`). A back-render failure must be VISIBLE in
the tile (error state with retry), never silently hidden behind a healthy
front.

- `/preview` (`src/app/preview/page.tsx`, ~1275 lines): the toggle lives
  around `activePlacement` / `switchPlacement`; the placement state,
  `mockups{front,back}`, `renderMockupFor`, the back-source picker and the
  `?back=` URL param all stay. Only the presentation changes: both mockups
  are requested when a back exists (back lazily after the front, as today's
  prefetch order), both are shown.
- `/d/[imageId]` (`buy-hero.tsx` + `buy-panel.tsx`): today "Add a back
  design" exists with NO back preview at all — that is the failure report
  that opened this issue. `getListingMockup` in `src/app/d/actions.ts` is
  front-only and anchored on `sourceImageId: imageId`; extend it (or add a
  sibling) to render the back placement for a chosen `backImageId`, with the
  same visibility gate (`canViewImagePage` for the page image AND
  `canUseAsPlacementSource` for the back source — never weaker). Same
  instant-artwork-then-mockup crossfade the front hero uses
  (`resolveHeroDisplay`, `mockupBackdrop`).

**Decision 2 — the back appears everywhere, eventually.** In this PR: the
order confirmation page (`/order/confirm`) and `/orders` per-line rows show a
back thumbnail next to the front when the line's `placements.back` exists.
`src/lib/order-line-identity.ts` is the batched mapper both read from —
extend it with the back image rather than adding a second query. Cart line
and the Stripe line item are OUT of scope (Stripe takes one image per line;
the front is right).

## Global constraints

- Phone-first: at 390px the front hero keeps its current size; the back tile
  is ~1/3 width below or beside it, ≥44px tap target; no horizontal scroll.
- The #102-class bug (stale mockup shown for a different pick) is closed by
  `src/lib/mockup-cache.ts` keys carrying product/source/scale — keep using
  the shared builders; never hand-build an R2 or cache key.
- Mockup rendering on `/d` is reachable anonymously; bounded to real
  catalog product×color×(front|back) combos, unknown inputs throw before any
  write. Keep that property.
- Copy: The Clean Label — "Front" / "Back" as mono labels, no whimsy.
- Tests: pure display/state helpers unit-tested; RTL for the swap; the
  Playwright `e2e/preview.spec.ts`-style specs that assert on the toggle
  must be updated, not deleted. `npm run lint`, `typecheck`, `test`, `build`
  green. You cannot reach prntd.org or a Vercel preview from a cloud
  session; say so in the PR body and list the two smokes Nico should run
  (one per surface, ~4 steps each, one observable).

## Tasks

1. Pure helpers: `src/lib/instant-preview.ts` (or a sibling) gains a
   `sidesLayout({front, back, prominent})` model + tests; extend
   `order-line-identity.ts` with `backImageUrl` + tests.
2. `/preview`: replace the toggle with hero + tile; visible back error
   state; update e2e.
3. `/d`: back mockup action (visibility-gated) + hero/tile in `buy-hero.tsx`
   driven by `buy-panel.tsx`'s back pick.
4. Confirmation + `/orders` back thumbnails.
5. Docs: `docs/buy-flow-front-swap-plan.md` gets a "#167 status" note;
   CLAUDE.md Next line for #167 updated.

Use superpowers:subagent-driven-development to execute. Ledger in
`.superpowers/sdd/<plan-basename>/progress.md`. Open a normal (non-HOLD) PR.
