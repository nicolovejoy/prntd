# Migration adoption — execution plan (next session)

Status: **DONE 2026-06-13.** Baseline shipped: `drizzle/0000_baseline.sql` committed; all
three Turso branches (prntd, prntd-preview, prntd-dev) proven zero-drift and marked
`0000` already-applied; `db:migrate` wired; prod/preview targeted via inline turso-CLI
token (the `DB_TARGET` op-resolver in Step 3 was dropped as unnecessary). Backup branch
`prntd-backup-20260613` retained. Open Qs resolved: Q1 no drift; Q2 B2; Q3 dropped
resolver; Q4 yes. Steps 5 (migration smoke test) and Option C (CI preview auto-apply)
deferred. Original plan below for reference.

Companion to `docs/cicd-roadmap.md`
§"Migration discipline + DB targeting". This file is the step-by-step with gates,
options, and open questions. Goal of the session: prntd stops using `db:push`
against prod and adopts versioned Drizzle migrations, **without losing data and
without a prod schema change** (the baseline must be a no-op against prod).

Installed (verified 2026-06-13): `drizzle-kit@0.31.10`, `drizzle-orm@0.45.1`,
`@libsql/client@0.17.2`. 12 tables in `schema.ts`: user, session, account,
verification, design, chat_message, design_image, order, order_item, cart_item,
ledger_entry, generation_usage.

Per AGENTS.md: confirm exact `drizzle-kit` subcommands/flags against
`node_modules/drizzle-kit` at session start — 0.31 syntax, not memory.

## Goal / non-goals

- **Goal:** versioned migrations as the schema mechanism for prod (and preview);
  a clean `0000` baseline marked already-applied on prod; targeting that can't
  accidentally hit prod.
