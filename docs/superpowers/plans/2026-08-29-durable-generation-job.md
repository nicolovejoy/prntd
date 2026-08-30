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

### Task 1: `image_generation` table + migration 0011

**Files:**
- Edit: `src/lib/db/schema.ts` (append a table, matching the house style —
  snake_case columns, camelCase fields, a substantial doc comment above it
  citing this slice and the spec)
- Create: `drizzle/0011_*.sql` via `npm run db:generate` (never hand-write
  the file name)

**Interfaces produced (every later task imports these):**

```ts
export const imageGeneration = sqliteTable(
  "image_generation",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    designId: text("design_id").notNull().references(() => design.id),
    userId: text("user_id").notNull().references(() => user.id),
    // running -> succeeded | failed. Cancellation is `cancelled_at`, not a
    // status, so every transition predicate stays `status = 'running'`.
    status: text("status", { enum: ["running", "succeeded", "failed"] }).notNull(),
    operation: text("operation", { enum: ["generate", "edit"] }).notNull(),
    // Minted before the provider call; also the R2 key stem. Opaque id, no FK
    // — the image row does not exist until the job succeeds.
    imageId: text("image_id").notNull(),
    r2Key: text("r2_key").notNull(),
    // Resolved anchor as an IMAGE ID, never the positional referenceImage
    // index — positions are stable only inside one synchronous span.
    anchorImageId: text("anchor_image_id"),
    generationNumber: integer("generation_number").notNull(),
    // Captured at insert so a refund after midnight UTC credits the right
    // bucket. Recomputing at refund time is the bug this column prevents.
    dayKey: text("day_key").notNull(),
    ip: text("ip"),
    cost: real("cost").notNull().default(0),
    error: text("error"),
    cancelledAt: integer("cancelled_at", { mode: "timestamp" }),
    startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
    finishedAt: integer("finished_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [
    index("image_generation_user_status").on(t.userId, t.status),
    index("image_generation_design_status").on(t.designId, t.status),
  ]
);
```

Both indexes are load-bearing, not speculative: the concurrency cap counts
by `(user_id, status)` on every insert, and the thread poll + lazy sweep
read by `(design_id, status)` on every thread render.

- [ ] **Step 1:** add the table, run `npm run db:generate`, and read the
  generated SQL. It must be a plain `CREATE TABLE` + two `CREATE INDEX`
  and touch nothing else. drizzle-kit has twice tried to *recreate*
  existing tables in this repo (the #165 incident where an `INSERT…SELECT`
  would have written the string literal `'title'` into every product row).
  If the generated file contains anything but additive statements, stop and
  hand-patch it down to additive.
