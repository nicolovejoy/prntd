# Plan: optimistic pending cell on the Studio bench (#187 point 2)

**Issue:** #187 point 2. **Spec authority:** the issue text quoted below plus
`docs/studio-plan.md` (slice 2/3 bench model). **Branch:** `feat/187-optimistic-pending`.

> No immediate indication a prompt was received. Typing "A fish frying bacon"
> and submitting produced nothing on screen until the server action returned
> and the first poll landed. Cause: `submit` awaits `generateDesign` and only
> then calls `pollOnce`; the pending cell exists only once the job row is read
> back. Fix shape: optimistic pending cell (and lane, when unanchored) at
> submit time, reconciled by the poll — the same rule turn-tracker used to
> guard: a late server state may append, never clobber.

Nico's prod smoke 2026-09-05 (cancel flow): "takes too long to show a new
entry in studio (should be instant) and then I have to click through to that
entry to cancel it, which is way too many clicks."

## Global constraints

- Phone-first. The new cell must be visible without scrolling on a 390px
  phone when the composer is used (the composer is docked at the bottom
  today; the new lane goes to the TOP of the bench — activity-desc order —
  so on an empty bench it is the first thing above the composer).
- The Studio's polling loop (`src/app/studio/studio-client.tsx` `pollOnce`,
  `active`, wake refetch, error budget in `src/lib/generation-poll.ts`) is
  the fragile part every review flagged. Server truth still wins for
  everything the server knows about; local state only fills the gap the
  server cannot yet see.
- `window.confirm` sites in this file are being replaced on a parallel
  branch (#195). Do not touch them.
- Copy is The Clean Label (`docs/design-system.md` Part 1): plain, no
  whimsy. The pending cell keeps its existing look and elapsed label.
- Tests: pure reconcile logic gets unit tests; the client gets RTL tests in
  the existing `src/app/studio/__tests__/studio-client.test.tsx` harness.
  Run `npm run lint`, `npm run typecheck`, `npm test` before reporting.

## Design

Today: `submitting` counts in-flight `generateDesign` calls for the cap;
nothing renders until `pollOnce` after the action returns.

After: `submit()` inserts an **optimistic pending cell** immediately.

- Anchored submit → the cell is appended to the anchor's lane `pending`.
- Unanchored submit → a new optimistic lane `{designId: targetDesignId,
  title: null, cells: [], pending: [cell], lastActiveAt: now}` at index 0.
- Optimistic cell shape = `StudioPendingCell` plus a local marker. Suggested:
  keep an `optimistic: OptimisticEntry[]` state next to `lanes`, where
  `OptimisticEntry = { localId, designId, anchorImageId|null, startedAt,
  jobId: string|null, newLane: boolean }`, and derive the rendered lanes with
  a pure `applyOptimistic(serverLanes, optimistic, nowMs)` in
  `src/lib/studio-view.ts`. Rendering from server lanes + an overlay means
  `pollOnce`'s `setLanes(fresh)` can never wipe the cell — the overlay is
  applied on every render, not stored inside `lanes`.
- Resolution: when `generateDesign` returns `{kind:"queued", jobId}`, set the
  entry's `jobId`. An entry with a known `jobId` is dropped from the overlay
  as soon as server lanes either list that jobId in some lane's `pending` OR
  the entry's design lane exists server-side and does not list it (the job
  already finished/cancelled — server truth). An entry with `jobId: null`
  (action still in flight) is always kept.
- Failure: non-`queued` result or throw → remove the entry, existing notice
  behaviour unchanged, text given back as today.
- Cap: `isAtGenerationCap(runningCount, pendingCount)` from
  `src/lib/generation-poll.ts` — pass the server pending count and the
  optimistic count that is NOT yet visible server-side (entries whose jobId
  is null or not yet in server lanes) so a cell is never double-counted.
  Replace the `submitting` counter with this derived number.
- Poll loop: `active` must consider optimistic entries too, so polling starts
  the instant a cell appears (harmless if the job row isn't there yet).
- Cancel: the Cancel control on a pending cell (#194) needs a real jobId.
  Render the optimistic cell without Cancel until `jobId` is known, then with
  it — same markup as a server pending cell so nothing jumps.
- Select mode: a lane with an optimistic pending cell is not selectable,
  same rule as server pending (`selectableIds`).
- The anchor stays put after submit (slice 3 rule) — unchanged.

## Tasks

### Task 1 — pure overlay helpers + tests
`src/lib/studio-view.ts`: add `OptimisticEntry`, `applyOptimistic(lanes,
entries)`, `settleOptimistic(lanes, entries)` (returns the entries still
needed after a server refresh, per the resolution rule above), and
`unseenOptimisticCount(lanes, entries)`. Unit tests in
`src/lib/__tests__/studio-view.test.ts` covering: anchored append; new lane at
index 0 with `title: null`; entry with null jobId survives any refresh; entry
with jobId present server-side is dropped; entry with jobId absent but lane
present is dropped; entry with jobId absent and lane absent is kept (row not
yet visible); unseen count excludes entries already visible server-side.

### Task 2 — wire the client
`src/app/studio/studio-client.tsx`: replace `submitting` with the overlay;
render from `applyOptimistic(lanes, optimistic)`; settle in `pollOnce` after
`setLanes(fresh)`; resolve jobId on `queued`; remove on failure; Cancel gated
on jobId. Extend `studio-client.test.tsx`: submit shows a pending cell before
the action resolves (use a deferred mock); unanchored submit shows a new lane
at the top with the cell; a poll refresh landing while the action is in
flight does not remove the cell; after `queued` + a poll that lists the job,
exactly one cell shows (no duplicate); action failure removes the cell and
returns the text; cap counts the optimistic cell once.
