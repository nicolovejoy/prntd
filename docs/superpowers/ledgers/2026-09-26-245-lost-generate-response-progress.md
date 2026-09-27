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

## Task 2 — reconcile in the submit catch (commit `810aad3`)

- Implementer (sonnet): `applyFreshLanes` shared by poll and reconcile, direct
  `getStudioLanes()` read with one retry after 1 s, decision via
  `submitLanded`, 8 tests (5 fail on the old catch, 3 are regression guards).
- Task review (sonnet): no Critical/Important; six Minors. Rulings:
  - #1 claimed ids depended on serial dispatch and on entries still being in
    `optimistic` → a never-pruned `jobId → designId` map of queued results,
    plus an `unresolvedOthers` count (same-design submits still awaiting a
    response); `submitLanded` gained the parameter.
  - #2 a hanging reconcile read left the cell up with no notice → 6 s
    `withTimeout` per attempt.
  - #3 comment on overlap with a poll; #4 tautological assertion removed;
    #5 three more tests (words typed during the read survive, landed with a
    cell only, concurrent same-lane submit); #6 timer-assumption comment and a
    hang test.
- Controller finding while checking fix round 1: the never-pruned map made a
  job that finished before this submit count as "departed", cancelling one of
  this submit's cells → false failure. Fix round 2: claims carry
  `{jobId, imageId}` (the queued result's `imageId` is the eventual cell id),
  so claimed work is excluded by both ids and never counts as departed.
- Re-review (haiku): RESOLVED. 152 targeted tests pass.

## Whole-branch review 1 (opus) — CHANGES REQUESTED

Key fact it established: the Next client runs Server Functions strictly one at
a time (`runRemainingActions`). Consequences:
1. Important: a poll queued behind the failed `generateDesign` is applied
   before the reconcile read and shows the server's cell beside the optimistic
   one (two cells, then one), and if the reads then fail the notice appears
   next to the running cell.
2. Important: two lost same-lane submits could resolve A as failed and then B
   as landed on A's job, losing B's words silently.
3–10. Minor: `unresolvedOthers` counted later submits; a claimed baseline job
   still counted as departed (and its client test was vacuous); the retry
   after a timeout can't help (the timed-out read heads the serial queue); the
   reason given for not using `pollOnce` was wrong; nothing shows a job that
   landed when the reads fail; a mock restore inside a test body; the plan no
   longer matched the code; an `after()` failure after the job insert reads
   as landed.

Controller analysis beyond the review: with serial dispatch, the most likely
#245 timing is a response dropped while the server is still inside
`generateDesign` (the brief call runs for seconds before the job row exists).
A single reconcile read then sees nothing and reports failure: the bug again.

Ruling: replace the one-shot read with a reconcile window (Task 3 in the plan):
every applied snapshot judges each lost submit landed / failed / wait; 20 s
window; an anchored lane that is gone fails at once (#204); disowned ids after
a failure; claims as `{jobId|null, imageId|null}`; `unresolvedOthers` counts
only submits started before the snapshot was requested; refs updated
synchronously; after a deadline failure one `pollOnce()`. The `after()` trade
is accepted and documented.

## Task 3 — reconcile window (commit `822b205`)

- Implementer (sonnet): `judgeLostSubmit` replaces `submitLanded`; refs
  (`claimsRef`, `inFlightRef`, `lostRef`, `lanesRef`) written synchronously;
  judgement inside `applyFreshLanes`; deadline timer; the direct read, its
  timeout and retry deleted. Deviation accepted: `unresolvedOthers` counts
  submits with `startedAtMs <= snapshotStartedAtMs` (a same-millisecond submit
  can't be ruled out; ties resolve to failure). Nine hand mutations each
  failed a test.
- Task review (sonnet): two Importants.
  1. A landed verdict claimed nothing, so a later lost submit B (fired after a
     snapshot was requested, before it was applied) could land on A's job and
     lose B's words silently. Ruling: `landed` returns `accounted`; claims are
     recorded after the whole pass (in-loop claiming would flip siblings).
  2. The deadline judged the last applied snapshot while a poll that would
     show the job was in flight. Ruling: `RECONCILE_GRACE_MS` 5 s re-arm while a
     poll is in flight, and `pollOnce`'s `finally` judges past-deadline entries.
  Minors: docblock overclaimed ("never drops words"): now "biased toward
  failure" with the exceptions listed (another tab's job in the lane; the
  `after()` trade); comment wording on which snapshots are judged; `nowMs`
  shadowing renamed `judgedAtMs`; idempotency test; test 8 asserts the final
  poll.
- Re-review (haiku): RESOLVED. 207 targeted tests pass.

## Whole-branch review 2 (opus) — CHANGES REQUESTED

Confirmed every earlier Important fixed. New findings:
1. Important: poll errors halt the loop after 4 failures (~8 s); at the
   deadline the timer judged the pre-submit snapshot and reported failure, then
   polled and showed the running cell beside the notice (#245 again on a flaky
   network). Ruling: at the deadline start a poll and let it decide; grace
   backstop only for a hung read; the loop ignores the halt while an entry
   with no `jobId` is in `optimistic`.
2. Important: a throw from `generateDesign` itself arrives with a `digest`
   (Flight client `resolveErrorProd`), and every such throw precedes the job
   row; a lost or cut response has none. The window made every genuine
   failure (e.g. an Anthropic outage) wait 20 s, and could take another tab's
   job as "landed". Ruling: digest → old path at once (notice, words back, one
   poll for #204); no digest → window.
3–8. Minor: clear a decided entry's deadline timers; a vacuous "one notice"
   assertion (notice is one string); test 3's timing; plan drift (plan
   amended, `944d3d1`); ledger uncommitted; one-line note on the
   two-lost-submits cap overcount.

## Review-2 fixes (commit `e6fcf09`)

- Implementer (sonnet) implemented all rulings. It also found a defect the
  poll-first change exposed: a full pass at the deadline removed A from
  `lostRef` when A failed, so B, judged later in the same pass, saw no other
  unresolved submit and landed on the job A could equally have owned. Fix:
  `unresolvedOthers` is computed from the entries the pass started with.
  Accepted.
- Digest claim verified by both the implementer and the re-reviewer in
  Next's bundled code: the Flight client attaches `digest` in production
  (`resolveErrorProd`) and development (`resolveErrorDev`); the server sets it
  in `createReactServerErrorHandler`. Errors sent without a digest (aborts,
  large-shell errors) fall into the window: the safe direction (a 20 s wait,
  not a wrong verdict).
- Re-review (sonnet, scoped): RESOLVED. Two minors, both accepted as-is:
  test 21 pins the observable (no stray read after an early landing), which
  both the timer clear and the `lostRef.has` guard in the timer provide, not
  the clear alone; plan and ledger updates (done here and in `944d3d1`).
- Noted, not changed: a `generateDesign` call that hangs while reads fail now
  polls at the slow cadence until the browser gives up on the request (only one
  poll in flight at a time), where the loop used to halt after 4 errors.

## Known limits (documented in code)

- Another tab starting a job in the same lane during the window reads as
  landed for this submit.
- If the server's `after()` work fails right after the job row is written, the
  submit reads as landed; the sweep then fails the job with no notice.
- Two same-lane submits that both lose their response can show the server's
  cell next to the overlay (and count both toward the cap) until a deadline.
- A brief call slower than 20 s reads as a failure with the words back
  (today's behaviour, no worse).

## Gate (controller, on `e6fcf09`)

- `npm run lint`: 0 errors, 22 warnings (all pre-existing; eslint on the
  changed files is clean).
- `npm run typecheck`: clean.
- `npx vitest run`: 187 files, 2093 tests passed.
- `npm run build` with CI's dummy env: success.
- `npm run db:generate`: "No schema changes, nothing to migrate".
- e2e not run locally (brief); the spec most exposed is
  `e2e/guest-funnel.spec.ts` (the only one that touches Studio/generation).
