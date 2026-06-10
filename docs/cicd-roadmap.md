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
