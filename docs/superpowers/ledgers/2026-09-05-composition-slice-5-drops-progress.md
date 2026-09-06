# Progress — composition slice 5: drops + rename, shops step 2

Plan: `docs/superpowers/plans/2026-09-05-composition-slice-5-drops.md`.
Spec: `docs/composition-first-class-plan.md` §2, §5 (Slice 4 status, Slice 5);
issue #191 step 2. Branch: `cloud/composition-slice-5-drops`.

Method: subagent-driven development applied by hand — the `superpowers`
plugin is not installed in this cloud session (no skill, no plugin, nothing
on disk), so the controller runs the same loop manually: one implementer per
task, a dedicated reviewer per task, fix rounds with scoped re-review, a
whole-branch review at the end. Tasks are sequential (each depends on the
previous), so implementers work directly on the branch — no worktrees.

Standing constraints: the migration is applied ONLY to the in-memory / CI
test DB; PR titled `HOLD: …`; no prntd.org / Vercel reachability from here.

## Pre-build findings (controller)

- Branch was at main (`9732e20`) — nothing built yet.
- `node_modules` absent in the fresh container → `npm ci` first.
- Prod may still hold test-era organizer `product` rows (spec §4: "a
  handful"). Dropping `product.design_id`/`store_id` would make those
  indistinguishable from Shop mirrors — a `listed` one with a `front`
  placement would surface in the Shop feed. The migration must delete
  organizer rows before the column drops, and the PR body's pre-check must
  show Nico what will be deleted.

- **Migrator semantics verified in node_modules** (`drizzle-orm@0.45.1`
  `libsql/migrator.js` → `session.migrate` → `@libsql/client@0.17.2`
  `client.migrate()`): every pending migration's statements run as ONE batch
  under `PRAGMA foreign_keys=off` + `BEGIN DEFERRED … COMMIT` (sqlite3 driver;
  the HTTP/ws drivers send the same `executeHranaBatch("deferred", …, true)`
  migrate mode). A failing statement rolls the whole chain back, migration
  ledger row included. So a "stop, not silent data loss" guard is expressible
  in plain SQL: a scratch table with `CHECK (n = 0)` fed by the pre-check
  count. Proven on the real chain (`.superpowers/dk-scratch/probe2.ts`).
- **drizzle-kit 0.31.10 emits WRONG SQL for two things here**, verified on a
  scratch copy of the chain: (1) plain `ALTER TABLE product DROP COLUMN
  store_id` / `design_id`, which libSQL 3.45 rejects ("unknown column
  "store_id" in foreign key definition") because Drizzle's FKs are table-level
  clauses — `product` needs the 0010-style hand recreate; `order.store_id`
  was added in 0001 with an inline `REFERENCES`, so its DROP COLUMN works.
  (2) an expression unique index `json_extract(placements,'$.front')` is
  split on the comma and each half backtick-quoted → "no such column".
  Resolution: a VIRTUAL generated column `product.front_image_id` +
  an ordinary unique index on it — drizzle-kit emits valid DDL for that in
  both the migration and the schema-derived test DB, and readers get a real
  column to join on.
- **The `listing → image_publication` rename prompt** is interactive
  (hanji, TTY only). Answered via a Python pty driver
  (`.superpowers/dk-scratch/`, down-arrow + Enter on "rename table"); once
  the snapshot carries `image_publication` the CI drift gate sees no diff and
  never prompts.
- Candidate SQL validated end-to-end: `.superpowers/dk-scratch/candidate-0013.sql`.

## Task 1 — shops step 2 code deletion (no schema change) — DONE (reviewed)

Commit `chore: retire organizer storefronts — delete dashboard/shop routes,
store-service, spec, STORES_ENABLED (#191 step 2, code half)`. Deleted the
dashboard + storefront routes, `store-service.ts`, `stores.ts`, their three
test files, `e2e/store-compose.spec.ts`, `cleanupStoresAndProducts` (its only
consumer), `storesEnabled()`, `STORES_ENABLED` in playwright + `.env.tpl`, the
money-path "store order (Phase 3)" test. `reparentUserData` no longer moves
`store` rows; its test seeds a Shop-mirror `product` instead of an organizer
one. Implementer judgment calls: kept `signUpFreshAccount`
(stripe-money-path.spec.ts imports it); README organizer paragraphs removed.
Controller amended the commit message only (session trailer typo).
Gate (implementer): lint 0 errors, typecheck clean, 1316 tests / 123 files
green, `db:generate` "No schema changes", build clean with no `/shop` or
`/dashboard` route. Stragglers handed to Task 2: e2e `cleanupDesigns` mirror
predicate + comment, `composition-reads.ts` predicate/comment, the
`delete-conversations` organizer-product test, schema docblocks, the
`d/actions.ts` "column drops with them" sentence, `cleanup-e2e-leftovers.ts`.
Review: content approved; the one blocking finding was the trailer typo the
controller had already amended. Four low findings (stale `cleanupStores`
comment in e2e/helpers/db.ts, `composition-reads.ts` citing the deleted
`store-service.createProduct`, ci.yml "storefront" in a comment,
reparent-user docblock still naming design_image) all sit in code Task 2
rewrites → folded into Task 2's brief. Reviewer re-ran lint/typecheck and
the reparent + money-path suites (32/32).

## Task 2 — schema + migration 0013 + chain-apply test + compile follow-through — DONE (reviewed, fix round landed)

Brief adds to the plan: `product.front_image_id` VIRTUAL generated column +
`product_front_image_unique` (the "real uniqueness constraint" the slice-4
status asked for, in the only form drizzle-kit 0.31 can emit validly);
`composition-backfill.ts` + its script deleted (they read the four dropped
columns; same call the Model B drop made); helper names in model-b-writes.ts
that say "listing" but mean the visibility row renamed to "publication";
the real migrator (`drizzle-orm/libsql/migrator`) drives the chain-apply test
so the guard's rollback is exercised the way `db:migrate` runs it.

Commit `448f416` — `drizzle/0013_flat_mentor.sql` (hand-written body, drizzle
snapshot + journal kept; plain `db:generate` reports "No schema changes").
Gate: lint 0 errors, typecheck clean, 1312 tests / 124 files (−6 backfill,
−1 organizer-block, −1 organizer-feed, +1 unique-index, +1 draft-not-in-feed,
+3 chain), build clean. Implementer judgment calls:
1. **`"product"` bulk-delete skip reason REMOVED** (diverges from the brief,
   which asked to keep it as a block). Reasoning accepted: `imageReferences()`
   in design-publish.ts already makes a product PIN a detach, never a block;
   only the FK `product.design_id` could block a conversation delete, and it
   is gone. `BulkDeleteSkipReason`, `deleteConversations`,
   `delete-designs-since` `formatReport`, `deleteDesign`'s error branch and
   the studio notice branch lost the case; the three "organizer product FKs
   the design" tests became "another composition pins the image → conversation
   deleted, image detached, R2 kept". User-visible only as a notice string that
   could never fire again.
2. drizzle-kit asks a SECOND prompt ("Is front_image_id column … created or
   renamed from another column?"); the controller's pty driver missed it.
   `.superpowers/dk-scratch/generate-with-rename2.py` answers both. Snapshot
   is drizzle-kit's own, not hand-crafted.
3. `mirrorFrontImageId` is now the nullable generated column; two readers
   (`order-line-identity.ts`, `user-designs.ts`) gained a null-narrowing guard.
4. composition-read-swap could no longer prove "reads product, not listing"
   by diverging the listing's sellable columns (gone) — keeps the product-side
   patch + assertion; added draft-mirror-not-in-feed.
5. Chain test pins 0013 by truncating a temp copy of the journal at the 0013
   entry, so the real migrator applies exactly 0013 even after 0014+ land.

Review (adversarial, migration-focused): "no data-loss path through
`npm run db:migrate`"; snapshot/journal verified against a drizzle-kit/api
derivation (byte-identical `__new_product` DDL); every INSERT…SELECT column
confirmed present on the 0010-era `product`; hrana batch path read
(`executeHranaBatch("deferred", …, true)`: each step conditioned on the
previous, conditional ROLLBACK). CHANGES REQUESTED on two Important items:
(1) the header framed a statement-by-statement shell run as supported — the
reviewer proved that outside `client.migrate()` the guard's failing INSERTs
do not stop execution and the DB ends half-migrated → header must FORBID
shell runs, PR body too; (2) both guard tests fail before any DDL, so add a
LATE-failure case (two mirrors sharing a front → `CREATE UNIQUE INDEX` fails
after the recreate; the reviewer probed that the real migrator rolls it back
fully). Minors: header says 0001, `order.store_id` came from 0002;
`design-publish.ts` still says `listing`; a studio-client test mocks a
delete-refusal string the action can no longer produce. Also: this libsql
build has double-quoted-string literals OFF, so the chain test would THROW
(not silently literalise) on an unknown `"column"` — the 0010 trap's silent
mode is not reproducible here; verified by hand instead. Reviewer supplied
seven extra read-only pre/post queries for the PR body (incl. `json_valid`
on placements — malformed JSON would fail the `__new_product` copy and roll
back). Fix round sent to the Task 2 implementer — that agent (and the Task 3
reviewer) were then killed by the account's session rate limit before doing
anything, so the CONTROLLER applied the fix round directly: header paragraph
replaced with an explicit "APPLY ONLY VIA `npm run db:migrate`" prohibition
(+ 0001→0002), a fourth chain-test case for the late unique-index failure
(rollback of every product row, the listing's four columns, the ledger — all
asserted), the three `design-publish.ts` comments, the studio-client mock.
Gate after the fix round: lint 0 errors, typecheck clean, 1328 tests / 125
files, `db:generate` "No schema changes", build exit 0.

Process note: two subagents died mid-flight on the rate limit with no work
lost (neither had edited the tree). When the budget is tight, small fix
rounds are cheaper done by the controller than by resuming an agent.

## Task 2 — schema + migration 0013 + chain-apply test + compile follow-through

_pending_

## Task 3 — verification tooling + docs — DONE (reviewed in the whole-branch pass; fix round landed)

Brief: `check-composition-read-parity.ts` becomes dual-mode (pre-0013 =
Nico's pre-check incl. the guard's stop conditions + the organizer rows the
migration will delete + duplicate fronts that would trip the unique index;
post-0013 = structural verify incl. dropped tables/columns, generated column,
index, and the 0013 ledger row), with the logic in `src/lib/composition-parity.ts`
so it is typechecked and real-DB tested against the migration chain.
Historical scripts: `check-model-b-parity.ts` deleted (gated 0009, complete
everywhere, queries two dropped tables); `check-model-b-tables.ts` +
`restore-designs-from-backup.ts` repointed at `image_publication`
(the latter's `design_image` subselect → `conversation_image`). Docs: plan
"Slice 5 status", CLAUDE.md Data Model section + organizer-pivot line,
RETIRED banners on the two organizer plan docs.

Commit `2e8aab7`. Gate: lint 0 errors, typecheck clean, 1327 tests / 125
files (+15 parity cases), `db:generate` clean, build clean, tsc probe on the
three scripts OK, CLI smoked on file-backed pre/post DBs (pre: exit 1 with 3
seeded problems; post: `POST-0013 VERIFY CLEAN`). Implementer judgment calls:
`restore-designs-from-backup.ts` now handles a PRE-0013 source (the backup
Nico takes right before migrating still has `listing`) into a POST-0013
target, copies only the four surviving visibility columns, and states it does
NOT restore the `product` composition row; pre-mode dedupes the shared-front
finding so one cause prints one line; post mode falls back to `json_extract`
when `front_image_id` is missing so the rest of the report stays useful;
five other scripts still mention `design_image` (pre-existing since 0009,
out of scope, reported not edited).

## Task 4 — PR body (controller) — DONE

PR #201 opened as `HOLD: composition slice 5 — migration 0013 drops
store/product_offering, order.store_id, product.store_id/design_id; listing →
image_publication (#191 step 2)`. Body carries: what changed; the migration
statement by statement; the "apply ONLY via `npm run db:migrate`" rule; the
prod pre-check (parity script in pre-0013 mode + the raw stop queries incl.
the reviewer's extra ones: `json_valid`, scratch tables, ledger position);
backup → merge → migrate → verify blocks for prod, preview and dev; the
merge→migrate window trace (money safe); ten judgment calls; the gate.
CI on the PR is the first run of 0013 over hrana against a copy of preview.

## Whole-branch review (+ the Task 3 review, folded in) — APPROVE, with tooling gaps fixed

Adversarial pass over all four commits. No data-loss path; no wrong blessing
by the tooling on realistic prod data; no prod 500 that outlives the migrate
window. Verified: pre-check predicates = the migration's guard/DELETE
verbatim; drizzle-kit `dialect: turso` → `drizzle-orm/libsql/migrator` →
`client.migrate` → hrana `executeHranaBatch(…, disableForeignKeys=true)`
with every step conditioned on the previous and a conditional ROLLBACK;
`reparentUserData` covers every `references(() => user.id)` column except
Better-Auth's own; no `"product"` skip-reason remnants; e2e helpers clean;
snapshot 0013 matches `schema.ts`; 1328/125 green.

**B2 — the merge → migrate window, traced.** Breaking in both directions, so
a window exists whichever order is chosen; money is safe in both. New code +
old schema: the webhook's paid-claim batch commits (order paid, sale/fee
booked, cart cleared); fulfillment fails closed at `getDesignImageWithOwner`'s
`image_publication` join → `paid_printful_failed`, no Printful submission, no
COGS; emails degrade or skip; the daily retry cron / admin Retry finishes it.
No new checkout can start (`requireMirrorProduct` throws before a session is
minted). Old code + new schema: `order.findFirst` selects `store_id` → throws
before the claim → 400 → Stripe redelivers (3 days). Surfaces that 500 in the
window: feed, `/prints`, `/d/*` + OG cards, Studio/My Designs, `/design?id=`,
`/preview`, publish family, admin published + order detail. Survive: header,
`/orders`, `/cart`, sign-in, `/api/health?db=1` (will NOT notice).

**Findings → fixed by the controller (fix round 2):**
1. Important — pre-check had no `json_valid` pass: malformed `placements`
   died as a raw `SQLITE_ERROR` instead of a named row (the migration would
   fail late, at the index, and roll back). Now a problem per row, and the
   survivors/structural pass is skipped so it cannot misreport every listing
   as orphaned.
2. Important — pre mode did not check for leftover `__slice5_guard` /
   `__new_product` tables: the one constructible "pre-check passes, migrate
   fails" case. Now a problem. Plus a NOTE of where the migrator thinks the
   DB is (newest ledger `created_at` vs 0012's journal `when`), since
   `db:migrate` applies everything newer than that row, not just 0013.
3. Minor — structural (read-path) problems are now tagged `[parity]` and the
   CLI footer says they are not migration blockers.
4. Minor — `docs/design-system.md` `/shop/[slug]` heading marked retired;
   README "15 tables" → 18.
5. Tests added: malformed JSON, scratch table, ledger-position note, and a
   later (0014-style) ledger row still counting as applied. Parity suite 15 →
   19 cases.
Not done: nothing from the review was deferred.

## Rulings made during the build

(appended as they happen)
