# Stripe test-mode e2e

One spec — `e2e/stripe-money-path.spec.ts` — that pays through real Stripe
test mode: seed a design, `/preview`, pick size, Order, fill Stripe's hosted
checkout (4242 test card), land on `/order/confirm`, then assert the order row
reaches `submitted` (dry-run Printful) with `sale` + `stripe_fee` ledger rows.

This is the test class that would have caught the 2026-07-19 external_id
incident's siblings: real vendor constraints (Stripe here; Printful stays
dry-run) that mocks can't see. Keep it at exactly one spec.

## Prerequisites

- Stripe CLI installed: `brew install stripe/stripe-cli/stripe`. No
  `stripe login` needed — the script passes `--api-key` from `.env.local`.
- `.env.local` with the dev Turso DB and a **test-mode** `STRIPE_SECRET_KEY`
  (`sk_test_…`). The script refuses live keys.
- Port 3100 free (the script refuses a busy port — a stale server would have
  the wrong webhook secret baked in).

## Run

```
npm run e2e:stripe
```

What the script (`scripts/e2e-stripe.sh`) does:

1. Reads the CLI listener's signing secret (`stripe listen --print-secret`)
   and exports it as `STRIPE_WEBHOOK_SECRET` — the compiled server verifies
   the forwarded event with it (process env beats `.env.local`).
2. Spawns `stripe listen --forward-to localhost:3100/api/webhooks/stripe`
   (only `checkout.session.completed`), killed on exit.
3. Exports `NEXT_PUBLIC_APP_URL=http://localhost:3100` so Stripe's
   success/cancel redirects land back on the server under test,
   `PRINTFUL_DRY_RUN=true` (also forced in `playwright.config.ts` — no local
   e2e can place a real Printful order), a dummy `RESEND_API_KEY` (no real
   order emails), and `E2E_STRIPE=1`.
4. Runs the spec on the mobile project only — one payment per run.

The spec self-cleans: its order + `order_item` + ledger rows, seeded design,
and throwaway account are deleted from the dev DB afterward.

## Gating

The spec is tagged `@stripe` and skips itself unless `E2E_STRIPE=1`, so plain
`npm run e2e` and the PR `check`/`e2e` jobs never run it. It also skips when
`E2E_BASE_URL` is set (that means a Vercel preview, where Stripe redirect URLs
build from `NEXT_PUBLIC_APP_URL` = prod and checkout would bounce off the
deployment under test) and when `STRIPE_SECRET_KEY` isn't `sk_test_…`.

## Nightly CI run (#104)

`.github/workflows/stripe-e2e.yml` runs this spec on a schedule (nightly) and
via manual `workflow_dispatch`. It is intentionally **not** wired into
`pull_request`/`push` — it moves real (test-mode) money through Stripe's
actual hosted checkout DOM, which is third-party flake every PR shouldn't
have to eat.

The workflow installs the Stripe CLI, branches an ephemeral Turso DB off
`prntd-preview` (same mechanism as the per-PR e2e job, #31/#108 — named so it
contains `prntd-preview`, satisfying `e2e/helpers/db.ts`'s never-prod guard),
migrates it, then runs `npm run e2e:stripe` exactly as described above —
`scripts/e2e-stripe.sh` now tolerates having no `.env.local` (CI exports
`DATABASE_URL`/`DATABASE_AUTH_TOKEN`/`STRIPE_SECRET_KEY` as job env instead;
it sources `.env.local` only when the file exists). No `E2E_BASE_URL` is set,
so the spec runs against the workflow's own locally-booted compiled build,
same code path as local — nothing in the spec's skip logic needed to change.

Repo secrets required: `STRIPE_SECRET_KEY` (test-mode) and `TURSO_API_TOKEN`
(already added for #108). On failure the job files/comments on a GitHub issue
labeled `stripe-e2e-nightly` so a red run isn't silent.

## Troubleshooting

- Order stuck at `paid`/`pending` in the poll: the listener isn't forwarding,
  or the server booted with a different `STRIPE_WEBHOOK_SECRET` than the
  listener's. Re-run the script with port 3100 free (fresh boot picks up the
  exported secret).
- Stripe's checkout DOM changes without notice. The spec resolves each field
  through candidate locators (`#cardNumber`, placeholder, label); if a fill
  fails, update the candidates in `completeStripeCheckout`.
