# Plan: a paid order is never abandoned (#327)

Date: 2026-10-13. Branch `claude/paid-clears-abandoned`. One slice, one PR, no schema change, no new copy.

## What is wrong

An order can be marked abandoned (`abandonSessionlessOrder` after a Stripe error, the
`checkout.session.expired` webhook, or a confirmed expiry from `expireEarlierCheckoutSessions`,
#328) and a paid `checkout.session.completed` can still arrive for it. The claim in
`handleStripeCheckoutCompleted` (`src/lib/webhook-handlers.ts`) sets the order paid and books
`sale` and `stripe_fee`, and leaves `abandoned_at` set. Every reader but one treats the order as
paid; `/admin/usage` (`src/app/admin/usage/actions.ts`, the `paidCount`, `paidRevenue` and
`paidWeek` aggregates) excludes it.

## Ruling (Claude, Nico away)

Option 1 from the issue: the paid claim also sets `abandoned_at` to null, so a paid order is never
abandoned and every reader keeps one invariant. `/admin/usage` is not changed; its filter becomes
redundant for paid rows but stays as a guard. Existing Production rows in that state are counted by
a read-only script Nico runs; if the count is non-zero, the fix for them is a follow-up decision.

## Tasks

1. `handleStripeCheckoutCompleted`: add `abandonedAt: null` to the claim's `set`. The claim stays
   conditional on `status = 'pending'` (an abandoned order is still `pending`, so the claim still
   wins). Update the comment above the claim and the module comment in `src/lib/user-orders.ts`
   (around line 15) if it describes abandoned orders in a way this changes.
2. Real-DB integration test, in the existing test file that exercises `handleStripeCheckoutCompleted`
   against the in-memory libSQL (`src/lib/__tests__/test-db.ts`, factories in `factories.ts`): an
   order with `abandoned_at` set receives a paid completion; after it, `status = 'paid'`,
   `abandoned_at IS NULL`, exactly one `sale` and one `stripe_fee` ledger row. A second test: the
   same order, a redelivery after the claim, is `skipped` and changes nothing.
3. `src/app/admin/usage/actions.ts`: no change to the aggregates. Add a test in
   `src/app/admin/usage/__tests__/admin-usage.test.ts` (or the existing usage test) only if one
   does not already pin that a paid order with `abandoned_at` null is counted.
4. `scripts/check-paid-abandoned-orders.ts`: read-only, prints the count of orders with
   `status NOT IN ('pending','canceled') AND abandoned_at IS NOT NULL`, and for each its id,
   status, `created_at`, `abandoned_at`, `total_price`. Uses `DATABASE_URL` and
   `DATABASE_AUTH_TOKEN` from the environment like the other `scripts/check-*.ts` readers. No
   writes.
5. CLAUDE.md: one clause in the Payment flow section ("a paid claim clears `abandoned_at`").

## Fence

Do not change `expireEarlierCheckoutSessions`, `handleStripeCheckoutExpired`, `abandonSessionlessOrder`,
the ledger rows or the fulfilment path. Do not add a UI string. Do not touch `drizzle/`.

## Gate

`npm run lint && npm run typecheck && npm test && npm run build`, then an Opus whole-branch review
and, because the claim is a money-path write, an Opus adversarial review against a real database.
