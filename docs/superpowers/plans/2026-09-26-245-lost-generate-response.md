# Lost Generate response reads as failure (#245) — plan (rebuild on a client-minted job id)

Slice G of batch 2. Branch `claude/245-lost-generate-response`. No migration,
no schema change. Revised 2026-09-27: Nico ruled to rebuild the fix on a
client-minted job id after an independent review found the first build (a
lane-snapshot heuristic) mergeable but disproportionate. The history section at
the end keeps what the first build learned.

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

## Facts the design rests on (verified in the first build)

1. A throw from `generateDesign` itself reaches the client as an Error with a
   string `digest` (React's Flight client, `resolveErrorProd` and
   `resolveErrorDev`; the server sets it in `createReactServerErrorHandler`).
   A lost or cut response (fetch `TypeError`, cut stream, 504) has none.
2. `generateDesign` throws only while no job row exists (Unauthorized, a closed
   lane, the brief failing, a forged anchor); every such throw is refunded by
   its outer catch. `at_capacity`, `limit` and `clarification` are RETURNED,
   not thrown.
3. The Next client runs Server Functions strictly one at a time
   (`runRemainingActions`). A call made at client time T is dispatched at or
   after T, so the server runs it at or after T. A call can sit queued behind
   another in-flight action (a slow `generateDesign`) for seconds.
4. When the job row can first exist: `generateDesign` does quota, capacity,
   the design-row insert, the user turn, two context reads, then the Claude
   brief (`constructDesignBrief`), then reserves a generation number and
   inserts the job row. The brief is the only slow step, and today it has no
   bound of its own (the SDK default is a 10-minute timeout with 2 retries).

## Design

### Server

1. **Client job id.** `generateDesign(designId, text, { anchorImageId?, jobId? })`.
   `jobId` is optional (`/design` does not send one). When present it must be
   a UUID, or the call throws before anything is written (no quota spent).
2. **Replay check before quota.** Right after the session check, if `jobId` is
   given, read the row with that id. Owned by the caller and on the same
   design → return the same `{ kind: "queued", jobId, generationNumber,
   imageId }` from the row, consume no quota, write nothing, schedule no
   render. Anything else (another user's row, or the caller's row on another
   design) → throw the same generic error as an invalid id, before quota.
3. **The row uses the client id.** `insertGenerationJob` takes an optional
   `id` and uses it instead of `crypto.randomUUID()`. The capacity cap's
   guarded `INSERT … SELECT … WHERE count < 3` is unchanged. Two outcomes the
   insert must tell apart, because a replay racing its original can pass the
   early check and reach the insert while the original's row is being written:
   - the statement throws a primary-key violation (`isUniqueViolation`) → a row
     with that id exists;
   - the statement affects zero rows → the cap refused it, UNLESS a row with
     that id already exists (a replay whose own original holds a cap slot:
     the WHERE is false before the key is ever checked).
   In both cases the function reads the row by id: owned by the caller on the
   same design → `{ ok: false, reason: "duplicate", job }`; exists otherwise →
   `{ ok: false, reason: "conflict" }`; absent (zero rows only) →
   `{ ok: false, reason: "at_capacity" }` as today.
4. **Refunds stay exactly-once.** In `prepareGeneration`: `duplicate` refunds
   this request's unit inline (like `at_capacity`) and RETURNS an
   `already_queued` result, which `generateDesign` maps to `queued` without
   scheduling `after()`; `conflict` THROWS, and the existing outer catch
   refunds once. Accepted cost of the (only concurrent) duplicate path: the
   user turn is persisted twice and a generation number is skipped.
5. **Status lookup.** `getGenerationJobStatus(jobId)` in
   `src/app/studio/actions.ts`, behind `requireStudioActionSession` (the same
   gate as `getStudioLanes`, so guests work). Reads by id AND the session's
   user id; returns `{ status: "running" | "succeeded" | "failed" |
   "cancelled" }` or `{ status: "none" }`. A running row with `cancelled_at`
   set reports `cancelled`. Another user's id and a malformed id both read as
   `none`, so the action says nothing about other users' ids. No sweep: a stale
   `running` row reads as running; the lanes poll's sweep fails it later.
