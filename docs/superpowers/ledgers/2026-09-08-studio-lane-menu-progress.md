# SDD ledger — plan: docs/superpowers/plans/2026-09-08-studio-lane-menu.md

## Pre-flight conflict scan

| Pair / task | Shared surface | Produces vs consumes | Finding |
| --- | --- | --- | --- |
| T1 × T2 | `LaneMenu` in `src/app/studio/studio-client.tsx` | T1 produces `open`/`triggerRef`/`panelRef`/`menuItems()`/`activeIndex`; T2 consumes `open`, `triggerRef`, `panelRef` and the panel className string | Consistent. T2's className edit rewrites the exact literal T1 leaves. One risk noted below (R-P1). |
| T1 × T2 | `src/app/studio/__tests__/studio-client.test.tsx` | T1 appends a describe block; T2 appends a second after it | No overlap. T2 also extends the `vitest` import line (`afterEach`) — T1 does not touch it. |
| T1 × T3 | none | — | Disjoint files. |
| T2 × T3 | none | — | Disjoint files. |
| T1 self-consistency | tests vs code | Tests assert `tabindex` attributes, focus targets, Escape restore, Tab/outside-click non-restore | Code implements each. `cloneElement` injects `tabIndex`, which React renders as the `tabindex` attribute. Escape is handled at document level (matching the pre-existing test that fires on `document`). OK. |
| T2 self-consistency | tests vs code | Stub keys on `role="menu"`; code measures trigger rect + panel rect vs `window.innerHeight` | Arithmetic checks: no-room case 760+132=892 > 800 → flip; room case 200+132=332 < 800 → no flip. OK. |
| T3 self-consistency | verification step vs edit | Step 1 asserts the diagnosis R6 rests on before Step 2 edits | OK; STOP condition stated. |
| Plan × review rubric | — | Any mandated test that asserts nothing / duplicated logic? | None found. Every new test has a real assertion; no logic block is duplicated verbatim. |

Ruling R-P1 (pre-flight): T1's open-focus `useLayoutEffect` and T2's
measurement `useLayoutEffect` both key on `[open]`, and T2's `setDropUp`
causes a second render while the menu is open. The focus effect must NOT
re-run on that render (deps are `[open, menuItems]`, both stable), so focus
is set once. Recorded so the T2 reviewer checks it rather than assuming. —
The alternative (merging the two effects) couples two unrelated concerns in
one hook. Cost if wrong: focus jumps back to item 1 after an arrow keypress
that coincides with a re-measure; T1's arrow tests would catch it.

## Task 1

