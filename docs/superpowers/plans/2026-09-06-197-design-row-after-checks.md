# Plan: refused submit leaves no empty design row (#197)

**Spec authority:** issue #197 — `generateDesign` calls
`getOrCreateDesign` before the quota and advisory-capacity checks, so a
refused unanchored Studio submit (at cap, quota exhausted) leaves an open,
image-less, chat-less design row that renders as an "Untitled" lane. Fix
shape chosen (the issue's preferred one): create the row only after the
checks pass. Migration-free. One PR.

## Global Constraints

- `src/app/design/actions.ts` only, plus a real-DB integration test in
  `src/app/design/__tests__/` following the existing harness there (read
  `generation-races.integration.test.ts` for how the action is driven with
  mocked auth/headers and a real in-memory libSQL).
- The refund/quota invariants in `generateDesign`'s comments are binding:
  the quota unit is consumed before any paid call; `at_capacity` refunds
  inline; once a job row exists only `failGenerationJob` refunds. Nothing
  about that ordering moves — only the design-row INSERT moves later.
- `sendChatMessage` and the third caller of `getOrCreateDesign` (~line
  782) keep their current behaviour: a chat turn or that action legitimately
  creates the row.
- `assertConversationOpen` still runs before the quota spend for an
  EXISTING design (a closed thread must not burn a unit).
- The user's turn (`insertChatMessage`) FKs `design.id`, so the row must
  exist before that insert — create it immediately before the user-turn
  persist, after both checks.
- Ownership: an existing design owned by someone else still throws
  `Unauthorized` before anything is spent.
- `npm run lint`, `npm run typecheck`, `npm test` green.

## Task 1 — split find from create; create after the checks

Files: `src/app/design/actions.ts`, new
`src/app/design/__tests__/refused-submit-no-row.integration.test.ts`.

1. Add `findOwnedDesign(designId, userId)` → the row or `null`, throwing
   `Unauthorized` if the row exists under another user. Keep
   `getOrCreateDesign` for the other two callers (it can delegate to the
   new finder for the ownership check so the rule lives once).
2. In `generateDesign`: `found = await findOwnedDesign(...)`; if found,
   `assertConversationOpen(found)`; quota check; capacity check; THEN if
   `found` is null, insert the row (same `values` as `getOrCreateDesign`)
   and use the returned row as `found` for the rest of the function
   (`prepareGeneration` takes it).
3. Tests (real DB): (a) quota-refused unanchored submit → no `design` row
   for that id and result `kind:"limit"`; (b) capacity-refused (seed
   `GENERATION_CONCURRENCY_CAP` running jobs for the user) → no row,
   `kind:"at_capacity"`; (c) allowed submit on an unseen id → row exists
   with `userId` = caller (existing happy-path tests may already cover
   this; if so, point at them in the report instead of duplicating);
   (d) existing design owned by another user → throws `Unauthorized` and
   consumes no quota (assert the `generation_usage` count is unchanged).

Commit: `generateDesign: create the design row only after quota and capacity pass (#197)`.
