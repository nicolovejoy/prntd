# #245 lost Generate response — SDD ledger

Plan: `docs/superpowers/plans/2026-09-26-245-lost-generate-response.md`.
Branch `claude/245-lost-generate-response` from `origin/main` `9901586`.
Controller: Opus. Implementers and task reviewers: `claude -p --model sonnet`;
scoped re-reviews: `haiku`; whole-branch review: `opus`.

## Controller rulings (before any code)

1. **Evidence of "landed" is a job or a cell, not the lane.** For an unanchored
   submit the server writes the design row after quota and capacity pass but
   before the job row, so a throw in between (brief call failing) leaves an
   empty lane. That is a real failure and reads as one.
2. **Baseline at submit time.** An anchored submit's lane already has jobs and
   cells; only ids absent from a snapshot of the tab's server lanes taken when
   the submit fired count. An unanchored id is fresh, so its baseline is empty.
3. **The reconcile read is a direct `getStudioLanes()`, not `pollOnce()`.**
   `pollOnce` returns early while a poll is in flight, and that poll may have
   started before the job row was written.
4. **One retry.** If the reconcile read itself throws (the network is still
   switching, the prod case), wait 1 s and read once more; if that throws too,
   fall back to today's failure behaviour. Costs up to ~1 s of extra wait only
   when the read fails; a #204 closed-lane throw is decided on the first read.
5. **The cell stays on screen during the reconcile** (phone-first, no layout
   shift). It leaves on both paths once decided; on the landed path the
   server's own cell takes the same spot.
6. **Server-side idempotency stays out of scope** (the issue says so).

## Task 1 — `laneBaseline` / `submitLanded` (commit `a461b63`)

- Implementer (sonnet): helpers + 10 tests, test-first (10 failed before
  implementation, all passed after).
- Task review (sonnet): CHANGES REQUESTED.
  - Important: any cell not in the baseline counted as "landed", but a job
    already pending at submit time (or held by another optimistic entry) can
    finish during the reconcile window and produce a cell unrelated to this
    submit → false "landed" → the user's words silently vanish.
  - Minor: temporary spread array for the known-job set; no test isolating
    the cell exclusion.
- Ruling on the Important: count instead of test for presence. Landed = a new
  pending job, or more new cells than departed jobs (baseline ∪ claimed ids no
  longer pending). A departed job that failed or was cancelled leaves no cell,
  so this can under-count and report failure for a submit that did land. That
  is the chosen direction: when ambiguous, give the words back (today's
  behaviour, at worst a duplicate) rather than swallow them. `claimedJobIds`
  must be same-design ids (documented contract; the caller filters).
- Fix round (sonnet): counting rule, set built without a spread, four more
  tests (departed + one new cell → false; departed + two → true; claimed
  departed + one → false; baseline cell only → false). 47 tests pass.
- Re-review (haiku): RESOLVED.

## Task 2 — reconcile in the submit catch

(in progress)
