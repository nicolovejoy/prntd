# Paper Studio Bench (#188 slice 3) — progress ledger

Plan: `docs/superpowers/plans/2026-09-07-paper-studio-bench.md`
Branch: `feat/188-paper-studio-bench`

Every ruling made during this slice, with the reason. Written as the work
happens so the reasoning survives the worktree.

## Controller rulings made before any task ran

**R1 — `timeAgo` is the relative-time helper; no `relativeTime(ms, now)` was
added.** The dispatch asked for a new pure `relativeTime(ms, now)` in
`studio-view.ts`. `timeAgo(date, nowMs)` already exists there and already
returns the mock's exact four strings ("just now", "14m ago", "2h ago",
"1d ago"). A second helper computing the same scale is duplicate logic with
two drift surfaces and no caller for one of them. Ruled: keep `timeAgo`, and
pin the mock's four outputs as tests on it (Task 1). If any of the four had
NOT matched, the fix would have been to `timeAgo`, not the test.

**R2 — Generate stays `variant="generate"` (solid rose), against the mock's
drawing.** Both artboards draw the composer's Generate as an outlined ink
control. Nico's later "One Mark" decision (rose wordmark + solid rose
Generate) post-dates the artboards and is the standing rule; `Button`'s
`generate` variant exists for exactly this one control. Ruled: solid rose,
with the mock's mono-caps typography applied via `className`. Explicitly
called out in the dispatch as a ruling, recorded here so a later reader does
not "fix" it back to the artboard.

**R3 — the select-mode toolbar stays docked at the bottom; `main` pays for it
only while selecting.** The mock has no select-mode state. Two options were
live: move the toolbar into the composer's top slot (no fixed chrome at all)
or keep it bottom-docked. Kept bottom-docked: a multi-lane selection means
scrolling the bench and then reaching a Delete, and thumb reach on a phone is
the whole reason it was put there. The cost the move was meant to remove —
permanent `pb-40` on `main` for chrome that is usually absent — is removed by
making the padding conditional on `selectMode`. Its `data-testid`s and every
behavioural test are untouched.

**R4 — bulk Select enters from the per-lane ⋯ menu, and the page-level
"Select" control is deleted.** The dispatch says the overflow holds the
per-lane actions and that select mode "enters via the overflow". The old
control was a lone right-aligned text button in a header row the mock does
not have; keeping both a page-level and a per-lane entry would be two doors
to one mode. `data-testid="select-mode"` moves with it, so the existing tests
keep their subject.

**R5 — the empty bench drops "Browse the Shop".** The action was added when
`/` redirected signed-in users to `/studio`, making the bench the first thing
a buy-only account saw. #220 removed that redirect, so the premise is gone,
and the composer is now the first element on the page — offering shopping on
a making surface with the maker control right above it is the wrong offer.
The existing test asserting the Shop link is replaced (not weakened) by one
asserting composer + one line + no Shop link.

**R6 — `<h1>Studio</h1>` in `layout.tsx` stays, though neither artboard has
it.** The mock goes header → tab strip → composer. Removing the heading also
changes `/studio/library` and `/studio/archive`, which this slice has no mock
for, and the dispatch scoped the layout change to the extra top padding only.
Deferred to whichever Paper slice mocks those two views.

**R7 — `#N` is the cell's position in `lane.cells`, creation-ordered.**
`StudioCell` carries no generation number, and #151 already settled that
`#N` labels are creation-ordered on the `/design` strip. Same convention
here, so a later generation never renumbers an earlier one.

**R8 — `Cancel` inside the pending cell is a 28px target, below the 44px
rule.** It sits inside a 112px cell under two lines of text; a 44px control
does not fit, and nothing adjacent is tappable (the pending cell itself is
inert), so there is no mis-hit to protect against. Matches the mock, which
draws `min-height: 28px` there.

**R9 — the composer field is a bare underlined `<input>`, not the `Input`
primitive.** The primitive draws a bordered box; the panel already owns the
box, and the mock's field is a bottom hairline only. Primitives are off-limits
this slice (parallel slices), so wrapping or overriding `Input` was not an
option either. The bare input keeps `data-testid="studio-composer"` and stays
inside a `<form>` so Enter-to-submit and every existing
`fireEvent.submit(...closest("form"))` test keep working.

---

---

## Execution log

## Preflight conflict scan

Pairs sharing files or interfaces:

| A | B | A produces | B consumes | Finding |
|---|---|---|---|---|
| 1 | 2 | `timeAgo` pinned; layout `pt-6` | nothing from 1 | clean — disjoint files except none |
| 1 | 3 | `timeAgo` pinned | `timeAgo(lane.lastActiveAt, nowMs)` in the lane header | clean — Task 3 uses the helper Task 1 pinned; already imported |
| 2 | 3 | `Composer`; `onEnterSelectMode` pass-through added to `Lane`; page-level Select deleted | `Lane` renders `onEnterSelectMode` in the ⋯ menu | RESOLVED IN PLAN — Task 2 adds the prop as an unrendered pass-through so its own build is green; Task 3 wires it. Called out explicitly in both task texts. |
| 2 | 4 | empty state already `<EmptyState message="No open designs." />` | Task 4 asserts it | CONFLICT (owned): Task 2 changes the empty state but Task 4 owns its test. Task 2's step 6 tells the implementer to LEAVE the old Shop-link test failing and report it; Task 4 deletes it. Ruling below. |
| 3 | 4 | `Lane` header restructured | `Lane` cell strip restructured | clean — different JSX blocks in the same component; Task 3 stops at the header's closing `</div>`, Task 4 starts at `<div ref={scrollRef}>` |
| 2 | 3,4 | `main` loses `pb-40` except in select mode | — | clean |

Self-consistency, per task:

- Task 1: tests target `timeAgo`, which exists and is exported; the layout edit is one class string. Consistent.
- Task 2: the `Composer` code block references `Anchor`, `Image`, `Button`, `AT_CAP_COPY` — all already in scope in `studio-client.tsx`. The four new tests use `laneWithCells()`, which the task text tells the implementer to source from the existing fixtures rather than invent. Consistent.
- Task 3: `LaneMenu` uses `useState/useEffect/useRef`, all imported. The new tests reuse existing fixtures. `Lane`'s props gain `onEnterSelectMode` — added in Task 2, consumed here. Consistent.
- Task 4: the cell block references `formatElapsed`, `Image`, `unresolvedCellIds`, `sectionRef` — all in scope. Consistent.
- Global Constraints vs task text: no task edits `src/components/ui/*` or `globals.css`; no task changes frozen logic; no migration. Consistent.

Rubric conflicts (plan mandates something a reviewer would call a defect):

- Task 4's `Cancel` at `min-h-7` violates the plan's own 44px rule. The plan states the exception and its reason inline (R8). A reviewer flagging it should be answered with R8, not a fix.
- Task 4 deletes an existing test rather than re-pointing it. The plan states why (the test asserts the behaviour R5 deliberately reverses) and replaces it with a stronger one on the same surface. A reviewer flagging "weakened assertion" should be answered with R5 + the replacement test.

Ruling: Task 2 leaves the Shop-link empty-state test red; Task 4 removes it.
— The alternative is Task 2 owning a test for a decision Task 4 explains, which
splits one ruling across two reviews. Cost if wrong: one task review reports a
pre-known red test, which the controller confirms against this line.

## Task log

Preflight correction (found while reading the test file, before Task 2):
the plan's new test code names fixtures `laneWithCells()` / `laneWithPending()`,
which do not exist. The real helpers in
`src/app/studio/__tests__/studio-client.test.tsx` are `lane(overrides)`,
`cell(id, overrides)` and `pendingJob(id, ageMs)`. Every dispatch from Task 2
on carries the real signatures and the exact substitutions:
  laneWithCells()  -> lane({ cells: [cell("a"), cell("b", { isPrimary: true })] })
  laneWithPending() -> lane({ pending: [pendingJob("job-1")] })
Ruling: substitute rather than add the two named wrappers — the file already
has a fixture vocabulary and a third layer would be noise. Cost if wrong: a
test reads slightly longer at each call site.

Task 1 correction sent mid-flight: `src/lib/__tests__/studio-view.test.ts:36`
already has a `describe("timeAgo")` covering the same scale ("just now",
"5m ago", "3h ago", "2d ago"). The brief's four new cases would restate it.
Ruling: fold the mock's four labels into ONE test inside the existing block,
named for what it protects. — Verbatim-shaped duplication is a defect the
review rubric flags, and the protection is identical either way. Cost if
wrong: one test asserts five labels instead of four tests asserting one each.

Task 1: implemented (commit 4c8e8da), correction applied, 85/85 in the two
required suites. Task review dispatched (sonnet).
Task 1: complete (commits cbd457f..4c8e8da, review clean — spec OK, quality
approved; two Minors, both non-gating: a numeric inconsistency inside the
report narrative, and deliberate boundary overlap with the neighbouring scale
test. Reviewer independently confirmed the `py-8` on `<main>` that Task 2
removes, so the padding rationale holds.)