- **Non-goal this session:** CI auto-apply to prod (decided: stay manual, byside
  parity), per-PR ephemeral branches (#31), data backfills.

## The one real risk

Only the **baseline** reasons about prod's existing state. If prod's live schema
differs from `schema.ts` in any way, the generated `0000` won't match prod and
marking it applied would hide a real drift. Everything after the baseline is
additive and safe. So **Step 0 is a prod-vs-schema diff**, and the baseline is
proven on a throwaway branch before prod is touched.

## Step 0 — prove prod == schema.ts (GATE, do first)

prod has had hand-applied SQL (`migrate-26-prod.sql`, others). We must confirm
prod's actual schema equals what `schema.ts` generates, or the baseline is wrong.

1. Branch prod to a throwaway: `turso db create prntd-baseline-test --from-db prntd`.
2. `drizzle-kit generate` (with `schema.ts`) → produces `drizzle/0000_*.sql` +
   `drizzle/meta/`. Inspect the SQL: it should be CREATE TABLE for all 12 tables.
3. Point drizzle-kit `push --dry-run` (or `check`/`diff` — confirm the 0.31 verb)
   at `prntd-baseline-test` and confirm it reports **zero diff** vs `schema.ts`.
   - Zero diff → prod matches; proceed.
   - Non-zero diff → STOP. prod has drifted. Reconcile `schema.ts` to reality
     first (add the missing column to schema, or write a real `0001` to fix
     prod), then re-baseline. Do not mark applied over a drift.

## Step 1 — generate + commit the baseline

- Keep the `drizzle/0000_*.sql` + `drizzle/meta/` snapshot from Step 0.
- Commit them. This is the schema's genesis record going forward.

## Step 2 — mark 0000 already-applied (the baseline trick)

drizzle tracks applied migrations in a `__drizzle_migrations` table. Because all
12 tables already exist on prod, we must NOT run `0000` (its CREATE TABLEs would
error / or worse, partially apply). Instead insert the migration ledger row so
`migrate` treats `0000` as done and starts at `0001`.

- The row drizzle expects: a hash (it computes per migration) + a `created_at`.
  **Confirm the exact `__drizzle_migrations` shape and hash algorithm for
  libSQL in 0.31** against node_modules before writing the insert.
- **Prove it on `prntd-baseline-test` first:** insert the marker, then run
  `drizzle-kit migrate` against that branch and confirm it reports **"no
  migrations to apply"** and that `select count(*)` on every table is unchanged
  from the prod copy. Only after a clean dry-run, do the same insert against real
  prod.

## Step 3 — targeting that can't hit prod by accident

- `.env.local` becomes **permanently dev-only** (`prntd-dev`). Stop the
  comment-toggle dance. Confirm with `scripts/check-db-isolation.ts` (exists).
- Add a `DB_TARGET` resolver: `DB_TARGET=prod` pulls prod URL/token from
  `op://dev-secrets/...` at runtime, never persists. `db:migrate` and ops scripts
  (clean-chat-envelopes, etc.) read it. Secrets hook still gates prod creds → a
  prod run stays a one-line Nico handoff, but one clean command.

## Step 4 — wire the npm scripts

- `db:generate` (already present) — author migrations.
- `db:migrate` — `drizzle-kit migrate` against the resolved target.
- Decide dev's tool (see Option B). Document the new flow in CLAUDE.md
  Commands: schema change = edit schema.ts → `db:generate` → review `000N.sql`
  in PR → merge → `DB_TARGET=prod npm run db:migrate`.

## Step 5 — verification tests (cheap, high value)

- A migration smoke: pre/post `count(*)` per table, assert no unexpected drops;
  assert new columns are nullable or backfilled as intended. Run against the
  throwaway branch as part of any future migration.

## Step 6 — backup discipline

- Before any prod migrate: `turso db create prntd-backup-<date> --from-db prntd`.
  That is the rollback. Document it in the flow.

## Options to decide (differing approaches)

**Option A — how to mark 0000 applied**
- A1 (recommended): manual `INSERT` into `__drizzle_migrations` with the hash
  drizzle expects, proven on the throwaway branch first. Precise; version-
  sensitive (verify the hash/shape in 0.31).
- A2: if 0.31 exposes a first-class "mark/baseline" path, use it. Check docs;
  fall back to A1 if absent.

**Option B — does dev also move to migrations, or keep `db:push`?**
- B1: all envs use `migrate` (dev included). Maximum consistency; dev loses
  fast schema-diff iteration.
- B2 (recommended in roadmap): dev keeps `db:push` against `prntd-dev` for
  speed; prod + preview use `migrate`. Risk: dev schema can momentarily diverge
  from the migration chain — mitigated by always `db:generate` before merge.

**Option C — preview branch application**
- C1: CI applies `migrate` to `prntd-preview` as part of the E2E job (keeps
  preview schema-current automatically).
- C2: rebuild preview from migrations + seed on demand (cleaner, more steps).
- Lower stakes; decide when wiring CI.

**Option D — build the `DB_TARGET` wrapper this session, or migrations only?**
- D1 (recommended): build it alongside — `db:migrate` needs target selection
  anyway, and it's what makes the envelopes cleanup a clean one-liner.
- D2: migrations first, targeting later; accept one more manual flip for the
  first prod migrate.

## Open questions for Nico (resolve at session start)

1. Has prod's schema been changed *only* via paths that are reflected in
   `schema.ts` (i.e. is Step 0 expected to show zero diff), or do you know of
   hand-SQL on prod that never made it back into `schema.ts`?
2. Option B — dev keeps `db:push` (B2) or go all-migrate (B1)?
3. Option D — build the `DB_TARGET` wrapper this session (D1) or defer (D2)?
4. OK to spin up throwaway Turso branches (`prntd-baseline-test`,
   `prntd-backup-<date>`) freely? (Free, deleted after.)

## Rollback

If anything looks wrong mid-baseline: prod was never written to until Step 2's
real insert, and that insert is reversible (delete the `__drizzle_migrations`
row). The pre-migrate backup branch (Step 6) is the full safety net. No prod
schema DDL runs during baselining — only a ledger-row insert.
