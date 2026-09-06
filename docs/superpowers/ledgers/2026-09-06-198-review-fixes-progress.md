# SDD ledger — plan: docs/superpowers/plans/2026-09-06-198-review-fixes.md

Branch: cloud/167-both-sides-preview (PR #198, rebased onto main, CI green).
Source: findings from the independent high-effort review of PR #198.

## Preflight conflict scan

| Pair / task | Produces vs consumes | Finding |
|---|---|---|
| T1 × T2a | Both touch `src/app/preview/page.tsx` — T1 the front auto-trigger effect (~555-580), T2a the two `<SideMockup>` call sites (~889, ~999) | Disjoint regions; tasks run sequentially so T2a builds on T1's commit. No conflict. |
| T1 × T2b | No shared file (`preview/page.tsx` vs `d/[imageId]/buy-hero.tsx`) | None. |
| T1 × T3 | No shared file | None. |
| T2 × T3 | No shared file | None. |
| T2a × T2b | Both touch `buy-hero.tsx`; batched into one task by design | None — one implementer owns the file. |
| T1 self | Specifies `preview/page.tsx` effect + `preview-sides.test.tsx` test | Agrees with itself. |
| T2 self | Adds prop in `side-mockup.tsx`, updates both callers, tests in side-mockup + buy-hero suites | Agrees with itself. |
| T3 self | Refactor in `user-orders.ts`, existing real-DB suites unmodified + one new pairing test | Agrees with itself. |
| Global constraint "back still waits on front" × T1 "remove the guard" | T1 removes the FRONT's dependence on the back only | Consistent, not a conflict. |

Ruling: Task 1 removes the front's wait outright rather than abandoning the back's in-flight fetch — a back mockup is a function of product/color/back-source, not of which front is picked, so a front change does not invalidate an in-flight back, and abandoning it would waste a paid Printful call. Two concurrent mockup tasks sit well inside Printful's ~30/min limit. Cost if wrong: two overlapping Printful tasks in a narrow window; the remedy would be to re-add sequencing that abandons the back rather than blocking the front.

## Execution

Task 1: implementer DONE (commit 95bbb12, 1539 tests pass, typecheck+lint clean). Task reviewer dispatched over abf2e47..95bbb12.
Task 1: process slip — the reviewer dispatch included "do not flag the absence of cancellation logic as a gap", which is pre-judging and the skill forbids it. The ruling itself was legitimate to state; suppressing a finding class was not. If the review returns clean, re-examine cancellation myself before marking complete.
Task 1: complete (commits abf2e47..95bbb12, review clean — spec ✅, quality approved). Controller re-checked the cancellation question the dispatch had improperly fenced off: the back's gate still requires `!mockupLoading.front`, so a concurrent front fetch cannot start a NEW back fetch; only an already in-flight one continues. No gap. The pre-judging slip did not suppress a real finding.
Task 2: implementer DONE (commit 706d1e6; prop `showSideLabel?: boolean` default true; 1543 tests pass; 4 mutation checks confirmed). Task reviewer dispatched over 95bbb12..706d1e6.
Task 2: complete (commits 95bbb12..706d1e6, review clean — spec ✅ both parts, quality approved).
Task 3: complete (commits 706d1e6..2402343, review clean — spec ✅, quality approved).
Task 3: minor (deferred): the new pairing test's zero-line order sits at offset 0, so it does not exercise offset accumulation across two NON-trivial orders (A with 2 lines then B with 3, asserting B's offset is 2). Reviewer flagged as optional strengthening, not a defect; the mutation check caught the bug class regardless.
Ruling: the final whole-branch review is scoped to this plan's fix wave (abf2e47..HEAD), not the full PR #198 branch. PR #198's own whole-branch high-effort review is what produced these three findings in the first place; re-reviewing it would re-derive that work at the most expensive tier. Cost if wrong: an interaction between a fix and untouched #198 code goes unseen — mitigated because each task reviewer read the surrounding repo code, not just its diff.
Final review (opus, scoped to abf2e47..2402343): 1 Important (stale "the two Printful fetches never run concurrently" comment above the back's auto-trigger — fix 1 deliberately relaxed exactly that invariant), 2 Minors both pre-existing and carry-able (buy-hero `hasBack` not gated on back support — unreachable today, all active blanks have a back; lost-update window on `design.mockupUrls` re-read-then-write — costs one wasted render, already reachable via prefetchProductMockups). Concurrency trace found no wedge, lost update, or refetch loop. Fix 3 arithmetic verified as an exact prefix sum. All four ledger rulings triaged as carry.
Fix wave: ONE fix dispatch for the Important finding (comments only). FIX_BASE 2402343.
Fix wave: re-review ADDRESSED, comments-only confirmed, both rewritten blocks accurate and consistent. Parked (out of scope, not load-bearing): neither comment names the actual overlap mechanism (a front repick mid-back-fetch); a future reader infers it from `invalidateMockups(["front"])`. Worth a line near `chooseSource` someday.
Gate on the merged branch: typecheck clean, lint 0 errors / 23 pre-existing warnings, 139 files / 1544 tests pass, production build OK.
