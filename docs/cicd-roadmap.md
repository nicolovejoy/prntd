# CI/CD + dev-cycle roadmap

Goal: a real preview → prod cycle where every PR is automatically built,
deployed to an isolated preview with a seeded DB, exercised by E2E tests, and
gated on all-green before it can reach prod.

## Where we are (2026-06-09)

- **CI** (`.github/workflows/ci.yml`): lint → typecheck → test+coverage → build,
  on every PR + push to main. Solid baseline. Coverage measured, not gated.
- **Vercel**: preview deploy per PR; prod on merge to main.
- **DB isolation**: `prntd-dev` Turso branch for local dev (#27); Preview +
  Development deploys on an isolated `prntd-preview` branch; only Production
  touches prod. Preview-scope API keys fixed (Phase 1 done 2026-06-09).
- **Tests**: unit + real-DB integration (in-memory libSQL from live schema),
  plus Playwright E2E in `e2e/` (guest funnel + cart, mobile-first projects)
  run locally via `npm run e2e` and in CI against the PR's preview deploy.
- **Flags**: `MULTI_PLACEMENT_ENABLED`, `GUEST_FUNNEL_ENABLED`, `CART_ENABLED` —
  env-gated rollout, the right primitive for ship-dark-then-flip.

## Target cycle

```
PR opened
  → CI: lint, typecheck, test+coverage(gated), build
  → Vercel preview deploy
      · full Preview-scope env (API keys present)
      · ephemeral per-PR Turso DB branch, seeded to a known state
  → Playwright E2E run against the preview URL
  → branch protection: all checks green + 1 review required
merge to main
  → prod deploy
  → post-deploy smoke (build-date check / health route)
```

## Phased plan

### Phase 1 — preview parity (config, ~30 min, no code)
- Add `ANTHROPIC_API_KEY`, `REPLICATE_API_TOKEN`, `IDEOGRAM_API_KEY` to Vercel's
  **Preview** env scope (dashboard → each var → check Preview). Fixes the
  `/design` preview 500.
- Point Preview deploys at a **non-prod** Turso (a `prntd-preview` branch), so a
  preview can never mutate prod data. Set Preview-scope `DATABASE_URL` /
  `DATABASE_AUTH_TOKEN`.

### Phase 2 — repeatable state (code)
- `scripts/seed-dev-db.ts` — idempotent known-state seed (test user + a design
  with a primary image), guarded to refuse non-dev hosts. **First brick, landing
  now.** Unblocks repeatable E2E + manual testing.
- A reset helper to truncate transient tables (cart_item, generation_usage,
  test-classified orders) between runs.

### Phase 3 — E2E in CI (code + infra) — landed 2026-06-09
- ✅ `@playwright/test` + `e2e/` suite: guest funnel (anon session, open
  funnel, gated personal routes) and cart (two items, bundled-shipping
  invariant, sign-in gate at checkout). Specs seed designs owned by the
  browser's anonymous user directly in the dev/preview DB
  (`e2e/helpers/db.ts`, same never-prod guard as the seed script) and clean
  up after themselves. Two projects: mobile (Pixel 7, primary) + desktop.
- ✅ `e2e` job in ci.yml: waits for the Vercel preview deploy, runs Playwright
  against it with the Deployment Protection bypass header. PR-only — note a
  direct push to main never triggers it. Secrets: `VERCEL_AUTOMATION_BYPASS_SECRET`,
  `PREVIEW_DATABASE_URL`, `PREVIEW_DATABASE_AUTH_TOKEN` (set 2026-06-09).
- ✅ `GUEST_FUNNEL_ENABLED`/`CART_ENABLED` added to Vercel Preview scope.
- Local run: `npm run e2e` (boots `next dev -p 3100` with flags on, dev DB).
- Still open: per-PR ephemeral Turso branch (`turso db create prntd-pr-<n>
  --from-db prntd-dev`, seed, run, destroy) — today all PRs share
  `prntd-preview`; fine while PR volume is one-at-a-time.

### Phase 4 — gates + ratchet
- Coverage threshold in `vitest.config` (start at the current baseline, ratchet
  up); fail CI on regressions.
- Branch protection: require `check` + `e2e` + Vercel preview to pass + 1 review.
- Post-deploy prod smoke (extend the existing build-date check into a CI step).

### Phase 5 — observability
- Error tracking (Sentry or Vercel monitoring), Web Analytics / Speed Insights,
  alert on webhook failures (Stripe/Printful) since those are the money path.

## Sequencing
Phase 1 is the biggest unlock for the least effort (preview becomes usable) and
is pure dashboard config — Nico does it. Phase 2 lands in code immediately.
Phase 3 is the real investment. Don't gate (Phase 4) until the suite is stable.

---

## Migration discipline + DB targeting (proposed 2026-06-13, not built)

The above hardened *deploys and tests*. The remaining soft spot is **schema
changes and which DB a command touches** — the thing that caused the past
`design`/`design_image` wipe and the #26 launch 500. Root causes:

1. **`db:push` is the only schema tool.** `drizzle/` has no generated migration
   files. `db:push` diffs `schema.ts` against the live DB and mutates in place —
   a prototyping tool, capable of dropping columns/tables. Fine for the dev
   branch, dangerous for prod.
2. **The `.env.local` comment-toggle dance.** One `DATABASE_URL`; touching prod
   means uncommenting prod lines, running, re-commenting. Stateful and easy to
   leave pointed at prod. Proximate cause of every scare.
3. **Hand-written prod migrations** (`migrate-26-prod.sql` applied via
   `turso db shell`) — unreviewable as a diff, drifts from `schema.ts`.
4. **Branches are `--from-db prntd` snapshots** — they drift, and they copy real
   customer data into non-prod (privacy smell).

### Keystone: versioned migrations

Switch to `drizzle-kit generate` (writes reviewable SQL to `drizzle/`, committed
in the PR) + `drizzle-kit migrate` (applies pending files to a target). Unlocks:

- Prod schema changes become **reviewable diffs in the same PR** as the
  `schema.ts` change — no more hand-authored SQL.
- A fresh dev/preview DB = **empty Turso + replay migrations + `db:seed`**.
  Deterministic, always schema-current, **zero prod data copied** (kills drift +
  the privacy smell).
- The #26 launch gotcha (flag-dependent code shipped before its schema) becomes
  structurally impossible — schema and code land together.

`db:push` survives **only** against `prntd-dev` for fast local iteration.

### Baseline mechanics (the part to get right — "discuss first")

Adopting migrations on an existing DB needs a **baseline migration 0000** that
represents the schema as it already exists in prod, marked already-applied so
`migrate` doesn't try to recreate existing tables. Sequence:

1. `drizzle-kit generate` with the current `schema.ts` → produces `0000_*.sql`
   (CREATE TABLE for every table) + a `drizzle/meta/` snapshot. This is the
   baseline; commit it.
2. Prod **already has** these tables, so we must NOT run `0000` against prod.
   Instead mark it applied: drizzle tracks applied migrations in a
   `__drizzle_migrations` table. Either (a) `drizzle-kit migrate` against a DB
   where the tables exist will error on CREATE — so we seed the migrations
   ledger manually (insert the `0000` hash) so drizzle considers it done, or
   (b) use drizzle's documented baseline path. **This is the step to verify
   carefully against the installed drizzle-kit version before touching prod** —
   exact command/flag names have changed across versions (per AGENTS.md, read
   `node_modules` docs, don't trust memory).
3. Verify on a throwaway Turso branch first: branch prod → run the baseline +
   marking → confirm `migrate` reports "nothing to apply" and no data moved.
   Only then mark the real prod.
4. From then on, every schema change: edit `schema.ts` → `db:generate` → review
   `000N_*.sql` in the PR → merge → `migrate` runs against prod (CI or one
   command).

**Risk note:** the baseline is the only step that reasons about prod's existing
state. Everything after is additive and safe. Do step 3 (dry-run on a branch)
without exception.

### Kill the dance: explicit targets, immutable dev

- `.env.local` becomes **permanently dev-only** (`prntd-dev`) and literally
  cannot reach prod. Stop editing it.
- Prod/preview creds resolve from 1Password at runtime via a wrapper:
  `DB_TARGET=prod npm run db:migrate` reads `op://dev-secrets/...`, never
  persists. Same for ops scripts:
  `DB_TARGET=prod tsx scripts/clean-chat-envelopes.ts --apply`.
- The secrets hook still gates `op`/prod creds, so a prod-touching run stays a
  **one-line handoff to Nico** — but one clean command, not edit-run-edit.

### Prod migrate via gated CI job (decided 2026-06-13)

Cross-project intel (prompt-lab agent, 2026-06-13, corrected same day): across
the whole portfolio, only **byside** (Neon) and **prntd** (Turso) do
branch-per-env + a real credential boundary.

**What byside actually does** (corrected): its `drizzle-kit migrate` runs only
inside the **e2e job, against the CI Neon branch** (`CI_DATABASE_URL`),
secret-gated, after build / before test. **Prod migration is a manual
`npm run db:migrate`** against the prod URL — no prod migrate step in any
workflow, no `vercel.json`. So byside's prod path is *already* a deliberate human
gate; there is no fire-on-merge behavior anywhere. (Job copyable from the
handoff note `~/src/.handoff/prntd-prompt-lab.md`.)

**Decision for prntd:** two defensible options, both human-gated like byside —
  1. **Manual prod migrate (byside parity, simplest):** keep prod application a
     deliberate `DB_TARGET=prod npm run db:migrate` Nico runs after merge. The
     copyable byside job covers CI-branch/E2E migration only.
  2. **Gated CI prod job (more automation):** a prod-migrate job behind GitHub
     environment protection / required approval, creds via GitHub Secrets (same
     `PREVIEW_*` pattern as E2E). Automation without auto-mutating prod on an
     unreviewed merge.

  Lean (1) to start — it matches the one working portfolio precedent and is
  zero new infra; promote to (2) only if manual application becomes a chore.

**Correction to the intel:** it credits prntd with "versioned migrations" — not
true. `drizzle/` is empty, `db:generate` is unused, the real tool is `db:push`
by hand. prntd nails layers 2 (branch-per-env) and 3 (credentials), the two hard
halves; **layer 1 (migrations) is the gap this section closes.**

**No baseline precedent exists anywhere** — a 2026-06-13 grep of all 35 repos
(`__drizzle_migrations` / already-applied markers) found none; byside and the
rest started clean. **prntd will be the first to baseline Drizzle onto a
populated live DB.** The reference is this doc's own §"Baseline mechanics", not
another repo. byside's job is copyable for steady-state branch testing only.

### Right-sizing the "production" version (discussed 2026-06-13)

The full enterprise treatment (backup snapshot, terraform-provisioned DB, data
re-upload, migration test suite, data-migration tooling) is mostly collapsed by
Turso primitives — keep the cheap high-value parts, drop the ceremony:

- **Keep — revertible backup:** `turso db create prntd-backup-<date> --from-db
  prntd` before any prod migration. One command, instant, free. That is the
  rollback.
- **Keep — migration verification tests:** pre/post `count(*)` per table, assert
  no unexpected row drops and that new columns are nullable/backfilled as
  intended. Cheap, high-confidence. Build this.
- **Drop — terraform:** Turso `--from-db` natively does instantiate-DB +
  copy-data; TF around one Turso DB is ceremony with no payoff (and thin TF
  support).
- **Drop — speculative data-migration tooling:** build it only when a migration
  actually transforms data (a backfill). Additive DDL needs none.

### Ranked (solo dev, low PR volume — don't over-build)

1. **Migrations + immutable dev `.env.local` + `DB_TARGET` wrapper** — core.
   Prevents data loss, kills the dance. Includes the baseline dry-run.
2. **CI prod-migrate on merge** — small once #1 exists; removes Nico from the loop.
3. **Reseed-from-migrations script** — replaces the drifting `--from-db` copies.
4. **Per-PR ephemeral branches (#31)** — defer; shared `prntd-preview` is fine
   at one-PR-at-a-time.

### Cross-project intel — captured 2026-06-13
Folded into "Prod migrate via gated CI job" and "Right-sizing" above. House
pattern across the portfolio: Drizzle Kit versioned migrations + branch-per-env
+ `op://` `.env.tpl` creds. prntd already has the last two; this roadmap adds the
first. Next concrete pull: byside's `drizzle-kit migrate` CI job (conditional on
secret) as the copy-from for prntd's gated prod-migrate job.
