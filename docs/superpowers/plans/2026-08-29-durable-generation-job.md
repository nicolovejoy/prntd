# Slice 3 — durable generation job

Spec: `docs/async-generation-and-edit-plan.md` — "Slice 3 — durable
generation job", plus its "Approach", "Durability, stated honestly",
"Hardening contract", "Concurrent-completion writes", and "How the UI
learns a job finished" sections. That document is the binding authority;
this plan is its task decomposition. Open questions 1-4 are answered in
the spec (separate conversations, passive notification, cap 3, TURBO).

## Global Constraints

1. **Conditional transitions only.** Every writer that moves a job out of
   `running` does it as `UPDATE image_generation SET status=?, ... WHERE
   id=? AND status='running'` and inspects `rowsAffected`. No
   unconditional status write exists anywhere. Same shape as #37's
   Stripe paid-claim.
2. **Refund is gated on that transition reporting exactly one row.** Never
   refund unconditionally. The refund reads the day key and ip **off the
   job row**, never recomputing them at refund time.
3. **The job row is self-sufficient for recovery.** At insert it carries:
   user id, design id, day key, ip, the minted image id, the R2 key, the
   resolved anchor image id (an image id — never the positional
   `referenceImage` index), the reserved generation number, the operation
   ("generate" | "edit"), and `started_at`.
4. **Clarification exits create no job row.** They return before the
   insert.
5. **Concurrency cap is server-side**: 3 rows in `status='running'` per
   user, checked at insert time.
6. **Recovery is lazy.** Stale `running` rows (started_at older than the
   stale threshold) are failed + refunded on read, by any route that
   reads jobs. The daily cron is a backstop only and is the sole place
   that deletes orphaned R2 objects.
7. **`after()` from `next/server`**, never `waitUntil`. The continuation
   must never be the only thing that can fail a job.
8. **No `supportsCancellation` in vercel.json.**
9. Every new module gets tests in the existing style; real-DB integration
   tests use the existing harness (`src/lib/__tests__/test-db.ts`).
10. `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` all
    pass before a task is reported DONE. Typecheck is not optional — an
    agent PR has shipped a type error past lint/test/build before.

## Design decisions this plan makes (and why)

The spec leaves several things to "decide in the slice". Decided here:

- **Generation numbers are reserved at job insert**, not after the render.
  That is what makes them submit-order. `design.generationCount` therefore
  changes meaning to *attempts*; a swept job leaves a gap in the `#N`
  labels. #147's "#N labels are creation-ordered" contract survives
  because submit order is creation order — but every consumer of the
  numbers must tolerate gaps.
- **The user's chat message is persisted up front**, right after the quota
  check, instead of in the completion batch. Async means the user's own
  words must appear immediately. `persistClarification` therefore stops
  writing the user turn — it writes only the assistant turn.
- **The assistant message still lands in the completion batch**, unchanged,
  because it carries `imageId`. An in-flight job shows in the UI as a
  pending strip entry sourced from `getRunningJobs`, not as a chat row.
- **Primary-image claim is a conditional SQL write, not a client guard.**
  A completing job takes `design.primaryImageId` only if no
  higher-numbered job has already succeeded, and only if it was not
  cancelled. Expressed as a `NOT EXISTS` correlated subquery on the
  `UPDATE design`, so two jobs racing to completion resolve
  deterministically by submit order rather than by provider latency.
- **Cancel is a `cancelled_at` timestamp on the job row, not a status.**
  This keeps the status machine to `running → succeeded | failed` so the
  conditional-transition rule stays a single simple predicate. A cancelled
  job still completes and still appends its image (that is #98's shipped
  behaviour, and the quota unit was really spent) — it just never claims
  the primary image, and the UI stops waiting on it. Cancellation works
  across tabs now, which the client-only ref never did.
- **The concurrency cap is enforced by a conditional INSERT**, not by a
  read-then-write. libSQL over serverless HTTP has no interactive
  transactions (this is why `deleteDesign` uses `db.batch`), so
  `count(*) < 3` followed by an insert is a real race across two tabs. The
  insert is written as `INSERT ... SELECT ... WHERE (SELECT count(*) ...)
  < CAP` and the caller checks `rowsAffected`. An advisory pre-check runs
  earlier, purely to avoid paying for a brief call that cannot be used.
- **Two refund paths exist and they are different.** A job that fails is
  refunded from its row (day key + ip read off the row, gated on the
  conditional transition reporting one row). A turn rejected *before* any
  job row exists — over the concurrency cap — is refunded directly, since
  there is no row to gate on. Do not unify them.