6. **Bound the brief.** `constructDesignBrief` passes
   `signal: AbortSignal.timeout(DESIGN_BRIEF_TIMEOUT_MS)` (45 s) to the SDK
   call, a hard bound across its retries. A timeout throws, which
   `prepareGeneration` already turns into "Failed to construct prompt" and a
   refund. This is what makes the client's window finite: the job row exists
   within ~45 s of the server starting, plus fast DB work.

### Client

1. Every submit mints `clientJobId = crypto.randomUUID()` (as it already mints
   a new lane's designId), stores it on the optimistic entry
   (`OptimisticEntry.clientJobId`), and passes it as `opts.jobId`.
2. **Exact overlay settling.** `settleOptimistic` drops an entry whose `jobId`
   is still null when some lane's `pending` holds its `clientJobId` (the
   server's cell replaces it, so the two never render together), and
   `unseenOptimisticCount` counts such an entry as seen. Nothing else changes
   in those functions; another tab's job in the same lane has a different id
   and never matches.
3. **The catch.**
   - Error with a `digest` → today's path at once: drop the entry, notice,
     words back, `pollOnce()` (#204 keeps working).
   - Browser offline both when the submit fired and when it failed
     (`navigator.onLine === false` twice) → today's path at once. The fetch was
     refused on the device, so nothing reached the server. `navigator.onLine`
     is trusted only in its `false` direction.
   - Otherwise the response is lost: keep the cell (nothing moves) and run the
     reconcile loop for that submit's own id.
4. **Reconcile loop** (one per lost submit). Deadline =
   `Date.now()` at the catch + `LOST_SUBMIT_WINDOW_MS` (60 s: the 45 s brief
   bound plus margin for cold start and the DB work around it; the server
   started the request no later than the catch, so its job row exists by the
   deadline or never). Each round records `calledAtMs = Date.now()`, calls
   `getGenerationJobStatus(clientJobId)`, and asks the pure
   `judgeLostSubmit({ status, calledAtMs, deadlineMs })`:
   - `running` / `succeeded` → **landed**: set the entry's `jobId` to the
     client id and `jobIdKnownAtMs` to now (exactly what a `queued` response
     does), `pollOnce()`. No notice; the composer stays as it is.
   - `failed` → **failed**: today's failure path (drop, notice, words back if
     the box is empty, `pollOnce()`).
   - `cancelled` → **cancelled**: drop the entry and `pollOnce()`, no notice,
     no words back (a cancel is deliberate; today a cancelled queued job just
     leaves).
   - `none`, or the lookup threw (`error`) → **failed** only if `calledAtMs >=
     deadlineMs`, else **wait**: sleep `LOST_SUBMIT_LOOKUP_INTERVAL_MS` (3 s)
     and ask again. A lookup CALLED before the deadline can never fail the
     submit, however late it resolves (fact 3: it may have queued behind
     another action and been answered from a moment when the row was still
     coming).
   The first lookup goes out at once. The loop stops on unmount.
5. `generateDesign` resolving normally is unchanged: `queued` sets the entry's
   `jobId`; `limit` / `at_capacity` / `clarification` drop it with the message.

### Out of scope, noted

- If the job-row insert commits but its response is lost to the server,
  `generateDesign` throws with a digest and refunds while a `running` row holds
  a cap slot until the sweep. With client ids the client could check that id
  before failing; follow-up, not built.
- The client never replays a submit automatically; the server-side replay path
  exists so a repeated id is safe, not because the client resends.

## Tasks

### Task 1 — server: client job id, replay, conflict (real-DB tests)

Files: `src/lib/generation-job.ts`, `src/app/design/actions.ts`, a small
`src/lib/uuid.ts` (`isUuid`), tests.

Acceptance:
- `insertGenerationJob({ …, id? })` uses the id; returns `duplicate` / `conflict`
  / `at_capacity` per Design §Server 3.
- `generateDesign` validates, replays before quota, maps `duplicate` to
  `queued` without `after()`, throws on `conflict` (refunded once by the outer
  catch).
- Real-DB tests (`src/app/design/__tests__/client-job-id.integration.test.ts`
  plus cases in `src/lib/__tests__/generation-job.integration.test.ts`):
  the row carries the client id; own-id replay returns the same queued result
  with no quota consumed, no brief call, no second `after()`, one row; foreign
  id refused before quota, other user's row untouched; caller's id on another
  design refused; malformed id refused before quota; capacity still enforced
  with a client id (3 running → `at_capacity`, refunded, no row); an insert
  racing its original (row appears between the early check and the insert,
  both under and at the cap) → `queued` with the original's data, net quota =
  one unit, no second `after()`; a foreign row appearing at the insert → throw,
  refunded exactly once.

### Task 2 — status lookup, brief bound, pure client helpers

Files: `src/lib/generation-job.ts` (`getGenerationJobStatusForUser`),
`src/app/studio/actions.ts` (`getGenerationJobStatus`), `src/lib/ai.ts`,
new `src/lib/lost-submit.ts` (`DESIGN_BRIEF_TIMEOUT_MS`,
`LOST_SUBMIT_WINDOW_MS`, `LOST_SUBMIT_LOOKUP_INTERVAL_MS`, `judgeLostSubmit`,
`isServerActionError`), `src/lib/studio-view.ts` (`clientJobId`,
`settleOptimistic`, `unseenOptimisticCount`), tests.

Acceptance:
- Real-DB: status for own running / succeeded / failed / cancel-requested
  running / cancelled rows; another user's id → none; missing → none;
  malformed → none (no query).
- `constructDesignBrief` passes an `AbortSignal` to the SDK call (unit test on
  the mock's second argument).
- `LOST_SUBMIT_WINDOW_MS > DESIGN_BRIEF_TIMEOUT_MS` asserted in a test.
- `judgeLostSubmit` unit tests for every status × before/after the deadline,
  including `calledAtMs` just below and equal to the deadline.
- `isServerActionError`: string digest true; TypeError, plain Error,
  non-string digest false.
- `settleOptimistic` / `unseenOptimisticCount`: an unconfirmed entry whose
  `clientJobId` is pending is dropped / counted seen; a pending job with a
  different id in the same lane does neither; entries without `clientJobId`
  behave as before.

### Task 3 — client wiring and client tests

Files: `src/app/studio/studio-client.tsx`,
`src/app/studio/__tests__/studio-client.test.tsx`.

Acceptance: the Design §Client behaviour, with the header comment and the catch
comment describing it (the stale mention of the old catch goes). Tests (each
fails on main):
1. Landed after loss: action rejects without digest, lookup → running → no
   notice, composer empty, one pending cell at every observable step, and the
   lookup was for the id sent to `generateDesign`.
2. A poll lists the job under the client id before the lookup answers → still
   one cell (the overlay settles by `clientJobId`).
3. Failed after loss: lookup → failed → notice, words back, cell gone.
4. None until the deadline: cell stays and no notice before; failure after.
5. Serialized-queue race: a lookup called before the deadline that resolves
   `none` after it does not fail the submit; the next lookup (called after the
   deadline) decides.
6. Digest throw fails at once and never calls the lookup.
7. #204: anchored submit into a closed lane (digest throw) → notice, words
   back, lane leaves on the poll, anchor cleared, no lookup.
8. Two quick submits into one lane, both lost: each looked up by its own id;
   A running → landed; B none → fails at its deadline.
9. Another tab's job in the same lane (different id, pending in lanes) is not
   taken as this submit's: the overlay stays, failure at the deadline.
10. Offline at submit and at the catch → fails at once, no lookup.
11. Cancelled → cell leaves, no notice, words not returned.
12. Every lookup throws → no failure before the deadline; failure after.
13. Unmount during the window → no further lookups.
14. Words typed during the window survive a failure.
Phone-first: the cell never leaves and comes back; nothing above it moves.

## History: the first build (heuristic), 2026-09-26

The first build judged a lost submit from lane snapshots (a per-lane baseline
of job and cell ids at submit, "departed" job accounting, sibling counts, a
20 s window). An independent Opus review found it mergeable but ~470 lines with
blind spots (another tab submitting into the same lane, two lost submits in one
lane, a baseline job cancelled during the window, a brief slower than 20 s) and
one Important race (at the deadline a fresh poll could queue behind another
in-flight `generateDesign` and the verdict be judged from stale lanes). Its
lasting findings are the three facts above (digest, serial dispatch, where the
row is written). Its code was restored to main in `ff48ca0`; the full record is
in the ledger.