- [ ] **Step 2:** `npm run db:push` against the dev branch only, then
  confirm `.env.local` really points at `prntd-dev` first with
  `npx tsx scripts/check-db-isolation.ts` — `.env.local` has drifted to
  prod twice (memory `project-env-local-drift`, issue #166).
- [ ] **Step 3:** verify the migration-drift CI gate stays clean —
  `npm run db:generate` a second time must produce no new file.

**Do NOT** apply this migration to prod or preview. That is a manual step
recorded in Task 7, gated on a fresh `turso db create prntd-backup-<date>
--from-db prntd`.

### Task 2: `src/lib/generation-job.ts` — the lifecycle layer

Everything that moves a job between states lives here. `actions.ts` never
writes `image_generation` directly, so the hardening contract is enforced
in one file that can be tested against a real DB.

**Files:**
- Create: `src/lib/generation-job.ts`
- Create: `src/lib/__tests__/generation-job.integration.test.ts` (real DB via
  the existing `src/lib/__tests__/test-db.ts` harness + `factories.ts`)

**Interfaces produced:**

```ts
export const GENERATION_CONCURRENCY_CAP = 3;
export const STALE_JOB_MS = 5 * 60 * 1000;

export type GenerationJob = { /* row shape, camelCase */ };

/**
 * Conditional insert: the cap is enforced by the INSERT itself, because
 * libSQL over serverless HTTP has no interactive transaction, so
 * count-then-insert races across two tabs. Returns at_capacity when the
 * guarded insert affects zero rows.
 */
export async function insertGenerationJob(params: {
  designId: string; userId: string; operation: "generate" | "edit";
  imageId: string; r2Key: string; anchorImageId: string | null;
  generationNumber: number; dayKey: string; ip: string | null; cost: number;
  now?: Date; db?: AppDb;
}): Promise<{ ok: true; job: GenerationJob } | { ok: false; reason: "at_capacity" }>;

/** Conditional running -> failed. Refunds from the ROW when it wins. */
export async function failGenerationJob(params: {
  jobId: string; error: string; now?: Date; db?: AppDb;
}): Promise<{ failed: boolean; refunded: boolean }>;

/** The statement the completion batch composes in — see Task 3. */
export function succeedJobStatement(db: AppDb, jobId: string, now: Date);

/** Owner-gated, only while running. Sets cancelled_at; status is untouched. */
export async function cancelGenerationJob(params: {
  jobId: string; userId: string; db?: AppDb;
}): Promise<boolean>;

export async function getRunningJobsForDesign(designId: string, db?: AppDb): Promise<GenerationJob[]>;
export async function countRunningJobsForUser(userId: string, db?: AppDb): Promise<number>;

/**
 * Lazy recovery. Fails + refunds every overdue running row in scope.
 * Scope is a discriminated union on purpose: with optional designId/userId,
 * a bare `{}` would silently sweep every user's jobs globally. The cron is
 * the only caller allowed to say `{ scope: "all" }`.
 */
export async function sweepStaleJobs(
  params: ({ scope: "design"; designId: string }
        | { scope: "user"; userId: string }
        | { scope: "all" })
        & { now?: Date; db?: AppDb }
): Promise<{ swept: number }>;
```

**Binding rules for this task:**

- `failGenerationJob` performs the transition and the refund **together**,
  and refunds only when the UPDATE reports exactly one row. Do not expose a
  transition that leaves refunding to the caller — that is the shape the
  contract exists to make impossible.
- The refund reads `dayKey` and `ip` off the job row and passes them to
  `refundGenerationQuota` via its existing `now`/`ip` parameters. It must
  never call `dayKeyUTC(new Date())` itself.
- `insertGenerationJob` is one raw guarded statement of the shape
  `INSERT INTO image_generation (...) SELECT ?,?,... WHERE (SELECT count(*)
  FROM image_generation WHERE user_id = ? AND status = 'running') < 3`,
  then inspects `rowsAffected`.
- Every function takes optional `db` and `now` for injection, matching
  `generation-quota.ts`'s established shape.

- [ ] **Step 1: failing tests first.** Required cases:
  - inserts a running job and returns it
  - refuses the 4th concurrent job for one user (`at_capacity`), and still
    allows it once one of the three is failed — proves the predicate reads
    `status`, not a row count
  - the cap is per user: three running jobs for user A do not block user B
  - **two concurrent `insertGenerationJob` calls at the cap boundary admit
    exactly one** (this is the race the guarded INSERT exists for; fire
    them with `Promise.all`)
  - `failGenerationJob` transitions running → failed, records the error and
    `finishedAt`, and refunds one quota unit
  - `failGenerationJob` on an already-failed job returns
    `{failed:false, refunded:false}` and does **not** refund again
  - the refund credits the job's stored `dayKey`, not today's — seed a job
    with `dayKey` set to yesterday, fail it with `now` set to today, and
    assert yesterday's `generation_usage` row is the one decremented
  - `cancelGenerationJob` sets `cancelledAt`, leaves `status='running'`,
    refuses a different user, and refuses an already-finished job
  - `sweepStaleJobs` fails + refunds a job older than `STALE_JOB_MS`, leaves
    a fresh one alone, and is idempotent across two runs (second run sweeps 0)
  - `getRunningJobsForDesign` excludes finished jobs and orders by
    `generationNumber`
- [ ] **Step 2:** implement until green.
- [ ] **Step 3:** `npm run lint && npm run typecheck && npm test`.

### Task 3: `generateDesign` — job insert + `after()` continuation

The heart of the slice. `src/app/design/actions.ts` changes from "hold the
request open for the whole render" to "insert a job, return, finish in the
background".

**Files:**
- Edit: `src/app/design/actions.ts` (`generateDesign`, `runGenerate`,
  `persistClarification`)
- Edit: `src/app/designs/actions.ts` — **`deleteDesign` must delete this
  design's `image_generation` rows.** `image_generation.design_id` FKs
  `design.id`, so once job rows exist, deleting a design that ever
  generated anything dies on the constraint. This is exactly #124: three
  tables FK'd `design.id` after Phase 1c and the delete batch only knew
  about one, producing a masked prod error. Add the delete to the existing
  `db.batch`, next to the `cart_item` delete, and add a case to
  `src/app/designs/__tests__/delete-design.integration.test.ts` that seeds
  a job row and deletes the design. A design with a *running* job still
  deletes — the continuation's write will simply find nothing and its
  conditional statements affect zero rows.
- Edit: `src/app/design/page.tsx` — add `export const maxDuration = 300`.
  Server actions inherit the *rendering route's* segment config, not an API
  route's, so without this the continuation runs on the default budget.
- Rewrite: `src/app/design/__tests__/generation-races.integration.test.ts`

**New return type** (a discriminated union — the current inferred shape
cannot express "queued"):

```ts
type GenerateResult =
  | { kind: "queued"; jobId: string; generationNumber: number; imageId: string }
  | { kind: "clarification"; message: string; readyToGenerate: false; options?: ChatOption[] }
  | { kind: "limit"; message: string }
  | { kind: "at_capacity"; message: string };
```

**The new order of operations** (each numbered step is load-bearing):

1. auth → `getOrCreateDesign` → `assertConversationOpen` → `clientIp`
2. `consumeGenerationQuota`. On denial return `kind:"limit"` — unchanged.
3. **Persist the user's chat message now**, not in the completion batch.
   Async means their own words must appear immediately.
   `persistClarification` therefore stops writing the user turn; it writes
   only the assistant turn. Audit every one of its call sites for the
   double-write this removes.
4. Advisory `countRunningJobsForUser` check. Over cap → refund the quota
   unit directly and return `kind:"at_capacity"`. This is purely to avoid
   paying for a brief call that cannot be used; it is **not** the
   authoritative check.
5. `assessReadiness` → clarify exit (assistant turn only). No job row.
6. `constructDesignBrief` → clarify exit. No job row.
7. Resolve generator + build the operation, including the existing
   "no anchor image to edit" exit. No job row.
8. `cost = generator.costFor(op)`; mint `imageId`;
   `reserveGenerationNumbers(designId, 1)` — **moved here**, ahead of the
   provider call, which is what makes numbering submit-order.
9. `insertGenerationJob(...)`. `at_capacity` → refund + return
   `kind:"at_capacity"`. This is the authoritative cap.
10. `after(() => runGenerationJob({ jobId, ... }))`
11. return `kind:"queued"`.

**The continuation, `runGenerationJob`:**

- provider call → `fetch` → `uploadImageObject(imageId, buffer)`
- **self-fail against the deadline before writing.** If the elapsed time
  since `startedAt` exceeds `STALE_JOB_MS`, a sweeper may already have
  failed and refunded this job; skip the write, delete the R2 object, and
  return.
- one `db.batch` containing:
  - image insert (`buildImageRow`), `conversation_image` insert
    (`buildOutputLinkRow`), assistant chat message insert
  - an **unconditional** `UPDATE design SET generation_cost = generation_cost
    + ?, updated_at = ?` — cost always accrues
  - a **separate conditional** `UPDATE design SET primary_image_id = ?,
    mockup_urls = NULL WHERE id = ? AND NOT EXISTS (SELECT 1 FROM
    image_generation g WHERE g.design_id = ? AND g.status = 'succeeded' AND
    g.generation_number > ?) AND (SELECT cancelled_at FROM image_generation
    WHERE id = ?) IS NULL`
  - `succeedJobStatement(...)`
  Splitting the design update in two is deliberate: folding the cost
  increment into the guarded statement would silently drop the cost
  whenever a newer job had already claimed primary.
- on any throw: `deleteImageObject(imageId)` best-effort, then
  `failGenerationJob(...)` (which refunds). The continuation must not
  rethrow past `after()` — an unhandled rejection can take down the shared
  Fluid instance, killing *other* users' continuations.

**Accepted, documented edge case:** a continuation slower than
`STALE_JOB_MS` can land after the sweeper already refunded the unit. The
deadline self-check closes the common case; the residue is a user who got
both their image and their quota back. Generous, rare, harmless — write it
in a comment rather than engineering it away.

- [ ] **Step 1: rewrite the race test.** The four existing invariants
  change meaning; carry each one forward deliberately rather than deleting:
  - "uploads under the minted image id and batches the writes" — still
    true, but now asserted *after draining the continuation*.
  - "hands two concurrent generates distinct keys" — still true, and now
    also asserts both jobs exist with distinct `generation_number`s.
  - "deletes the orphaned R2 object when the DB batch fails" — still true,
    and now additionally asserts the job ends `failed` with the quota
    refunded.
  - "refunds the consumed quota unit when generation throws" — the refund
    now comes from the job row, so assert `image_generation.status='failed'`
    too.
  New cases: numbering is submit-order under concurrency; the later-numbered
  job wins `primaryImageId` regardless of completion order (run them so the
  *earlier* job finishes last); a cancelled job still appends its image but
  does not claim primary; a clarification turn creates no job row; the user's
  chat message is persisted exactly once on both the clarify and the queued path.
- [ ] **Step 2:** implement. Note the test file already mocks
  `next/server`'s `after` as a no-op — it will need to become a collector
  the test can drain, or the continuation never runs.
- [ ] **Step 3: keep `design-client.tsx` compiling.** Changing
  `generateDesign`'s return type breaks its only caller, so this task owns
  the *minimal* client adaptation needed for `npm run typecheck` to pass:
  switch on `kind`, and on `queued` show the existing generating state and
  refresh the gallery once after a fixed delay. Deliberately crude — Task 5
  replaces it with real polling. Without this, Task 3 cannot pass its own
  gates, and a task that cannot pass its gates cannot be reviewed.
- [ ] **Step 4:** full gates.

### Task 4: read-path wiring — lazy sweep and the two read surfaces

Recovery latency is a function of how many read paths sweep. This task adds
the sweep to the reads that already happen, so no new traffic is created.

**Files:**
- Edit: `src/app/design/actions.ts` — add `getDesignJobs(designId)`
- Edit: `src/components/site-header-actions.ts` — extend `getHeaderState`
- Edit: whichever loader serves the thread payload and `/designs`

**Interfaces produced:**

```ts
/**
 * Owner-gated. Sweeps this design's overdue rows, then reports state.
 *
 * The client passes the job ids it is currently tracking. An earlier draft
 * had the server report jobs "settled since the client last looked", which
 * is unimplementable without server-side per-client cursors — the client
 * already knows what it is waiting on, so it says so.
 */
export async function getDesignJobs(
  designId: string,
  trackedJobIds: string[]
): Promise<{
  running: { jobId: string; generationNumber: number; startedAt: number }[];
  settled: { jobId: string; status: "succeeded" | "failed"; imageId: string | null; error: string | null }[];
}>;

export type HeaderState = { isAdmin: boolean; cartCount: number; runningJobs: number };
```

- `getHeaderState` calls `sweepStaleJobs({ userId })` before counting, and
  joins the count into its existing `Promise.all` so it stays **one** round
  trip — #144 collapsed four header POSTs into one and that must not regress.
- The thread loader sweeps `{ designId }`; `/designs` sweeps `{ userId }`.
- `runningJobs` is 0 for signed-out and anonymous users; do not fan out a
  query for them.

- [ ] **Step 1:** tests — `getDesignJobs` refuses a non-owner; sweeps an
  overdue row and reports it as settled/failed in the same call;
  `getHeaderState` returns a running count and still issues one round trip
  (assert by counting DB calls on an injected db).
- [ ] **Step 2:** implement. - [ ] **Step 3:** full gates.

### Task 5: the UI — polling, focus refetch, badge, cancel, turn-tracker retirement

**Files:**
- Edit: `src/app/design/design-client.tsx`
- Edit: `src/components/site-header.tsx`
- Edit: `src/lib/design-thread-cache.ts`
- Delete: `src/lib/turn-tracker.ts` and `src/lib/__tests__/turn-tracker.test.ts`
- Create: a pure `src/lib/generation-poll.ts` for the backoff schedule, so
  the timing is unit-testable without a component

**Behaviour:**

- `handleGenerate` awaits `generateDesign`, then switches on `kind`. On
  `queued` it records the job and starts polling; it no longer awaits an
  image. The `activeGeneration` single-flight ref is **removed** — three
  concurrent generations is the point of the slice. The button's disabled
  state keys off `running.length >= 3` instead.
- Poll `getDesignJobs` only while at least one job is running. Backoff:
  2s for the first 30s, then 5s, capped; stop entirely when nothing runs.
  Also refetch on `visibilitychange` and `focus` — phone-first means
  app-switching is the main journey, and it is the *only* mechanism that
  makes leave-and-return work.
- When a job settles, refresh the gallery and surface a failure inline.
- `handleCancelGenerate` calls the server `cancelGenerationJob` and stops
  polling that job. It works across tabs now, which the ref never did.
- **`turn-tracker.ts` is deleted.** Its entire job was guarding a settling
  server action against stale composer writes; there is no settling action
  any more. Every `turns.current.isCurrent(token)` guard must be removed
  deliberately, not mechanically — for each one, state in the commit
  message what now makes it unnecessary. `design-thread-cache.ts:72`'s
  comment referencing it needs updating too.
- **Revisit cache:** the 10-minute snapshot will flash a stale thread on
  exactly the leave-and-return journey this slice creates. Make the
  write-back job-aware: do not write a snapshot while a job is running for
  that design, and drop any cached snapshot for a design whose job settles.
  A stale snapshot showing "no image yet" after the image landed is the
  single most confusing outcome this slice can produce.

- [ ] **Step 1:** unit-test the pure backoff schedule and the
  disabled-at-cap predicate. - [ ] **Step 2:** implement.
- [ ] **Step 3:** full gates. Playwright is expected to see synchronous
  completion locally, because `after()` has no `waitUntil` under
  `next start` and simply blocks. That is documented behaviour, not a bug —
  do not "fix" it.

### Task 6: cron backstop + R2 orphan reclaim

`after()` losses cluster around deploys. The lazy sweep handles the row;
only the cron reclaims the object.

**Files:**
- Create: `src/app/api/cron/sweep-generations/route.ts`
- Create: `src/lib/sweep-generations.ts` (deps-injected core, real-DB tested,
  mirroring `src/lib/retry-fulfillment.ts`)
- Edit: `vercel.json` — add the cron entry

**Behaviour:** copy the auth pattern from
`src/app/api/cron/retry-fulfillment/route.ts` verbatim (missing
`CRON_SECRET` → 500 "Not configured"; mismatched bearer → 401). Sweep every
overdue running job across all users, then for each job that ends `failed`,
best-effort `deleteImageObject(job.imageId)` to reclaim the stranded
object. Log a top-level heartbeat line including the scanned count — #39's
route only logs per-order, so a zero-work run is silent and
indistinguishable from a cron that never fired.

**Explicitly do not** transfer #39's 24h ceiling. Applied here it would
strand jobs in `running` forever.

- [ ] **Step 1:** tests — auth 401/500 paths; sweeps across users; deletes
  the R2 object for a swept job; is idempotent. - [ ] **Step 2:** implement.
- [ ] **Step 3:** full gates.

### Task 7: gates, docs, and the deployment note

- [ ] `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` —
  all four, all green. Typecheck is the one agents skip and CI catches.
- [ ] Append a "Slice 3 status" section to
  `docs/async-generation-and-edit-plan.md` recording what shipped and every
  judgment call, matching the slice 1 and slice 2 status notes already there.
- [ ] Write the deployment steps into the PR body, do **not** execute them:
  back up (`turso db create prntd-backup-<date> --from-db prntd`), migrate
  prod, migrate `prntd-preview` manually — since #108, CI migrates only its
  own ephemeral copy, so every schema PR needs a manual preview migrate
  before its Vercel preview works. `scripts/migration-smoke.ts before|after`
  is valid here (0011 drops nothing).
- [ ] Confirm `vercel.json` still has no `supportsCancellation`.
