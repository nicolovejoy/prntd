# Progress — both sides at once (#167)

Plan: `docs/superpowers/plans/2026-09-05-167-both-sides-preview.md`.
Branch: `cloud/167-both-sides-preview` (rebased onto main 9732e20 — no-op, branch was at main's tip).
Method: subagent-driven development run by hand (the `superpowers:subagent-driven-development` skill is not installed in this cloud session): one implementer agent per task, a dedicated reviewer per task, fix rounds with scoped re-review. Tasks 2–4 run in parallel worktrees under `.claude/worktrees/` (disjoint files) once Task 1 lands.

## Rulings made before the build

**One shared side component.** `/preview`'s hero JSX and `/d`'s `buy-hero.tsx` hero JSX are near-duplicates (instant artwork layer + `mix-blend-multiply` mockup over `mockupBackdrop` + pending indicator). Both surfaces now need that panel twice (hero + tile), so Task 1 extracts it as `SideMockup` and Tasks 2 and 3 consume it rather than each inventing one.

**The tile-slot "Add a back design" is an additional entry point, not a relocation.** The plan says the empty tile slot "shows the existing entry point". The Placements block on `/preview` (#138 slice 2) and the back row in `BuyPanel` keep their Add/Change/Remove/Swap controls — those are the structural controls; the tile-slot button is the discoverable one next to the hero and triggers the same picker.

**Back renders after the front, never concurrently.** Two sides means two in-flight mockup fetches; the single latest-wins token would let the back's `begin()` supersede the front's fetch. Per-placement tokens and per-placement loading/error/loaded state, and the back mockup auto-fires only once the front's fetch has settled (success or error) — today's prefetch order, stated in the plan.

**`/preview`'s source picker gains Cancel.** With the toggle gone there is no "switch back to Front" to leave a back picker you opened by mistake; `BuyPanel`'s picker already has Cancel.

**`/d` back mockup skips the placement-render step, like its front.** `getListingMockup` prints the listed image as-is (no `getOrCreatePlacementRender`); the back sibling does the same for the picked back image. All active blanks' front and back placements share an aspect, and the image page has no reframe path to pay for.

## Task 1 — pure helpers + shared component — DONE

`sidesLayout` (+6 tests) in `src/lib/instant-preview.ts`; `SideMockup` in `src/components/side-mockup.tsx` (+9 RTL tests) — the layer markup moved from the two hero blocks byte-for-byte, root div → select `<button>` with the layers, sibling label pill, sibling `role="alert"` error overlay with a `min-h-11 min-w-11` retry (no button-in-button; retry can't reach `onSelect` by construction); `OrderLineIdentity.backImageUrl` (+5 tests) resolved through the context's existing id→url map (every placement id is already fetched — no new query), no design-level fallback.

Review: CLEAN. Three minors applied by the controller: the `error` prop doc now says the caller gates it on `display.showError` / mockup-error state; the side pill lost `aria-hidden` (a panel with no select button still names its side to assistive tech); a stale "pinned front" comment in the identity reader corrected.

Rulings from the review worth carrying forward:
- `bg-surface-alt` (the old `/preview` render-error overlay's background) is not a defined token — that overlay has been rendering transparent. The component uses `bg-surface`; Task 2 inherits the fix by adopting the component.
- `cursor-zoom-in` now follows `onSelect` being set; Task 2 passes `onSelect` only when the hero mockup is loaded to keep today's gating.
- On `/d` the instant-layer artwork goes from `max-h-[80%] max-w-[80%]` to the shared `width:62% max-h-[70%]` — deliberate, matches `/preview`.


## Task 2 — /preview — DONE (worktree `t2-preview`)

`activePlacement`/`switchPlacement` → `prominent` + `sidesLayout`; every render/mockup flag is per side (`PerSide<T>` + `perSide()`/`setSides()` helpers), per-side latest-wins tokens, one `invalidateMockups(sides)` for the five invalidation sites; two render effects share a `useCallback`'d `runPlacementRender(side, resolve)` (memoized on `productId` so it's a lint-clean dep — no new eslint-disable); two auto-trigger effects. The back's gate is `frontMockupSettled = !mockupLoading.front && (mockups.front || mockupError.front || renderStates.front.status === "error")` — "not loading" alone is also true BEFORE the front fetch starts, which would let the back go first when its render lands first (the `?back=` restore path); mutation-checked by the implementer (naive gate → the ordering test fails). Removed: toggle, its +$8 caption, "Change back image", the under-hero retry buttons and error paragraph — errors render per side via `SideMockup`. Picker gained Cancel (outside the scroll region). 4 RTL tests: swap, front-then-back ordering (deferred front promise), back error visible in the tile + retry with no alert on the hero, add-back tile → picker → Cancel. e2e: no spec asserts on the toggle (grepped); `cart.spec`/`stripe-money-path.spec` use only "Total" and "Add to cart" on /preview.

Review: CLEAN. Minor 1 applied by the controller: the front's auto-trigger now also waits on an in-flight back fetch (a front render retry landing while the back was out could overlap two Printful calls in the reverse direction). Minor 2 left as a UX knob, recorded below.

Rulings:
- **After a pick, the front stays the hero.** Both surfaces: a fresh back pick renders in the tile; picking a new front while the back is large leaves the new front in the tile. Consistent with the plan's "front hero + back tile" and with `/d`. If Nico wants "what I just changed is large", it is one line (`setProminent(target)` in `chooseSource`) on `/preview` and the same in `BuyHero`'s `handleBackChange`.
- The pre-existing same-commit double-fire of the auto-trigger (product change: fires once against the previous still-"ready" render, then again when the new render lands) is unchanged; HEAD did the same, and the server resolves the placement render from `(product, placement, source ?? primary)` so the early fire renders the right mockup.


## Task 3 — /d — DONE (worktree `t3-image-page`)

`getListingBackMockup` in `src/app/d/actions.ts`: flag → session → page image exists with a design → `canViewImagePage` → `assertUsablePlacementImage(backImageId, image.designId, viewerId ?? "")` (the checkout guard, so preview and purchase hold the pick to one bar; `""` matches no owner, so a signed-out caller reaches only published, not-hidden backs) → `renderAndCacheMockup(placementId "back", sourceImageId = the pick, scale 1.0)`. Nothing is written before the render; unknown product/color/placement still throw inside it first. 9 real-DB matrix tests. `BuyPanel` gained `onBackChange` (report-only, null on mount) and a React 19 `ref` prop exposing `openBackPicker` via `useImperativeHandle`; 21 existing tests unchanged, +2. `BuyHero`: per-side slots keyed by `product|color|source|retryNonce` — the key is what makes "the front has settled" a fact about the CURRENT selection (on the commit where the color changes the front's `setSlots` hasn't rendered yet, so a bare `loading:false` would let the back fire concurrently); back cleared at once on any key change, fetched only once the front slot carries the current key and is not loading; front retry leaves a healthy back alone; a front failure no longer blocks the back and now shows its own retry (this page had no visible mockup failure state before). 8 RTL tests incl. a deferred-front ordering test that fails when the guard is removed (mutation-checked by the implementer).

Review: CLEAN. Two of three optional minors applied by the controller: the fetch-order comment now states the one exception (a front Retry while the back is in flight runs beside it — harmless, not worth resetting the back), and a test title claiming "before reading anything" now says "before any render", which is what it asserts. The third was a pre-existing jsdom "Not implemented: navigation" stderr line from the #146 add-to-cart test — noted so it isn't attributed here.


## Task 4 — confirmation + /orders — DONE (Sonnet implementer, worktree `t4-orders`)

`getOrderBySession` returns per-line `imageUrl` + `backImageUrl` from one `resolveOrderLineIdentities` call; the confirmation page shows 48px front/back thumbnails on the line color with mono Front/Back labels only when both exist. `/orders` **migrated onto the mapper** (the implementer ran the two existing real-DB suites against the migration unmodified first — 13 assertions, none loosened; the reviewer independently traced pinned-front, display-fallback ordering (`image.rowid desc` both sides), legacy-owner fallback, viewer suppression, cursor re-grouping incl. zero-line orders, and placement-render pins — all equivalent). Four hand-rolled lookups and their imports are gone. Tests: +2 user-orders, +2 get-order-by-session (new real-DB file), +2 orders-list RTL.

Review: CLEAN, four minors applied by the controller: the confirmation row's right-hand size/color span no longer refuses to shrink (worst case "2XL / Heather Blue Lagoon ×2" beside two thumbs was ~2px over a 375px phone), the row is `items-center` so the two text runs align, `/orders` gates the back tile on the front thumbnail resolving (matches the confirmation page — a line whose front fails to resolve while the back does would otherwise show a "—" placeholder beside a real back), and a comment gained its verb.


## Task 5 — docs, gate, PR — DONE

Docs: `docs/buy-flow-front-swap-plan.md` — §6's "toggle unchanged" bullet marked superseded, the stale Status section corrected (slice 1 = #158, slice 2 = #164, slice 3 HELD) and a "#167 status" section added; a stray `</content></invoke>` tail from an old paste removed. `CLAUDE.md` Next item (6) updated. This ledger copied to `docs/superpowers/ledgers/2026-09-05-167-both-sides-preview-progress.md` (the `.superpowers/` original is git-ignored and dies with the container).

Gate on the merged branch (main checkout, worktrees removed): `npm run lint` 0 errors / 22 pre-existing warnings; `npm run typecheck` clean; `npx vitest run` 132 files, **1409 tests** (baseline before this branch: 126 files, 1360); `npm run build` OK. The build only passes under CI's dummy env block from `.github/workflows/ci.yml` — this container has no `.env.local`, and both `RESEND_API_KEY` (Resend client at module load, reached through the Printful webhook route) and `ADMIN_EMAIL` (`/admin/errors` config) are asserted at build time. Neither is touched by this branch.

Not run: Playwright. No `.env.local`, no Turso, and prntd.org / Vercel previews are unreachable from a cloud session (egress proxy). CI's `e2e` job runs the specs against an ephemeral Turso branch on the PR; the two live smokes are listed in the PR body for Nico.

## Not done, deliberately

- #138 slice 3 (front row / swap on `/d`) — still HELD per the plan.
- Cart line and the Stripe line item stay front-only (decision 2 scope).
- Admin order detail already receives `backImageUrl` from the mapper but does not render it — not in the plan's Task 4 list.
- The `/preview` lightbox still opens only on the hero side; #157 (image-page lightbox) is separate.

