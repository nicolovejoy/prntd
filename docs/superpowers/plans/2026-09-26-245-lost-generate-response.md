# Lost Generate response reads as failure (#245) — plan

Slice G of batch 2 (`docs/superpowers/plans/2026-09-25-batch.md` rules; batch-2
brief). Branch `claude/245-lost-generate-response`. No migration, no schema
change, no server change.

## The bug

`src/app/studio/studio-client.tsx`, `submit()`'s `catch`: any thrown error from
`generateDesign`, including a transport failure after the server already
accepted the request (prod 2026-09-25, `net::ERR_NETWORK_CHANGED`), removes the
optimistic cell, shows "Something went wrong. Try again.", and puts the prompt
back in the composer. The server meanwhile passed quota and capacity, wrote the
design row and job row, and finished the render. The screen invites a retry,
and an unanchored retry mints a new design id, so it costs a second quota unit
and a second render and leaves a duplicate lane.

The catch was written for a different throw: `assertConversationOpen` when the
anchored lane was closed between the tab's last read and the tap (#204). That
case must keep working: notice, words back, the closed lane leaves, an anchor
into it clears.

## Approach

Reconcile before deciding. In the catch, keep the optimistic cell on screen
(phone-first: nothing moves while we find out), read the surface once with
`getStudioLanes()`, apply it exactly as a poll does, and ask whether the server
now shows work that this submit started:

- **Landed:** the lane for `targetDesignId` has a pending job, or a cell, that
  was not there when the submit fired. Drop the optimistic entry (the server's
  own cell takes its place in the same spot), no notice, composer untouched
  (it was cleared at submit and stays that way unless the user typed since).
- **Not landed:** today's behaviour — drop the entry, `GENERATE_FAILED_COPY`,
  give the words back if the box is empty.

"Not there when the submit fired" is a baseline captured at submit time from
the tab's server `lanes` for that design: its pending job ids and its cell
image ids. An unanchored submit's id is fresh, so its baseline is empty and
any job or cell counts. An anchored submit's lane already exists, so its old
jobs and cells are excluded. Job ids that other optimistic entries already
hold (a concurrent submit into the same lane whose response did arrive) are
excluded too, read at decision time.

Why "a job or a cell" and not "the lane exists": for an unanchored submit the
server creates the design row after quota and capacity pass but before the job
row, so a genuine failure between the two (the brief call throwing) leaves an
empty lane. That is a real failure and should read as one.

The reconcile read is a direct `getStudioLanes()` call, not `pollOnce()`:
`pollOnce` returns early when a poll is already in flight, and that in-flight
poll may have started before the server wrote the job row. If the read itself
throws (the network is still switching), wait `RECONCILE_RETRY_DELAY_MS`
(1000 ms) and try once more; if that throws too, we cannot know, so fall back
to today's failure behaviour.

