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

## Task log

(filled in as tasks complete)
