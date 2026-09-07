# SDD ledger — plan: docs/superpowers/plans/2026-09-07-paper-admin-auth.md

Spec: `docs/ux-design-review-2026-09.md` (route verdicts for `/admin*` and Auth,
plus the Shared components audit). Read at preflight.

Branch: `feat/188-paper-admin-auth`. Worktree:
`/Users/nico/src/prntd/.claude/worktrees/paper-admin-auth`.

## Preflight conflict scan

Pairs that share a file or an interface:

| A | B | A produces / B consumes | Finding |
|---|---|---|---|
| T1 auth | T2/T3/T4 admin | nothing shared | clean — disjoint directories |
| T2 `/admin` | T3 `/admin/orders/[id]` | `data-testid="admin-action-result"` used by both pages' `InlineNotice`; both tests select on it | clean — separate files; T2's step list never removes the testid, T3's test asserts the detail page's own instance |
| T2 `/admin` | T3 detail | both add `setActionResult(null)` to a `handleAddTag` | clean — two different functions in two different files, identical shape by design |
| T2 `/admin` | T4 published/errors | none | clean |
| T3 detail | T4 published/errors | none | clean |

Self-consistency, per task:

| Task | Tests specified vs code specified | Files created vs later touched | Finding |
|---|---|---|---|
| T1 | test asserts `text-negative` on the sign-in error line; step 3 sets exactly that class. Placeholders "Email"/"Password" exist verbatim in the page today. Redirect cases pin behaviour that already exists (regression pins, expected to pass at step 2). | creates one test file, touches four pages; no later task touches them | clean |
| T2 | test selects `placeholder="+tag"`; step 8 explicitly preserves that placeholder. Test's second case ("empty tag leaves the line alone") depends on `setActionResult(null)` sitting **after** the guards — step 3 places it there. Retry button label is exactly `Retry` when idle; no filter button collides with that name. | creates one test file; step 6 deletes the only `Card` usage, so the import must drop or lint fails — called out in the step | clean |
| T3 | test mocks `next/navigation` for `useParams`/`useRouter`/`usePathname`; the page and `Breadcrumbs` are the only consumers. Retry label is `Retry Printful`, matched by regex. Duplicate-tag case depends on the guard-then-clear ordering, which step 3 sets. | creates one test file; no later task touches the detail page | clean |
| T4 | no test specified — two server components with no branching beyond an empty-list check; verification is the build plus greps | modifies two files no other task touches | clean, with the no-test rationale stated in the task |

Ruling (preflight, P1): the two new admin component tests hand-write order
fixtures. Those fixtures must satisfy the REAL return types of `getAdminData`
/ `getOrderDetail` and the pure helpers `applyFilters`/`applySort`/
`computeSummary` — the plan's literals are a starting shape, not a
contract. Implementers adapt the fixture to the real types (adding fields,
never weakening an assertion) and say so in their report. Cost if wrong: a
test that compiles against a fictional shape and stops catching regressions
when the real type moves.

