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
Ruling: no product-back-support check in the swap rule. Every active blank has a back placement and resolveOrderVariant rejects the one back-less (discontinued) blank. A future back-less active blank would drop ANY back at fulfillment — pre-existing, not swap-specific (the swap makes it worse: the page image would be the dropped side). Noted, not fixed.

## Task 1 — server swap-only override
Implemented: `resolveBuyPageFront` + `buyPagePlacements` (pure, `src/lib/placement-pins.ts`); `buyPublishedDesign({ frontImageId? })`; addToCart honours `front` on the frontImageId entry. Stripe thumbnail follows the front via `resolveImagesByIds`.
Tests: +7 unit (placement-pins), +9 real-DB `src/app/d/__tests__/buy-published-design-swap.integration.test.ts`, +9 real-DB `src/app/cart/__tests__/add-to-cart-swap.integration.test.ts`.
Mutation check: with the pre-change `d/actions.ts`, 7/9 buy-swap tests fail (the 2 that pass pin unchanged behaviour); with the pre-change `cart/actions.ts`, 7/9 cart-swap tests fail (same 2).
Self-review: first docblock sentence of buyPublishedDesign ("pinned … placements.front = imageId") was stale after the change → amended. Otherwise clean.
Finding (pre-existing, NOT fixed, out of slice scope): order-email hero images (`resolveHeroImages` → `resolveOrderEmailImages`) take the front from the design's display image and the source-less `…:front:{color}` mockup key, not from `placements.front`. For a swapped order the confirmation email's "Front" image is the seller's primary (usually the page image), not the swapped-in front. Already true for any non-primary front pin (/preview slice 2, and /d buys of a non-primary listing). Per-line identity rows in the same email, /orders, the confirm page and admin detail all read the pin and are correct. Recommend a follow-up issue.
Task 1: complete (commit 582056b).

## Task 2 — getListingMockup renders the swapped-in front
Implemented: optional `frontImageId`; when it differs from the page image → MULTI_PLACEMENT_ENABLED required ("Back designs are not enabled", same string as getListingBackMockup) then `assertUsablePlacementImage(…, viewerId ?? "", "front")`, rendered with `sourceImageId = frontImageId`. Absent/equal → byte-identical call (existing exact-call test unchanged).
Ruling: the mockup action does NOT enforce the swap-only shape rule — it has no back to check against, and rendering a preview books nothing. It is held to exactly getListingBackMockup's bar, so it adds no reach beyond the back tile's. Exposure note (same class Nico ruled on 2026-09-06 for the back: "note it, revisit at 10× the shop"): a caller-chosen front source adds products × colors × every published image to the FRONT key space on the seller's `design.mockup_urls`, doubling that bound. Auth is sound (`viewerId ?? ""` matches no owner).
Tests: +8 in get-listing-mockup.integration.test.ts, +1 in get-listing-back-mockup.integration.test.ts (the page image itself on the back, the swapped tile's call). Mutation check: 6/8 new front tests fail on the pre-change action (the 2 passes pin unchanged behaviour: equal-to-page, visibility gate first).
Self-review: clean.
