# SDD ledger — plan: docs/superpowers/plans/2026-09-08-error-boundary-empty-title.md

## Pre-flight conflict scan

Shared files / interfaces between tasks:

| Pair | Produces | Consumes | Finding |
| --- | --- | --- | --- |
| T2 → T3 | `updatePublishedNaming(): Promise<{error?:string}>`, `EMPTY_TITLE_REJECTED` | T3 reads `result?.error`, imports `SAVE_TITLE_FAILED` (not `EMPTY_TITLE_REJECTED`) | Clean. T3's plan text says "import only SAVE_TITLE_FAILED", matching the component body it gives — the earlier sentence naming both is corrected inline by the parenthetical. Ruling recorded below. |
| T2 ∩ T3 | both edit `src/lib/action-copy.ts` | T2 adds `EMPTY_TITLE_REJECTED`, T3 adds `SAVE_TITLE_FAILED` | Sequential, ADD-only, different lines. No conflict. |
| T1 ∩ T2/T3 | none | none | Fully disjoint files. |

Self-consistency, per task:

| Task | Check | Finding |
| --- | --- | --- |
| T1 | tests import `../error` + `../global-error`; both files created in the same task | Consistent. Test asserts `screen.getByRole("button", {name:"Try again"})` for both — `global-error` uses a raw `<button>`, `error.tsx` a `Button` primitive that renders `<button>`. Both match. |
| T1 | test "falls back to reset" renders `<ErrorBoundary error reset>` with no `unstable_retry` — component types both props optional | Consistent. |
| T1 | guard tests (globals-css, no-preselection-price, no-window-alert) run in step 6 against the new files | Consistent — no dark literal, no price, no alert in the given code. |
| T2 | test asserts `{}` on success; plan's step 4 adds `return {};` at the end | Consistent. |
| T2 | test asserts refusal writes nothing; guard is placed before any DB write | Consistent. |
| T3 | test mocks the action to return `{error}`; component reads `result?.error` | Consistent. |
| T3 | test "closes the editor on a successful save" expects heading "Real Title" after typing "!" then saving — the component calls `router.refresh()` (mocked no-op), so the read view re-renders from the unchanged `title` prop | Consistent, and deliberately so: the prop is the server's value, not the draft. |

## Pre-flight rulings

Ruling: T3 imports only `SAVE_TITLE_FAILED` from action-copy, not `EMPTY_TITLE_REJECTED` — the refusal string arrives from the server as data, so importing it into the client would be an unused import and a lint error. The plan states both forms; the parenthetical is binding. Cost if wrong: a lint error caught in the gate.

## Execution