Server-side idempotency keys are out of scope (issue: "a bigger change than
this needs").

## Tasks

### Task 1 — pure decision helpers in `src/lib/studio-view.ts`

Add, next to `settleOptimistic`:

```ts
/** What one lane held when a submit fired (#245). */
export type LaneBaseline = { jobIds: string[]; imageIds: string[] };

/** Baseline for `designId` from the tab's server lanes; empty when no lane. */
export function laneBaseline(lanes: StudioLane[], designId: string): LaneBaseline;

/**
 * Whether a fresh read shows work a submit started even though its response
 * never arrived: the lane for `designId` has a pending job not in the
 * baseline and not in `claimedJobIds`, or a cell not in the baseline.
 */
export function submitLanded(
  fresh: StudioLane[],
  designId: string,
  baseline: LaneBaseline,
  claimedJobIds?: Iterable<string>
): boolean;
```

Only server lanes are read (callers pass server `lanes`, never
`applyOptimistic` output, so optimistic cells can't count). Docblocks say why
"lane exists" alone is not enough (the empty-lane case above).

Acceptance / tests in `src/lib/__tests__/studio-view.test.ts`:
1. `laneBaseline` returns the lane's pending job ids and cell image ids; empty
   arrays when the design has no lane.
2. `submitLanded` true: fresh lane (empty baseline) with a pending job.
3. true: fresh lane with a cell and no pending (job already finished).
4. false: no lane for the id (closed lane, #204; or never created).
5. false: lane exists but empty (design row written, job never was).
6. false: anchored lane whose only pending job and cells are in the baseline.
7. true: anchored lane with one baseline job plus one new job.
8. false: the only new job id is in `claimedJobIds`.
9. Other designs' lanes never count.

### Task 2 — reconcile in `studio-client.tsx`'s submit catch

1. In `submit()`, before `generateDesign`, capture
   `baseline = laneBaseline(lanes, targetDesignId)`.
2. Factor the "apply a fresh snapshot" half of `pollOnce` (setLanes +
   settleOptimistic with `snapshotStartedAtMs` + reset poll errors) into one
   function both paths use, so the reconcile read can't drift from the poll.
3. Add a ref mirror of `optimistic` (like `activeRef`) so the decision can read
   other entries' claimed job ids at the moment it runs.
4. The catch: keep the optimistic entry while reconciling. Read the lanes
   (one retry after `RECONCILE_RETRY_DELAY_MS` if the read throws), apply the
   snapshot, decide with `submitLanded(fresh, targetDesignId, baseline,
   claimed)` where `claimed` = job ids of every other optimistic entry. Landed:
   drop the entry, no notice, no text restore. Not landed or unreadable: drop
   the entry, `GENERATE_FAILED_COPY`, restore text if the box is empty.
5. Replace the catch's comment: it now names both throws it handles (lost
   response, #245; closed lane, #204) and why it reconciles before deciding.
   Update the component docblock if anything it says about submit or polling
   becomes wrong. Check the rest of the file for comments that describe the
   old catch.

Acceptance / tests in `src/app/studio/__tests__/studio-client.test.tsx`
(`generateDesign` rejects in every case):
1. Unanchored, reconcile read shows a lane for the submitted id with a running
   job: exactly one pending cell remains, no "Something went wrong", composer
   empty. Assert the id: the lane the read returns uses the id
   `generateDesign` was called with.
2. Unanchored, reconcile read shows no lane: notice shown, words back, no
   pending cell (the existing "removes the cell when the action throws" test
   stays and still passes).
3. Unanchored, reconcile read shows the lane but empty: failure path.
4. Anchored, read shows the anchored lane with a new job id: no notice,
   composer empty, anchor still set.
5. Anchored, read shows the lane with only its pre-existing pending job:
   failure path.
6. #204: anchored, read no longer lists the lane (closed): notice, words back,
   lane gone, anchor chip cleared.
7. While the reconcile read is in flight (deferred), the pending cell is still
   on screen and no notice is shown (no layout shift).
8. Reconcile read throws once then succeeds with a running job: landed path.
   Read throws twice: failure path. (Fake timers or an awaited delay; no test
   may take more than a few seconds of real time.)

## Gate

`npm run lint`, `npm run typecheck`, `npx vitest run`, `npm run build` with
CI's dummy env, `npm run db:generate` → "No schema changes".

## Revision after the whole-branch review (Task 3)

Tasks 1 and 2 shipped a single reconcile read (timeout, one retry) decided by
`submitLanded(fresh, designId, baseline, claimed, unresolvedOthers)`, with
`claimed` = `{jobId, imageId}` pairs this tab got back from other submits.
The Opus whole-branch review then showed the one-read design is wrong on the
path #245 is about:

- **Server Functions run one at a time on the client** (Next's
  `runRemainingActions`). A network switch can drop the response while the
  server is still inside `generateDesign` — the brief call alone takes
  seconds and runs before the job row exists. The reconcile read then sees
  no job and reports failure: the #245 bug again, for the most likely timing.
- A poll queued behind the failed `generateDesign` is applied before the
  reconcile read and shows the server's cell beside the still-present
  optimistic one (two cells, then one: a layout shift on a phone).
- The retry after a timeout cannot help: the timed-out read still heads the
  serial queue.
- Two same-lane submits that both lose their response could resolve A as
  failed and then B as "landed" on A's job — B's words silently lost.
- `unresolvedOthers` counted submits fired after the snapshot was requested.
- A claimed baseline job that finished still counted as "departed".

### Design

Replace the one-shot read with a **reconcile window** judged on every applied
snapshot (poll or otherwise), with three verdicts:

- **landed** — evidence beyond what other unresolved submits could explain →
  drop the entry silently (the server's own cell takes its place).
- **failed** — decisive: the anchored lane is gone (closed or deleted, #204),
  or the window has closed without enough evidence → drop the entry, notice,
  words back if the box is empty, and disown the unexplained new ids in that
  lane so a later decision can't take them as its own.
- **wait** — no decision yet: the cell stays, polling continues.

Window: `RECONCILE_WINDOW_MS` = 20 000 ms from the throw (the brief call
usually takes 3–8 s; a slower brief reads as a failure, which is today's
behaviour, not worse). An unanchored submit whose lane is absent waits too:
the read may have raced the design-row write. Only an anchored lane that is
absent fails at once.

Evidence (`judgeLostSubmit`, pure, replaces `submitLanded`):
- `LaneBaseline` gains `laneExisted: boolean`.
- Claims are `{ jobId: string | null; imageId: string | null }`: a queued
  result claims both ids; a disowned pending job claims only its jobId; a
  disowned cell only its imageId.
- known jobs = baseline jobs ∪ claimed jobIds; known images = baseline images
  ∪ claimed imageIds.
- newPending = pending jobs not known; newCells = cells not known.
- departed = distinct job ids, from baseline jobs and job-only claims, minus
  job ids of claims that carry an imageId, that are no longer pending. Each can
  explain one new cell (its image id is unknown).
- evidence = newPending + max(0, newCells − departed).
- verdict: lane absent → `failed` if `baseline.laneExisted`, else `failed` if
  past the deadline, else `wait`. Evidence > unresolvedOthers → `landed`. Past
  the deadline → `failed` with `unexplained` = new pending jobs as
  `{jobId, imageId: null}` and new cells as `{jobId: null, imageId}`.
  Otherwise `wait`.

Client (`studio-client.tsx`):
- All bookkeeping the decision reads lives in refs updated synchronously (not
  mirrored from state in an effect), so a mock or a fast network resolving in
  the same tick still sees it:
  - `claimsRef: Map<designId, LaneClaim[]>` — queued results add
    `{jobId, imageId}`; failures add their `unexplained`.
  - `inFlightRef: Map<localId, { designId, startedAtMs }>` — added at submit,
    removed when the action returns (any result) or throws.
  - `lostRef: Map<localId, { designId, prompt, baseline, startedAtMs,
    deadlineMs }>` — added in the catch, removed when decided.
- `unresolvedOthers` for a lost entry = other entries (in `inFlightRef` or
  `lostRef`, same design, not itself) whose `startedAtMs` is before the
  snapshot's `snapshotStartedAtMs`.
- `applyFreshLanes(fresh, snapshotStartedAtMs)` runs the judgement for every
  lost entry after applying the snapshot. `pollOnce` is the only reader, so the
  direct reconcile read, its timeout and its retry are deleted.
- The catch: record the lost entry, schedule a deadline timer (judge with the
  latest applied lanes, kept in a `lanesRef`; past the deadline; then one
  `pollOnce()` so a job that did land shows even if the loop has stopped), and
  call `pollOnce()` (it returns early if a poll is already queued; that poll
  was dispatched after the throw and is judged the same way). The polling loop
  stays alive while the entry is in `optimistic`, so snapshots keep arriving
  through the window.
- A decision removes the entry from `optimistic` in the same batch as the
  `setLanes` that produced it, so the two cells never render together.
- Decisions are idempotent per localId (the deadline timer and a snapshot can
  both reach one).
- Comments: the catch explains both throws (#245, #204), serial dispatch, the
  window, and the accepted trade that an `after()` failure right after the job
  insert reads as landed (the sweep then fails the job).

### Task 3 acceptance / tests

Helper (`src/lib/__tests__/studio-view.test.ts`, replacing `submitLanded`'s):
lane absent anchored → failed now; lane absent unanchored → wait, failed past
deadline; new pending → landed; new cell only → landed; empty lane → wait,
failed past deadline; baseline job departed + one new cell → wait; + two →
landed; claimed `{jobId,imageId}` pending or finished → not evidence, and not
departed; job-only claim finished + one new cell → wait; evidence ≤
unresolvedOthers → wait; past-deadline failure reports the unexplained ids;
other designs never count.

Client (`src/app/studio/__tests__/studio-client.test.tsx`, replacing the Task
2 block where it conflicts):
1. Unanchored: rejects, the next snapshot shows the job → one pending cell at
   every observable step (never two), no notice, empty composer.
2. Unanchored: the snapshot shows no lane → the cell stays with no notice;
   a later snapshot shows the job → landed.
3. Unanchored: no lane through the window → at the deadline, notice, words
   back, cell gone, and a poll fires afterwards.
4. Unanchored: empty lane, then the job appears → landed; empty through the
   window → failure at the deadline.
5. Anchored: new job → landed, anchor kept, composer empty.
6. Anchored: only the pre-existing job through the window → failure at the
   deadline.
7. #204: anchored lane absent → failure immediately (no waiting), lane gone,
   anchor cleared.
8. Every read fails → failure at the deadline.
9. Words typed during the window survive a failure.
10. Concurrent same-lane: B queued `job-b`, A lost, snapshots show only
    `job-b` → A fails at the deadline.
11. Both A and B lost into one lane, one new job visible → neither lands on
    it; both fail by their deadlines.
12. A claimed job pending at A's submit (B's `job-b` in `lanes`) finishes
    during A's window, and A's own job finishes too → A landed.
13. A submit fired after a snapshot was requested is not counted against an
    earlier lost submit judged by that snapshot.

## Amendments from the Task 3 review and the second whole-branch review

These change the Task 3 Design above; the code follows these.

- **Landed claims its evidence.** `judgeLostSubmit` returns `accounted` on
  `landed` (new jobs as `{jobId, imageId: null}`, new cells as
  `{jobId: null, imageId}`); failures return `unexplained` the same way.
  `judgeLost` appends both to `claimsRef` after the whole pass, so a sibling
  judged in the same pass is not affected, and a later lost submit in the lane
  cannot land on work an earlier verdict already took.
- **The deadline decides from a fresh read.** At the deadline the client
  starts a poll and lets its snapshot decide (`pastDeadline` true); a poll that
  throws is decided in `pollOnce`'s `finally` (`judgePastDeadline`). A poll
  already in flight at the deadline gets `RECONCILE_GRACE_MS` (5 s); a hung
  read is decided against the last applied lanes when the backstop fires.
- **The loop does not halt on poll errors while a submit awaits a verdict**
  (an optimistic entry with no `jobId`), so a network that recovers inside the
  window is seen.
- **A server-thrown error is decided at once.** A throw from `generateDesign`
  itself reaches the client as an Error carrying a `digest`; every such throw
  happens before a job row exists (and is refunded). Those take the old path
  (notice, words back, one poll for #204). Only an error without a digest (a
  lost or cut response) enters the reconcile window.
- A lost submit's deadline timers are cleared when it is decided early.
