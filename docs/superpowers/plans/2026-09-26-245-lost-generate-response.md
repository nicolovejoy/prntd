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
