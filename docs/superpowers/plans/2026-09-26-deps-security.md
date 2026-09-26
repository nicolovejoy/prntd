# Dependency security bump (batch 2, slice D2)

Branch `claude/deps-security`, from main `9901586`. Ledger:
`docs/superpowers/ledgers/2026-09-26-deps-security-progress.md`.

## Why

`npm audit` on main (2026-09-26): 30 vulnerabilities (1 low, 13 moderate,
13 high, 3 critical). Critical: `next` (≤ 16.3.2), `better-auth` (≤ 1.6.21),
`vitest` (≤ 4.1.10, dev-only). Nico approved a bump. The `middleware.ts` →
`proxy.ts` rename (slice P) branches from this one.

## Scope

1. `next` 16.2.1 → 16.3.6 and `eslint-config-next` 16.2.1 → 16.3.6, exact
   pins kept. `react`/`react-dom`/`@types/react*` move only if next 16.3.6's
   peer range requires it (it does not: `react ^18.2.0 || ^19.0.0`; we pin
   19.2.4).
2. `npm audit fix` without `--force`. Expected: `better-auth` ≥ 1.6.22,
   `drizzle-orm` ≥ 0.45.2, transitives within their ranges. Never `--force`
   (downgrades drizzle-kit to 0.18, moves vitest). No new major of
   `@anthropic-ai/sdk`.
3. No application code changes unless a bump forces one; a forced change is a
   task with its own implementer + reviewer.

## Tasks

### T1 — bump next + eslint-config-next (controller)

Edit the two exact pins, `npm install`.
Acceptance: `npm ls next eslint-config-next` shows 16.3.6; react stays
19.2.4; lockfile has no other direct-dependency change.

### T2 — `npm audit fix` (controller)

Acceptance: better-auth ≥ 1.6.22, drizzle-orm ≥ 0.45.2; no direct dependency
crosses a major; drizzle-kit stays 0.31.x; `package.json` changes limited to
ranges `audit fix` rewrote (recorded in the ledger).

### T3 — changelog review, Next 16.2.1 → 16.3.6 (fresh `claude -p` sonnet reviewer)

Read the installed `node_modules/next/dist/docs/` (upgrade guide, any 16.3
notes) and next's release notes for 16.2.2 … 16.3.6. Report every change that
touches what we use: `middleware.ts` (matcher, cookies, redirects),
server actions (`"use server"`, error masking), `after()`,
`next/image` (`images.remotePatterns`, `images.qualities`), route segment
config (`dynamic`, `revalidate`, `maxDuration`), metadata files
(`opengraph-image`, `twitter-image`, `robots.ts`), `error.tsx` /
`global-error.tsx` with `unstable_retry`, `instrumentation.ts`
`onRequestError`, `eslint-config-next` rule changes.
Acceptance: a list of findings, each with "affects us: yes/no" and the file
it would affect; any "yes" becomes T5.

### T4 — changelog review, better-auth 1.5.6 → 1.6.x (fresh `claude -p` sonnet reviewer)

Read better-auth's CHANGELOG / release notes for every version between 1.5.6
and the installed one. Report breaking or behavioural changes affecting:
email/password, the `anonymous` plugin + `onLinkAccount` (`src/lib/auth.ts`,
`src/lib/reparent-user.ts`), `session.cookieCache` (5 min), `trustedOrigins`,
the drizzle adapter + schema (`src/db/schema.ts` user/session/account/
verification tables — a new required column would need a migration), and the
client (`src/lib/auth-client.ts`). Explain GHSA-2vg6-77g8-24mp ("stale
sessions persist after user deletion across admin, anonymous, and SCIM
flows"): what the fix does and whether our `onLinkAccount` flow benefits
without code changes.
Acceptance: findings list as in T3; any "yes" becomes T5. `npm run
db:generate` must still print "No schema changes".

### T5 — forced code changes (only if T3/T4 find any)

Implementer (`sonnet`) → task reviewer (`sonnet`) → fix rounds → `haiku`
re-review.

### T6 — whole-branch review (fresh `claude -p` opus reviewer)

Over `git diff origin/main...HEAD` and the files around it. Specifically the
lockfile diff: any surprise major bump of a transitive or direct dependency,
duplicated copies of react / next / better-auth / drizzle-orm, packages that
disappeared.

## Gate (controller runs it)

- `npm run lint` (0 errors)
- `npm run typecheck`
- `npx vitest run`
- `npm run build` with the CI dummy env
- `npm run db:generate` prints "No schema changes"
- `npm audit`: every remaining advisory recorded in the ledger with one line
  of why it stays.

## e2e at risk

Everything auth-shaped (better-auth minor + next middleware): `guest-funnel`,
`cart`, `store-compose`/signed-in helper specs, `landing`.