Task 1: implemented (commit 06f3db4). 9 new tests; full studio-client.test.tsx
73/73; lint 0 errors; typecheck clean.
Ruling T1-1: ACCEPT the implementer's deviation from the brief's verbatim
component — `setActiveIndex(0)` moved out of the open `useLayoutEffect` and
into the trigger's `onClick`, because `react-hooks/set-state-in-effect`
(eslint-plugin-react-hooks 7.0.1 via eslint-config-next 16.2.1) is an ERROR
in this repo and the brief's own Step 4 demands 0 lint errors. — The toolchain
is authoritative over the plan's literal text (AGENTS.md), and the reset still
lands in the same commit as the focus effect, so behaviour is unchanged. Cost
if wrong: `activeIndex` could desync from the focused item if a future code
path opens the menu without going through that onClick — there is no such path
today, and the roving-tabindex test pins the invariant.
Ruling T1-2 (carried into Task 2): Task 2's `setDropUp` inside a layout effect
hits the SAME lint error. It gets a targeted
`// eslint-disable-next-line react-hooks/set-state-in-effect` with a
justification comment, NOT an imperative `classList` toggle. — Measure-then-
position genuinely requires a post-render DOM read, and React owns that
className: a classList mutation would be silently reverted on the next poll
tick, which re-renders StudioClient every few seconds. The repo already
disables react-hooks rules by line where warranted (7 `exhaustive-deps`
sites). Cost if wrong: one extra pre-paint render per menu open.
Task 1 review: spec ✅; quality Approved-with-findings — 1 Important
(setActiveIndex called inside the setOpen updater violates React's
updater-purity contract; concrete fix supplied), 1 Minor (the original
LaneMenu docblock is left stranded above `const MENUITEM_SELECTOR`, stacked
under a second docblock — caused by the plan's literal replacement text).
Ruling T1-3: fix BOTH in one round rather than deferring the Minor. — The
stranded docblock is my plan's defect, not the implementer's, it now
documents the wrong declaration, and it is one edit in the same function the
Important fix touches. Cost if wrong: nil.
Task 1: fix round 1/5 (2 addressed, 0 open; commits 06f3db4..56de2c2).
Task 1: complete (commits dd534e7..56de2c2, review clean).

## Task 2

Task 2: implemented (commit 9b84224). 3 new tests, whole file 76/76; lint 0
errors; typecheck clean.
Ruling T2-1: ACCEPT the implementer's narrowing of ruling T1-2 — only the
`!open` reset trips `react-hooks/set-state-in-effect`, so only that line
carries the by-line disable; a second disable produced an unused-directive
warning. — Empirically verified twice (implementer and reviewer both ran
eslint on the file). Cost if wrong: a future rule version flags the
measurement branch and CI goes red on a one-line fix.
Ruling T2-2: ACCEPT keeping the `!open` reset INSIDE the effect rather than
folding it into the trigger's onClick. — The panel also closes via Escape,
outside click, item click and Tab, none of which pass through the trigger's
onClick, so folding it there would leave `dropUp` stale on every non-toggle
close path. Cost if wrong: nil; this is the safer placement.
Task 2 review: spec ✅; quality Approved, no Critical/Important.
Task 2: minor (deferred): the eslint-disable's inline "why" at
studio-client.tsx:849 justifies the whole effect rather than the `!open`
reset it is attached to — comment precision only.
Task 2: complete (commits 56de2c2..9b84224, review clean).

## Task 3

Task 3: implemented (commit b5d8fdb). Diagnosis confirmed by implementer and
independently by the reviewer. lint 0 errors, typecheck clean, 103 studio
tests pass.
Task 3 review: spec ✅; quality Approved-with-findings — no Critical or
Important. Reviewer independently confirmed the Fragment wrapper is necessary
(a JSX comment cannot precede a sole root element without one) and mirrors
`studio-client.tsx`'s existing `<>{confirmSheet}<main>…` shape.
Task 3: minor (deferred): `src/app/studio/archive/page.tsx:31-86` was not
reindented when its `<main>` gained a Fragment parent — it sits one level
shallow. Cosmetic; library/page.tsx's equivalent block was reindented
correctly. Handed to the whole-branch review to triage.
Task 3: complete (commits 9b84224..b5d8fdb, review clean).

## Whole-branch final review (opus)

Verdict: merge after fixing finding 1. Five findings: 2 Important, 3 Minor.
Ruling F-1: take ALL FIVE in one fix wave, including the three Minors. — #1
(focus() scrolls the page to the un-flipped position before the flip is
measured) is the composition-only defect the per-task reviews structurally
could not see and it undercuts Task 2's entire purpose; #2 is latent but the
fix is three tokens; #3 DELETES the eslint-disable rather than deferring its
wrong justification a second time, which is strictly less code; #4 and #5 are
both in files the remaining Paper slices will open, and carrying cosmetic
debt into a shared file is how the next reader reasons wrongly. Cost if
wrong: one extra fix round on a branch whose gate is already green.
Final fix wave: commit 6106c38, all five findings ADDRESSED (scoped
re-review clean, no new breakage; whitespace-only reindent confirmed, the
tabIndex counter confirmed to reset once per render and increment only on
valid elements). Both ledger deferred minors are now FIXED, not carried:
finding 3 deleted the eslint-disable whose justification described the wrong
branch, finding 4 fixed the archive indentation.
Full gate on the branch: lint 0 errors (21 pre-existing warnings), typecheck
clean, 1744 tests / 168 files pass (main was 1732), production build OK under
the CI dummy env.
