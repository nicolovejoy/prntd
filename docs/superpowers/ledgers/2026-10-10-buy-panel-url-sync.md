# SDD ledger — plan: docs/superpowers/plans/2026-10-10-buy-panel-url-sync.md

Branch `claude/buy-panel-url-sync`, worktree `.claude/worktrees/buy-panel-url-sync`.
BASE 2011804 (plan commit on origin/main 8bf8160). Session 1005, 2026-10-10.
Spec: none separate. The goal is the known limit recorded in `buy-panel.tsx` and CLAUDE.md (one buy surface, slice 2).

## Preflight scan

| Tasks | What is shared | Finding |
|---|---|---|
| 1 × 2 | Task 1's findings gate Task 2 (stop rule) | Sequential by design. Clean. |
| 2 × 3 | Task 3 tests the behaviour Task 2 enables | Clean. |
| Task 1 alone | investigation, report only | Clean. |
| Task 2 alone | two call sites, two comments, unit tests | The Next behaviour the plan cites was read by the controller in `node_modules/next/dist/client/components/` (app-router.js 252-279, app-router-instance.js 147-161, server-action-reducer.js 217-263); implementer re-verifies. |
| Task 3 alone | Playwright check that cannot run in the worktree | CI's e2e job on the PR is the first real run. |

## Rulings

- Ruling: one Sonnet implementer for the whole slice, no per-task reviewer; the main session re-runs the gate and dispatches one Opus whole-branch review — the repo's convention for small slices (CLAUDE.md batch lesson, 2026-10-01) — if wrong, a task-level defect is found one step later.
- Ruling: Task 1 carries a stop rule; if it trips, the slice ships no behaviour change — if wrong, the known limit stays as it is today.
- Ruling: no local Playwright run (the worktree has no env and the secrets rule forbids copying one); CI's e2e job is the check — if wrong, one fix round after the PR's first CI run.

## Progress
- Implementer (Sonnet) DONE_WITH_CONCERNS: commits fb8efbd, a200056 (2011804..a200056). Stop rule did not trip. Report: report.md (written by the controller from the hand-back).
- Controller gate on a200056: lint 0 errors, typecheck clean, vitest 250 files / 3840 tests.
- Ruling: the e2e check is a new test on a published image with a new helper publishSeededImage (implementer's departure; rename is not offered on an unpublished image) — if wrong, one test and one helper to rework.
- Open, for the review: a history write now discards a pending router navigation or refresh (implementer concern 1).
- Whole-branch review (Opus) dispatched on 2011804..a200056.
- Whole-branch review (Opus) on 2011804..a200056: READY AFTER FIXES. The diff is correct and inside the plan; it switches on two behaviours the plan's stop rule did not ask about. The reviewer reproduced both in a stand-in Next app (same node_modules, production build, Chromium at phone width), not in PRNTD.
  - Important 1 (`buy-panel.tsx:333`): after a pick, the next server re-render of the page scrolls the window to the top. The restore keeps the tree's page key at the query the server last rendered (restore-reducer.js:25-32), so the next render counts as a search-param change, which Next scrolls for (ppr-navigations.js:158-162, :178-181, :322-334; server-action-reducer.js:294; layout-router.js:153-225). Probe: scrollY 823 -> 0 after a revalidating action, after pick + router.refresh(), after a cookie-setting action, and after a revalidating action discarded by a pick. With the old call the scroll does not move. Bites an owner who taps "Use this one" or saves a title, and any signed-in buyer when the 5-minute session cookie cache (`src/lib/auth.ts:49-52`) is re-set inside a server action such as a mockup render on a colour tap.
  - Important 2 (`buy-panel.tsx:320-334`): on a hard load the effect's first run comes before Next has patched history (the patch is installed in Router's own effect, app-router.js:233-279; a parent's effect runs after its children's). `null` then wipes Next's entry state with the browser's own replaceState and the router is not told. Later, a Link away and browser Back changes the URL but leaves the other page on screen (popstate returns on a null state, app-router.js:284-288). Fix offered: gate the effect on `useHydrated()`.
  - Minor 3: the new comments state the router follows with no condition. Minor 4: a pick now discards the in-flight action, so mockup renders for rapid colour taps run side by side. Minor 5: a pick tapped between a Link / router.push and its commit cancels that navigation. Minor 6: stale prose in CLAUDE.md:184,193; `src/app/design/design-client.tsx:393-394,403` has Important 2's hazard on a hard load (older than this branch). Minor 7: no test for a hard load with picks or for scroll position.
  - Also found on the OLD code (main today): a revalidation after a pick resets the URL and pushes a duplicate history entry (app-router.js:59-64; probe: history.length 5, 6, 7).
- Ruling: the behaviour change is not shipped. The branch reverts fb8efbd and a200056 and instead records in the sync effect's comment why the panel keeps passing `window.history.state` — the limit being fixed is an address bar that loses the picks after a refresh; the change would trade it for a jump to the top of the page mid colour-picking on a phone, on the buy surface, and the offered repair (undoing Next's scroll in a layout effect) is a workaround against the framework — if wrong, the known limit and the duplicate history entry stay until someone takes the two fixes the review names (the `useHydrated()` gate and the scroll guard, with an e2e that scrolls first); the reverted commits stay in the branch history as the starting point.
- Final fix wave dispatched (resume implementer): revert both commits, rewrite the comment.
- Fix wave: 4418991 (reverts fb8efbd and a200056; tree identical to 2011804) and 10c0fd8 (the comment). Controller confirmed the branch differs from 2011804 by comment lines in one file; lint 0 errors, typecheck clean, the image detail page's tests 186 passed.
- The implementer checked each sentence of the comment against the Next source and narrowed two of the reviewer's claims: a plain router.refresh() uses ScrollBehavior.NoScroll and a replace, so the source confirms the scroll jump and the duplicate history entry for server-action re-renders only (the reviewer's probe reported both after a refresh too; not confirmed in the source). The comment claims only what the source confirms.
- Scoped re-review (Haiku) of the fix wave: ADDRESSED; every sentence of the comment TRUE against the source (app-router.js, restore-reducer.js, ppr-navigations.js, layout-router.js, server-action-reducer.js, refresh-reducer.js). No non-comment line changed.
- Slice complete (commits 2011804..10c0fd8, one fix wave, no behaviour change shipped).
