# CI/CD + dev-cycle roadmap

Goal: a real preview → prod cycle where every PR is automatically built,
deployed to an isolated preview with a seeded DB, exercised by E2E tests, and
gated on all-green before it can reach prod.

## Where we are (2026-06-09)

- **CI** (`.github/workflows/ci.yml`): lint → typecheck → test+coverage → build,
  on every PR + push to main. Solid baseline. Coverage measured, not gated.
- **Vercel**: preview deploy per PR; prod on merge to main.
- **DB isolation**: `prntd-dev` Turso branch for local dev (#27); prod separate.
  Preview deploys currently point at **prod** Turso (risk) and miss Preview-scope
  API keys (ANTHROPIC/REPLICATE Production-only → `/design` 500s on preview).
- **Tests**: unit + real-DB integration (in-memory libSQL from live schema).
  No automated browser E2E — done by hand via Playwright today.
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

### Phase 3 — E2E in CI (code + infra)
- Add `@playwright/test`; port today's hand-run flows (guest funnel claim, cart
  → bundled shipping → checkout gate) into `e2e/`.
- Run E2E against the Vercel preview URL in a `e2e` GitHub job (after deploy),
  or against `next build && next start` with a seeded ephemeral DB.
- Per-PR ephemeral Turso branch: `turso db create prntd-pr-<n> --from-db prntd-dev`,
  seed, run, destroy. Keeps E2E hermetic.

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