Task 1: dispatched (sonnet), BASE c00d5c7
Task 1: implementer DONE_WITH_CONCERNS (commit f90f728). Ruling: `@testing-library/user-event` is NOT a dependency of this repo — my plan text specified it verbatim, which is a plan defect. The implementer substituted `fireEvent` (the established pattern, e.g. chat-panel.test.tsx), assertions and copy unchanged. Ratified: installing a new dev dependency for one slice is out of scope and would touch package.json/lock, outside the fence. Cost if wrong: `fireEvent.click` skips user-event's pointer-event sequence, so a click blocked by pointer-events/CSS would not be caught — irrelevant for these two boundaries. **Carried into Task 3's dispatch, whose brief uses userEvent too.**
Task 1: jsdom rendered GlobalError's <html>/<body> with a plain render(); the brief's detached-container fallback was not needed.
Task 1: review dispatched (sonnet)
Task 2: dispatched (sonnet), BASE f90f728
Task 1: review clean — spec ✅, quality Approved, 0 Critical, 0 Important.
Task 1: minor (deferred): the "logs once on mount" test asserts toHaveBeenCalledWith but not toHaveBeenCalledTimes(1), so the name overclaims.
Task 1: minor (deferred): digest styling uses arbitrary `text-[11px]` rather than a scale value (plan-mandated, matches MONO_LABEL's own size).
Task 1: ⚠️ resolved by controller — reviewer could not verify `--text-faint`'s contrast from this diff. Checked src/app/globals.css directly: token unchanged from PR #213's 4.74:1 value, which passes AA (4.5:1) for small text. Not a gap.
Task 1: complete (commits c00d5c7..f90f728, review clean)
Task 2: implementer DONE (commit ff9b059). 5/5 new integration tests; out-of-fence model-b-writer-cutover (14) + composition-mirror (19) pass UNEDITED, proving the widened return type breaks no caller.
Task 2: review dispatched (sonnet)
Task 3: dispatched (sonnet), BASE ff9b059. Carried the Task-1 fireEvent ruling into the dispatch, plus the binding read of the brief's contradictory import sentence (component imports SAVE_TITLE_FAILED only) and the provisional status of the metadata test.
Task 2: review clean — spec ✅, quality Approved, 0 Critical, 0 Important.
Task 2: minor (deferred): the guard is blank/whitespace only and does not clamp to the editor input's maxLength={80}; no length validation was requested.
Task 2: ⚠️ resolved by controller — the reviewer could not verify that Task 3 consumes the new `error` field. That IS Task 3, dispatched before this review returned; its own review verifies it. Not a gap.
Task 2: complete (commits f90f728..ff9b059, review clean)
Task 3: implementer DONE (commit 5b87055). Kept the generateMetadata test rather than extracting a helper, mocking page.tsx's 12 direct imports per the confirm-page.test.tsx precedent.
Task 3: review dispatched (sonnet)
Task 3: review clean — spec ✅, quality Approved, 0 Critical, 0 Important. Reviewer independently verified all four `??` sites fixed and that the mocked-import metadata test exercises the real generateMetadata closure (mock list matches page.tsx's import block 1:1).
Task 3: minor (deferred): the pre-existing `environmentMatchGlobs` deprecation warning shows in test output; predates this branch, out of fence.
Task 3: complete (commits ff9b059..5b87055, review clean)

## Controller gate on the combined tree (before the final review)
lint 0 errors / 21 pre-existing warnings; typecheck clean; 171 files / 1752 tests pass (main was 1732); `npm run build` green under the CI dummy env; working tree clean.

Final whole-branch review: dispatched (opus), MERGE_BASE a653f67

## Final whole-branch review (opus) — 0 Critical, 2 Important, 9 Minor. Verdict: mergeable with fixes.

Ruling: ONE fix wave covering Important 1+2, promoted Minor 3, the Task-1 deferred minor, and Minors 5,6,7,8,10,11. Minor 4 (out-of-fence `??` sites) and Minor 9 (hoisting the error copy into action-copy.ts) are excluded and go to the PR body. Findings file: final-findings.md. Cost if wrong: the excluded two are cosmetic/organisational and reversible in any later sweep.

The two Importants, both invisible to a task-scoped review:
- F1: `global-error.tsx`'s docblock claims the body "falls back to the stack globals.css declares". It does not — `globals.css:65` is `font-family: var(--font-geist-sans), Arial, ...` and `--font-geist-sans` is defined only on the ROOT LAYOUT's `<html>`, which by construction did not render. An undefined `var()` with no inline fallback invalidates the WHOLE declaration at computed-value time, so the Arial tail is never reached and the crash screen — including the digest, whose entire purpose (R5) is to be transcribed against /admin/errors — renders in the browser default serif. A CSS-cascade fact spanning three files, only one of which the diff touched.
- F2: `if (blank) return;` in `handleSave` is untested and the test named for it is vacuous — it clicks a DISABLED button, and jsdom dispatches no activation behaviour on one. The reviewer proved it by mutation: deleting the guard leaves 6/6 green. The fix dispatch requires mutation evidence.

Ruling: R7 was WRONG about a file inside its own fence — `identity-block.tsx:70` renders `{link.title ?? "an earlier design"}` for each fork-chain entry, so an empty-string title yields an empty clickable anchor. Promoted from Minor into the fix wave (in-fence, one character). Cost if wrong: none; it is the same bug class the branch exists to fix.
Ruling: R6's step-4 note "a blank save costs zero queries" is off by one SELECT — the guard sits after the image lookup, which is the CORRECT placement (an earlier one would leak image existence to a non-owner). The code is right and the claim is wrong; recorded, not fixed. Cost if wrong: a stale sentence in a plan doc.
Ruling: R3's stated font-fallback mechanism is wrong (see F1). The decision to ship global-error.tsx stands; only its rationale needed correcting. Cost if wrong: none — the fix makes the screen legible either way.
Final review confirmed R4's premise holds (instrumentation.ts's onRequestError does fire for the errors these boundaries catch, so a client-side write would double-count) and that `publishImage`, the other blank-title writer, was already safe.
Final review also confirmed prod-smoke.yml greps for testid markers in the body, not just a 200 — so an error boundary converting a 500 into a rendered page still trips the smoke. Not considered anywhere in the plan.

Deferred-minor triage by the final reviewer: Task-1 "logs once" assertion → FIX (in the wave). Task-1 arbitrary text-[11px] → stands (matches MONO_LABEL). Task-2 no maxLength clamp → stands (never requested). Task-3 environmentMatchGlobs warning → stands (pre-existing, out of fence).

Fix wave: dispatched (sonnet), FIX_BASE 5b87055
Fix wave: complete (commit 4fd2cd4). Scoped re-review: ALL TEN findings ADDRESSED, no new breakage, nothing on the do-not-touch list moved.
Ruling: Important 2's fallback ACCEPTED. The implementer's mutation check showed the guard survives deletion with 7/7 green, i.e. `if (blank) return;` is structurally unreachable from any DOM click — `Button` spreads `disabled` onto a real native <button> (no click event fires at all, not a jsdom quirk) and the component has no <form> and no Enter/keydown handler, so `handleSave` has exactly one caller and no alternate activation route. The re-reviewer verified this independently rather than taking the claim. So the test was renamed to what it truly pins ("keeps Save disabled so the action is never reached with a blank title") and the guard carries a comment saying it is untested defence-in-depth. Cost if wrong: the guard could be deleted by a future refactor and CI would stay green — mitigated by the comment sitting on the line itself.
Ruling: Minor 8 (heading + live region on both boundaries) was pulled into the wave rather than deferred. An error screen with zero headings strands a screen-reader user navigating by heading on the one page where orientation matters most, and the repo already ships role="alert" aria-live for exactly this. The copy string is byte-identical; only the element changed. Cost if wrong: an <h1> on a crash screen, which is what Next's own doc example does.
Final gate on the fixed tree: lint 0 errors / 21 pre-existing warnings; typecheck clean; 171 files / 1754 tests; build green under the CI dummy env.