Correction queued for Task 3's dispatch: its test snippet writes
`const lane = laneWithCells();` — `lane` is the fixture FUNCTION's name in
`studio-client.test.tsx`, so that shadows it. Dispatch will say: build the
fixture in one call, `const l = lane({ cells: [...], lastActiveAt: new
Date(Date.now() - 14 * 60_000) })`, and never rebind `lane`.

Task 2: implemented (commit 5f04157), DONE_WITH_CONCERNS. 52 pass / 1 fail
(the pre-known Shop-link test, Task 4's), tsc clean.
Ruling: RATIFIED the implementer's deviation — it KEPT the page-level "Select"
button rather than deleting it as the brief's Step 4 said, because nothing
replaces it until Task 3's ⋯ menu and deleting it now would have broken nine
pre-existing select-mode tests with no replacement. — A task must leave the
suite green on its own; the brief drew that boundary wrong. Task 3's dispatch
carries the obligation to DELETE it once the menu item exists, or the bench
ships two doors to one mode. Cost if wrong: Task 3 forgets, and the final
whole-branch review catches a duplicate control.
Task 2 review: spec OK, quality NOT approved. Two Importants:
 (a) `main` carried `pb-8` AND a conditional `pb-40` — conflicting Tailwind
     utilities, winner decided by stylesheet order. Originated in the PLAN's
     own snippet (controller error), copied uninspected. Select-mode branch
     was also untested.
 (b) a comment in `submit()` the diff never touched still said a new lane is
     "the first thing above the composer" — backwards now the composer is at
     the top. The cross-task-drift class again.
Task 2: minor (deferred): `display: contents` on the composer form has a
 history of stripping form-landmark semantics in some browsers — sound today,
 worth a note only.
Task 2: minor (deferred): the interim page-level Select button has no 44px
 target class — pre-existing and moot once Task 3 deletes it.
Ruling: folded the third Minor (undocumented `text-[17px]` on the composer
input) INTO fix round 1 rather than deferring it. — It is a one-line comment
in code already being edited, and the 17px is doubly load-bearing (the mock's
value AND what stops iOS Safari zooming on focus); undocumented, the next copy
sweep reverts it to `text-sm` and reintroduces the zoom. Cost if wrong: one
extra comment line.
Task 2: fix round 1/5 dispatched (resumed the original implementer).
Task 2: fix round 1/5 (3 fixed — padding conflict + directional test, stale
submit() comment, 17px rationale; commits 5f04157..014f6c1). Scoped re-review
dispatched (haiku).
Task 2: complete (commits 4c8e8da..014f6c1, review clean — all 3 findings
ADDRESSED, no new breakage).

Task 3: implemented (commit 2d9ce68), DONE_WITH_CONCERNS. 58 pass / 1 fail
(the pre-known Shop-link test). tsc clean. Escape-listener question resolved:
LaneMenu never renders while selectMode is true, so the two document-level
Escape handlers are mutually exclusive by construction.
Ruling: ACCEPT the reachability consequence the implementer flagged — when a
user's ONLY lane is generating, no ⋯ trigger exists anywhere, so select mode
is unreachable until it finishes. — Select mode's only action is bulk delete,
and a generating lane cannot be selected in the first place; in that exact
state the mode has nothing to act on, so the lost door costs nothing. Cost if
wrong: a user with one generating lane briefly cannot enter a mode that would
show them zero selectable items.
Task 3: complete (commits 014f6c1..2d9ce68, review clean — spec OK, quality
approved). Reviewer independently verified: the two Escape listeners are
mutually exclusive by construction; outside-click means at most one LaneMenu
is open, so `select-mode` is never an ambiguous query; the one rewritten test
pins its invariant MORE directly than before (explicit `checked === false`).
Task 3: minor (deferred): LaneMenu does no focus management — focus does not
 enter the panel on open, nor return to the ⋯ trigger on close.
Task 3: minor (deferred): role="menu"/"menuitem" implies the WAI-ARIA menu
 widget (arrow-key nav, roving tabindex) but the items are plain Tab-order
 buttons. Keyboard-reachable, not conformant.

Task 4: implemented (commit e0af585), DONE. Full gate green: lint 0 errors
(21 pre-existing warnings), typecheck clean, 1668 tests / 155 files pass,
build OK.
Task 4 review: spec OK, quality Approved with one Important — anchored and
primary cells both render `border-2 border-foreground`, collapsing two states
that were previously distinct (ring vs border). From the PLAN's snippet, not
the implementer. Presentation-only (both sr-only markers survive) but real.
Ruling: the two states get different KINDS of signal, not two weights of one.
Anchored keeps the 2px ink border (loud, transient, means "Generate edits
this"); primary keeps the 1px border and gains a mono `Primary` marker in the
cell's bottom-left, mirroring the `#N` label. Both-at-once composes. — A
second border weight is a signal a viewer must measure against a neighbour to
read; a mono label is legible on its own, and mono labels are already the
Paper vocabulary's idiom for naming a state. Cost if wrong: one more glyph in
a 112px cell.
Ruling: folded the Minor test-binding fix into the same round — the test
`"numbers cells in creation order"` asserted `#1`/`#2` exist ANYWHERE rather
than binding each to its cell. — It is one `within(...)` call in the same file
and the same test family the fix must extend anyway. Cost if wrong: nil.
Task 4: fix round 1/5 dispatched (resumed the original implementer).
Task 4 fix round 1 landed (7379486): anchored = 2px border alone; primary =
visible bottom-left mono "Primary" marker; both compose. 63/63 in the studio
suite, tsc clean. Implementer flagged that my ruling's "keep both sr-only
spans" now makes a screen reader announce "Primary" TWICE (visible label +
sr-only span).
Ruling REVERSED on that point: drop the sr-only "Primary" span, keep the
sr-only "Editing" one. — The ruling was written when "Primary" had no visible
text and did not update when the marker appeared; the visible mono label is
real text in the a11y tree, so the span is now the exact duplication sr-only
exists to prevent. "Editing" stays because the anchored state is signalled
ONLY by a border, which carries no text. Cost if wrong: nil — this strictly
removes a duplicate announcement. My error, caught by the implementer.
Task 4: fix round 1/5 (3 findings ADDRESSED — anchored/primary separated, the
`within(...)` binding, the redundant sr-only span; commits e0af585..8e386fb).
Re-review found ONE new hole in the fix diff: the "Primary" assertions use
`getAllByText(...).some(not sr-only)`, which passes with 1 OR 2 nodes — so
reintroducing the sr-only span (the exact defect just fixed) would not be
caught. Round 2 dispatched to tighten to exactly-one, with a mutation check
required as evidence.
Task 4: fix round 2/5 (1 addressed — "Primary" assertions tightened to
getByText, which throws on >1; commit f3578ee). MUTATION-VERIFIED: re-adding
the sr-only span made exactly those 2 tests fail with
getMultipleElementsFoundError, reverting restored 63/63, and
`git diff --stat` on the production file was empty afterward.
Task 4: complete (commits 2d9ce68..f3578ee, review clean).

All four tasks complete. Dispatching the whole-branch Opus review.

WHOLE-BRANCH OPUS REVIEW: 4 Important + 4 Minor. Frozen-logic audit clean
(byte-identical across all 9 commits, only JSX position moved). All 9 rulings
judged sound, including both mid-flight reversals.
Ruling: fix I1, I2, I3, I4, M5, M6, M8 in ONE dispatch; DEFER M7.
 - I1 reveal-scroll: switch to `block:"nearest"` but KEEP `revealDesignId`
   rather than deleting the prop — deletion is a bigger change with no test
   coverage, and "nearest" already reduces it to a no-op when visible.
 - I3 touches `src/lib/funnel-routes.ts`, OUTSIDE this slice's scope fence.
   Taking it anyway: it is a comment-only correction of an invariant THIS
   branch falsified, trivially mergeable, and leaving a false "because the
   Bench has a docked composer" rationale in a shared lib is how the next
   reader reasons wrongly. The route LIST is not changed. Flagged in the PR
   body as an out-of-fence touch. Cost if wrong: a one-line comment conflict.
 - M7 (last lane's ⋯ opens below the fold) DEFERRED — the reviewer called it
   acceptable, and flip-up-when-low needs viewport measurement this slice has
   no way to test.

Fix-wave re-review: all 7 ADDRESSED, no new breakage. Effect audited: fires
exactly once per null->non-null transition (prevNoticeRef), deps are
[notice, selectMode] only, no-ops in select mode, touches no polling state.
The bulkDelete batching case was traced explicitly and is correct.
PARKED — Ruling: the finding-2 test does NOT exercise the new scroll effect.
`scrollIntoView` is globally stubbed in jsdom and the test asserts only that
the notice text lands inside the composer panel, which was already true before
the fix — so it would pass with the effect deleted. Parking rather than
opening a second fix wave: the effect's correctness was verified by reading
(guard, deps, select-mode no-op, batching path all traced), the gap is test
coverage on a presentational scroll, and the SDD loop allows one fix wave at
this stage. Cost if wrong: a future edit could silently delete the scroll and
no test would notice — the honest cover is
`vi.spyOn(HTMLElement.prototype, "scrollIntoView")`, named in the PR body.