Ruling (preflight, P2): the final-gate grep for unnamed border utilities is
advisory, not a gate — an `@apply`-free codebase can legitimately carry
`border` on an element whose colour comes from a sibling class. The binding
rule is the Global Constraint ("every border/divide utility must name a
colour") and the reviewer enforces it by reading the diff. Cost if wrong: an
unnamed rule ships and paints ink instead of hairline on one element.

## Tasks

Task 1: implementer DONE (commit 9da2e44). 4 new tests (3 regression pins for the
/studio default + same-origin ?next= guard, 1 real RED→GREEN on the text-negative
error token); full suite 1658 tests, lint 0, typecheck clean. Implementer concern:
the step-5 `red-600` grep is non-empty only because the test file asserts
`not.toContain("red-600")`. Review dispatched (sonnet), base 3d3c65e head 9da2e44.
Task 1: review clean — spec ✅, no Critical/Important. One ⚠️ (tests actually
green) resolved by the controller: `npx vitest run "src/app/(auth)"` → 4/4 pass.
Task 1: minor (deferred): the error-token test asserts on a class-name substring,
not a computed style — it pins `text-negative` by name only. Inherited from the
plan's own test content; surfaced to the final whole-branch review.
Task 1: complete (commits 3d3c65e..9da2e44, review clean)
Task 2: implementer DONE (commits 185b12d tag-notice fix, 33046fb Paper sweep).
16/16 admin tests, full suite 1660 pass, lint 0, typecheck clean. Implementer noted
an unrelated pre-existing flake in studio/library/library-grid.test.tsx that
self-resolved on rerun — watch for it in the final gate. Review dispatched (sonnet),
base 9da2e44 head 33046fb.
Task 2: review clean — spec ✅, no Critical/Important. Reviewer independently
grepped every border/divide utility in admin/page.tsx: all colour-named. It also
resolved the ⚠️ itself by reading actions.ts + admin-filters.ts — the fixture omits
quality/shipping*/designId, all of which the component only reads behind a guard or
never reads, so P1 holds.
Task 2: minor (deferred): the report's "fixture adaptations: none" under-describes
the analysis (reasoned about the pure helpers, not the component's own reads).
Task 2: minor (deferred): admin/page.tsx:449 keeps a bare `text-text-faint` on the
"+N more" size/colour marker — a valid AA token, just the one micro-label the
brief's step list did not enumerate.
Task 2: complete (commits 9da2e44..33046fb, review clean)
Task 3: implementer DONE (commits 46b38a5 tag-notice fix, 76a3d04 Paper sweep).
18/18 admin suites, full suite 1662 pass, lint 0, typecheck clean. Claims the
fixture was used verbatim after verifying every field the component AND Breadcrumbs
read. Library-grid flake did not reproduce. Review dispatched (sonnet), base
33046fb head 76a3d04.
Task 3: review clean — spec ✅, no Critical/Important. Reviewer independently
confirmed Breadcrumbs only calls useRouter (so the mock has no gap), grepped every
border/divide utility in the file (all colour-named), and verified the duplicate-tag
case really pins the guard-before-clear ordering.
Task 3: minor (deferred): the two `Printful:` lines (Product card vs References
block) reach the same styling by different routes — cosmetic asymmetry only.
Task 3: complete (commits 33046fb..76a3d04, review clean)
Task 4: implementer DONE (commit 01e02e8). lint 0 errors (21 pre-existing
warnings), typecheck clean, full suite 1662 pass, build green under the CI dummy
env, brief's grep empty. Implementer concern: the plan's final-gate border regex
flags `border-border`/`divide-border` as false positives.
Ruling (P2 restated, T4): the binding constraint is "every border/divide utility
names a colour", not the regex. `border-border`/`divide-border` ARE colour-named;
the plan's grep is advisory and its hits here are false positives. Reviewers verify
by reading the files. Cost if wrong: a genuinely bare utility hides behind the noise
— mitigated by asking each reviewer to grep the file itself, which T2 and T3 both did.
Review dispatched (sonnet), base 76a3d04 head 01e02e8.
Task 4: review clean — spec ✅, no Critical/Important. Reviewer confirmed against
globals.css:48+81-83 that `.bg-checkerboard` and `bg-surface-well` resolve to the
identical value (the swap is a pure rename), independently verified every
border/divide utility in the diff names a colour, and upheld the regex-false-positive
ruling. It also credited the opacity→"Hidden" marker as a real a11y improvement
(opacity was never announced; colour is now decorative, the word is the signal).
Task 4: minor (deferred): the report's "no test" rationale undercounts the branching
it touched (the new isHidden marker is a second fork, not just the empty-state check).
Conclusion unchanged — still needs the DB to exercise.
Task 4: complete (commits 76a3d04..01e02e8, review clean)
Final gate (controller-run on 01e02e8): lint 0 errors / 21 pre-existing warnings;
typecheck clean; 158 files / 1662 tests pass; production build green under the CI
dummy env from .github/workflows/ci.yml. First build attempt failed on a missing
STRIPE_SECRET_KEY — an env gap in the controller's own invocation, not a code
defect; re-run with CI's full env passed.
Whole-branch Opus review dispatched, merge-base b4ffe81 head 01e02e8, 7 commits.

## Whole-branch Opus review (b4ffe81..01e02e8)

Verdict: needs fixes — 0 Critical, 3 Important, 8 Minor. It upheld ruling P2 by
verifying border colours by hand rather than by regex, and triaged every deferred
minor as fine to carry.

Ruling F1 (Important 2, date dialects): ONE canonical form everywhere — the verbatim
mono label spec `font-mono text-[11px] leading-4 tracking-[0.08em] uppercase`. The
reviewer offered a two-form option (in-table vs standalone); rejected, because two
forms is what produced five. `uppercase` is a no-op on digits and only touches
AM/PM and month abbreviations, which is what "dates are mono caps" means. Cost if
wrong: in-table timestamps drop 12px→11px, a hair smaller in the densest column.

Ruling F2 (Important 3, tag chip affordance): render the chip as `{tag} ×` rather
than restoring a bordered pill. The glyph works on a phone where cursor/hover/title
do not, and a border on 12-column table chips reintroduces the pill noise the sweep
removed. Keyboard access on the `<span onClick>` is pre-existing and stays out of
scope. Cost if wrong: the × reads as part of the tag text to someone who has never
clicked one.

Ruling F3 (scope of the fix wave): Minors 1 and 8 ride along — both are stale text
the branch itself invalidated, the same class as Important 1, and each is one line.
Minors 2-7 are carried to the next Paper slice as the reviewer advised.
Fix wave: DONE (commit 082ffe6) — F-A, F-B, F-C, F-D, F-E. 22/22 covering tests,
lint 0, typecheck clean, full suite 1662. Build deliberately not re-run (the
controller had it green on 01e02e8 and the diff is class strings + comments +
two test assertions). No sixth timestamp site found; neither existing chip test
selected on chip text, and one assertion per admin test file was added to pin the
new affordance. Scoped re-review dispatched (sonnet), base 01e02e8 head 082ffe6.
Fix wave re-review: ALL FIVE ADDRESSED, no new breakage. The re-reviewer ran its own
sixth-timestamp-site check (grep for toLocale*/new Date across both trees, excluding
tests) and confirmed the five render sites are the whole set — the other six
`new Date()` calls are writes. It also confirmed the new chip assertions locate via
`title` but assert on `textContent`, so stripping the × glyph would fail them.
Branch complete: commits b4ffe81..082ffe6 (8 commits), all reviews clean.
