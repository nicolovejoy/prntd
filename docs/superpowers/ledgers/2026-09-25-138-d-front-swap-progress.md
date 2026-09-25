# SDD ledger — plan: docs/superpowers/plans/2026-09-25-138-d-front-swap.md
Worktree: .claude/worktrees/138-d-front-swap, branch claude/138-d-front-swap, base fe7f515 (origin/main). Source spec: docs/buy-flow-front-swap-plan.md §1, §2, §4, §6, §7 slice 3, §8 (Q1 swap only, Q6 after #135 slice 1), "#167 status".

## Process deviation (read first)
This controller had no Agent tool: the session exposed no way to spawn implementer, reviewer or whole-branch-review subagents. Every task was implemented AND reviewed by the controller itself, in separate passes (implement → re-read the diff against the acceptance criteria → mutation-check the new tests against the pre-change code). The independence the SDD process relies on — a fresh reviewer who did not write the code — was NOT achieved, including for the whole-branch pass. Recommendation to the main session: run one independent whole-branch review (`git diff origin/main...claude/138-d-front-swap` plus surrounding files) before opening the PR. Money-adjacent.

## Preflight
| Pair / task | Produces vs consumes | Finding |
|---|---|---|
| T1 ↔ T3 | T1 server contract (`frontImageId` on buyPublishedDesign, `front` on addToCart's frontImageId entry, swap-only) vs T3 client payloads | T3 must send the override only while swapped, and always with back = page image. Consistent. |
| T2 ↔ T3 | `getListingMockup({ frontImageId? })` vs BuyHero's fetch | T3 passes the key only when it differs, so the existing exact-call test still holds. |
| T1 self | page image stays on the shirt | order.designId / storeProductId / page URL all name the page image → enforce server-side, not just in UI. |

Ruling (preflight, swap-only enforced server-side): a front other than the page image is accepted only when the back IS the page image (`resolveBuyPageFront`). Without it a forged request could book `{front: B}` or `{front: B, back: C}` against listing A — a Shop sale recorded on a composition (storeProductId) the shirt does not carry, and A's design flipped to ordered. The guard alone (own or published) would not stop that. Cost if wrong: a future general front picker on this page relaxes one function.
Ruling: the rule is checked against the back that will actually be pinned (after the MULTI_PLACEMENT_ENABLED gate). Flag off → back dropped → override refused (throws), rather than printing the other image alone. Cost if wrong: none today — the UI offers no back, so no swap, with the flag off.
Ruling: cancel URL stays `/d/{pageImageId}` after a swap. The controller brief says the cancel URL "follows the pinned front"; on /preview that means carrying `?front=` so the buyer returns to the state they left. This page keeps no placement state in its URL (the back pick is not in the cancel URL either), and sending the buyer to `/d/{frontImageId}` would land them on a different listing — possibly their own private image. Judgment call; flagged in the summary. Cost if wrong: the buyer re-picks back + swap after cancelling Stripe (same as re-picking a back today).
Ruling (REVERSED in review fix round 1 — see below): no product-back-support check in the swap rule. Every active blank has a back placement and resolveOrderVariant rejects the one back-less (discontinued) blank. A future back-less active blank would drop ANY back at fulfillment — pre-existing, not swap-specific (the swap makes it worse: the page image would be the dropped side). Noted, not fixed.

## Task 1 — server swap-only override
Implemented: `resolveBuyPageFront` + `buyPagePlacements` (pure, `src/lib/placement-pins.ts`); `buyPublishedDesign({ frontImageId? })`; addToCart honours `front` on the frontImageId entry. Stripe thumbnail follows the front via `resolveImagesByIds`.
Tests: +8 unit (placement-pins), +9 real-DB `src/app/d/__tests__/buy-published-design-swap.integration.test.ts`, +9 real-DB `src/app/cart/__tests__/add-to-cart-swap.integration.test.ts`.
Mutation check: with the pre-change `d/actions.ts`, 7/9 buy-swap tests fail (the 2 that pass pin unchanged behaviour); with the pre-change `cart/actions.ts`, 7/9 cart-swap tests fail (same 2).
Self-review: first docblock sentence of buyPublishedDesign ("pinned … placements.front = imageId") was stale after the change → amended. Otherwise clean.
Finding (pre-existing, NOT fixed, out of slice scope): order-email hero images (`resolveHeroImages` → `resolveOrderEmailImages`) take the front from the design's display image and the source-less `…:front:{color}` mockup key, not from `placements.front`. For a swapped order the confirmation email's "Front" image is the seller's primary (usually the page image), not the swapped-in front. Already true for any non-primary front pin (/preview slice 2, and /d buys of a non-primary listing). Per-line identity rows in the same email, /orders, the confirm page and admin detail all read the pin and are correct. Recommend a follow-up issue. → FIXED in review fix round 1 (the independent review rated it Important; included in this PR).
Task 1: complete (commit 582056b).

## Task 2 — getListingMockup renders the swapped-in front
Implemented: optional `frontImageId`; when it differs from the page image → MULTI_PLACEMENT_ENABLED required ("Back designs are not enabled", same string as getListingBackMockup) then `assertUsablePlacementImage(…, viewerId ?? "", "front")`, rendered with `sourceImageId = frontImageId`. Absent/equal → byte-identical call (existing exact-call test unchanged).
Ruling: the mockup action does NOT enforce the swap-only shape rule — it has no back to check against, and rendering a preview books nothing. It is held to exactly getListingBackMockup's bar, so it adds no reach beyond the back tile's. Exposure note (same class Nico ruled on 2026-09-06 for the back: "note it, revisit at 10× the shop"): a caller-chosen front source adds products × colors × every published image to the FRONT key space on the seller's `design.mockup_urls`, doubling that bound. Auth is sound (`viewerId ?? ""` matches no owner).
Tests: +8 in get-listing-mockup.integration.test.ts, +1 in get-listing-back-mockup.integration.test.ts (the page image itself on the back, the swapped tile's call). Mutation check: 6/8 new front tests fail on the pre-change action (the 2 passes pin unchanged behaviour: equal-to-page, visibility gate first).
Self-review: clean.

## Task 3 — Front row + Swap in BuyPanel; the hero follows
Implemented: pure `buyPagePlacements({ page, added, swapped })`; BuyPanel `swapped` state, optional `imageUrl` prop, new `onFrontChange`, `onBackChange` now reports the EFFECTIVE back (the page image after a swap); section label "Back design" → "Front & back"; with a pick: Front row (thumb, no controls), Back row (thumb + Change + × only while not swapped), "⇅ Swap front and back" (glyph aria-hidden). Buy sends `frontImageId` and cart sends `front` only while swapped; back = effective back. BuyHero holds the reported front: front instant layer, front mockup source (`frontImageId` only when ≠ page) and alt text follow it; the back tile follows the effective back.
Ruling (judgment call, UI while swapped): Change and × are hidden while swapped; the buyer swaps back to change or remove the pick. Alternative considered: controls follow the pick onto the Front row. Rejected — "Change" on the Front row would be a front picker in all but name, which Nico declined (§8 Q1 "swap only"), and × there would leave the page image alone on the back. Cost if wrong: one extra tap to change/remove after a swap.
  → CORRECTED in review fix round 1: the × half of this reasoning was wrong. `setBack(null)` makes `buyPagePlacements` return `{front: page, back: null}` — the page image goes back to the FRONT with no back, not "alone on the back". Removing the pick while swapped is well-defined, so × now follows the pick to whichever row holds it. The Change half stands (a front picker).
Ruling: the Front row renders only once a back is picked (§6: "The Front row exists mainly so a swap is legible"). With no back, the hero already shows the page image on the front.
Ruling: Swap is hidden when the pick IS the page image (Shop can list it): exchanging an image with itself changes nothing.
Ruling: a new pick from the picker always lands on the back (resets `swapped`); the picker only ever fills the back.
Ruling: prominence (which side is large in the hero) is NOT reset by a swap — the images visibly trade places in either state, which is what makes the swap legible.
Tests: +10 BuyPanel (buy-panel.test.tsx), +3 BuyHero (buy-hero.test.tsx); one existing assertion updated for the renamed section label (Paper pass test, "Back design" → "Front & back"; the price-line "Back design" text is unchanged). Mutation check: with the pre-change buy-panel.tsx, 9/10 new panel tests fail (+ the relabel test); the one pass pins unchanged behaviour (no swap/Front row before a back). With the pre-change buy-hero.tsx, 3/3 new hero tests fail.
Self-review: clean.

## Task 4 — docs
`docs/buy-flow-front-swap-plan.md` Status (slice 3 built, rulings) + "#167 status" line; `docs/design-system.md` `/d` Stage + BuyPanel entries. Commit a50b791.

## Whole-branch pass (controller, NOT independent — see "Process deviation")
Scope: `git diff origin/main...HEAD` plus every reader of the values this branch changes (placements.front on /d orders, onBackChange semantics, getListingMockup's source) and every docblock that states the old invariant.
Checked and clean: fulfillment resolves each placement by its pinned id across designs (`order-fulfillment.ts`), so a swapped front from another design prints; deletion guards scan ALL placement values by LIKE (`delete-image.ts` orderReferencesImage, `delete-design.ts`), so a swapped-in front is order-protected; attribution (`contributorAttribution`, front-first) and per-line identity read the pins; cart thumbnail + Stripe line follow the pin; BuyPanel hooks all run before its collapsed early return; the only consumer of `onBackChange` is BuyHero; no e2e spec touches the image detail page.
Findings fixed:
1. Stale docblock `src/lib/design-publish.ts` (imageReferencedByOrders): "The buy-existing path always sets placements.front = imageId" — false after a swap. Reworded.
2. Stale/contradictory BuyHero docblock ("Owns the product/color/back selection"; state list without front/swap; "hero swap" now ambiguous next to the new Swap). Reworded.
3. `docs/d-buy-checkout-plan.md` (#135 slice 2, built next on this branch's base by wave-2 controller C): its /checkout review pane assumes the front is the page image. Added a note to read the sides from the order line and pass `frontImageId`.
Findings NOT fixed (recorded):
- Email hero (pre-existing, see Task 1) — follow-up issue recommended. → fixed in review fix round 1.
- `order.storeProductId` names the listing the sale came through, not the exact composition printed; after a swap the line is `{front: B, back: A}` while A's mirror product is `{front: A}`. Already true of any /d order with a back. Payout keys off `storeId` (NULL here) per the schema comment, so nothing reads it as the print spec.

## Gate (run by the controller, 2026-09-25)
- `npm run lint`: 0 errors (22 warnings, all pre-existing; `eslint` on the branch's changed .ts/.tsx files alone: clean).
- `npm run typecheck`: clean.
- `npx vitest run`: 175 files, 1860 tests, all passed (+48 on this branch).
- `npm run build` with the CI dummy env: exit 0.
- `npm run db:generate`: "No schema changes, nothing to migrate". No migration on this branch.
Not run here: e2e (CI's `e2e` job; no spec touches the image detail page) and any prod/preview smoke (unreachable from the cloud session).

## Independent review (main session, Opus) → fix round 1
Verdict: no Critical; acceptance criteria 1/2/3/6 pass. One Important, four Minor; all five fixed here. Implemented and self-reviewed by this controller (still no Agent tool); each fix's tests were mutation-checked against the pre-fix code.

1. IMPORTANT — email hero showed the page image on both sides after a swap (confirmation, owner alert, Printful shipping). `resolveHeroImages` now takes the front artwork from `placements.front` (`getDesignImageById`, display image only for a legacy unpinned line) and passes the design's `primaryImageId` (selected alongside `mockupUrls` by both callers: the email loader and the Printful webhook route). `resolveOrderEmailImages` tries `[product,"front",frontSourceId,color]` first — the shape `mockupCacheKey` writes for a sourced front (image detail page always; /preview for a pinned non-primary) — and uses the source-less key only when there is no front pin or the pin equals the primary. Also fixes unswapped buys of a non-primary listing, and a front whose design's primary changed after the order. Tests: +4 unit (email-images; existing BASE gained `primaryImageId: "img-front"`, the /preview shape the old cases describe), +1 real-DB loader case. Mutation: all 5 fail on the old code. Accepted consequence: a historical line whose front pin is neither the primary nor source-keyed now shows its own artwork on a backdrop instead of the primary's mockup photo — correct image over prettier wrong one.
2. Minor — Swap was silent to screen readers → `aria-pressed={swapped}`. Test asserts false/true/false.
3. Minor — × hidden while swapped: my ledger reason was wrong (corrected in the Task 3 ruling above). × now follows the pick; Change stays hidden while swapped. aria-label names the row: "Remove back design" / "Remove front design". Tests: × on the Front row while swapped, none on the Back row; removing while swapped reports front = page, back = null, buy sends neither override nor back, total drops to the one-sided price.
4. Minor — no server check for a back print area. `buyPublishedDesign` and `addToCart` (both entries — the check sits after the entry split) throw "This product has no back print area" when a back is set on a blank without one; an unknown product still falls through to resolveOrderVariant's refusal. Every active blank has a back, so the tests strip the Classic Tee's back placement inside a try/finally that restores the catalog singleton. Not added to `createCheckoutSession` (/preview): not in the review's list, and /preview already hides the back entry for a back-less blank (`productSupportsPlacement`); recorded as the one remaining path without the server check.
5. Minor (pre-existing) — `handleBuy`/`handleAddToCart` swallowed errors. New `CHECKOUT_FAILED` ("Couldn't start checkout. Nothing was charged. Try again.") and `ADD_TO_CART_FAILED` ("Couldn't add this to your cart. Try again.") in `action-copy.ts`, shown via `InlineNotice` under the CTAs (both signed-in and signed-out stacks), cleared on the next attempt. "Nothing was charged" holds: a throw means no Stripe URL came back, so the buyer never reached payment. Tests: 4.

Recorded, not fixed (per the main session):
(a) `getListingMockup({ frontImageId })` renders a buyer's own PRIVATE image and stores its mockup URL in the SELLER's `design.mockupUrls`, which /preview then sends to the seller's browser. The mockup is a public R2 object keyed by the buyer's image id. Filed under the existing ruling on anonymous mockup renders (Nico 2026-09-06: note it, revisit at 10× the Shop). The same is already true of a private back pick via `getListingBackMockup`.
(b) After a swap the order line's title (`order-line-identity`) is the front pick's listing title, or null when the pick is unpublished — consistent with that module's documented rule (name = published listing title of the pinned front, no fabricated labels). Note only.

## Gate after fix round 1 (run by the controller)
- `npm run lint`: 0 errors (22 pre-existing warnings; changed .ts/.tsx files alone: clean).
- `npm run typecheck`: clean.
- `npx vitest run`: 175 files, 1873 tests, all passed (+13 this round, +61 on the branch).
- `npm run build` with the CI dummy env: exit 0.
- `npm run db:generate`: "No schema changes, nothing to migrate". Still no migration.
