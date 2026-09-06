# Plan: /studio — measure, then move the two write sweeps off the render path (#204)

**Spec authority:** issue #204 and Nico's ruling 2026-09-06 (answer 1:
"yes" — ship the `after()` change in the same PR if the local profile shows
the sweeps are a real share of first byte). Migration-free. One PR.

## Global Constraints

- Measure BEFORE changing: Task 1 produces numbers; Task 2's go/no-go is
  decided from them by the controller (rule in Task 2).
- `sweepStaleJobs` then `sweepIdleConversations`, in that order, is a
  hard ordering (a job the first sweep just failed must no longer block
  its lane from archiving). Whatever runs them keeps the order.
- The sweeps remain a per-load backstop for this user — they must still
  run on every Studio load and every poll, just not ahead of the response.
  The `sweep-generations` cron (`scope: "all"`) is unchanged.
- Anything scheduled with `after()` must never reject (an unhandled
  rejection can take down the shared Fluid instance — see the comment above
  `after(() => runGenerationJob(...))` in `src/app/design/actions.ts`).
  Wrap in a catch that `console.error`s.
- `src/lib/studio.ts`'s read model stays "a fixed number of statements
  regardless of lane count".
- Existing tests in `src/lib/__tests__/studio.integration.test.ts` that
  rely on the sweeps running inside `getStudioLanesData` must be updated to
  the new seam, not deleted — the behaviour they pin (stale job → not a
  pending cell; idle conversation → leaves the bench) must still be
  asserted somewhere.
- `npm run lint`, `npm run typecheck`, `npm test` green.

## Task 1 — profile the render path locally

No product code changes are committed by this task except an optional,
reverted-before-commit instrumentation. Deliverable = numbers in the
report file.

1. Add temporary `performance.now()` timing around each awaited step of
   `getStudioLanesData` (session is at the caller; time: stale sweep, idle
   sweep, designs select, the `Promise.all` of the three reads) and a
   single `console.log` line per call with the four durations + total.
2. Build and run the compiled app against the dev DB the way the e2e
   harness does (`npm run build && npx next start -p 3100`, env from
   `.env.local` — the dev Turso branch is in the same AWS region as prod's
   `pdx1` functions, so round-trip shape is representative). Sign in as an
   existing dev user (or seed one with `npm run db:seed` — read
   `scripts/seed-dev-db.ts` for what it creates) so the bench has ≥ 5 lanes,
   then load `/studio` 6 times; discard the first (cold).
3. Record in the report: per-load numbers for the 5 warm loads, the mean
   per step, and the sweeps' share of the total. Then REVERT the
   instrumentation (`git checkout -- src/lib/studio.ts`); commit nothing.
   If the login/seed path is blocked, say exactly what blocked it and
   report the numbers you could get (e.g. from a script calling
   `getStudioLanesData` directly with the dev db — that is an acceptable
   fallback; note it excludes the session read).

## Task 2 — sweeps via `after()` (conditional)

Controller go/no-go rule: proceed if the two sweeps together are ≥ 20% of
the mean warm total from Task 1, OR ≥ 80ms absolute. Otherwise this task
is skipped and the PR ships only a CLAUDE.md-free note in the issue.

Files: `src/lib/studio.ts`, `src/app/studio/page.tsx`,
`src/app/studio/actions.ts`, `src/lib/__tests__/studio.integration.test.ts`,
new `src/lib/__tests__/studio-sweep.test.ts` if needed.

1. Extract `sweepStudioForUser(userId, db?)` into `src/lib/studio.ts`
   (exported): runs `sweepStaleJobs({scope:"user"})` then
   `sweepIdleConversations({scope:"user"})`, in order, and catches +
   `console.error`s any rejection so it is safe inside `after()`.
2. `getStudioLanesData` no longer calls the sweeps. Docblock updated:
   callers schedule `sweepStudioForUser` with `after()`; the data returned
   may be one sweep behind, and the next poll (which runs while any job is
   pending) shows the swept state.
3. `page.tsx` and `getStudioLanes()` in `actions.ts` both call
   `after(() => sweepStudioForUser(userId))` (import `after` from
   `next/server`) — schedule BEFORE awaiting the read so a thrown read
   still lets the sweep run.
4. Tests: the integration tests that previously asserted "stale job is not
   a pending cell after `getStudioLanesData`" now call `sweepStudioForUser`
   then `getStudioLanesData` and assert the same; add one test that
   `sweepStudioForUser` resolves (does not throw) when the idle sweep
   rejects (inject a db that throws), asserting the `console.error` was
   called. Check `src/app/studio/__tests__/studio-actions.integration.test.ts`
   for how `after` is handled under vitest (the design actions tests mock
   `next/server`'s `after` — follow that pattern).

Commit: `Studio: run the two sweeps after the response, not before it (#204)`.
Put Task 1's numbers in the PR body.
