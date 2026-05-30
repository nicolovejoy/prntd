# Test orders + accounting visibility — proposal

Direction set 2026-05-30 after the buy-existing e2e run, where a test order
wrote real-looking `sale`/`cogs` ledger entries and had to be hand-classified
`test` afterward. This is a plan to make test orders safe-by-default — not yet
built.

## Problem (verified in code)

- **No auto-detection.** `StripeSessionData` (`src/lib/webhook-handlers.ts`)
  carries no `livemode`, so the webhook can't tell a test payment from a real
  one. Marking an order `test` is a manual `/admin` step that's easy to forget.
- **Default financials include test.** `getFinancialSummary()` with no filter
  sums *every* ledger entry (`src/app/admin/actions.ts`). Until an order is
  classified `test`, its `sale`/`cogs` inflate revenue and COGS in the default
  view. You can filter *to* a classification, but the default is "everything."
- **No visual marker.** Nothing badges a test order in `/orders` or `/admin`,
  so they read as real at a glance.
- **Today's residue.** Order `2ade8478` is classified `test` but its `sale`/
  `cogs` entries are still in the ledger.

## Goals

- Test orders never pollute revenue/COGS reporting — by default, no opt-in.
- Zero manual steps to mark an order as test.
- Test orders clearly visible/badged.
- Ledger stays honest (append-only) for real money.

## Recommended method

1. **Auto-classify by Stripe `livemode`.** Add `livemode` to `StripeSessionData`
   (the route already has the Stripe event; test sessions are `livemode:false`
   / `cs_test_…`). In `handleStripeCheckoutCompleted`, when `!livemode` set
   `order.classification = "test"`. No manual step.
2. **Don't write ledger entries for test orders.** Skip `recordSale` /
   `recordStripeFee` / `recordCOGS` when the order is `test`. A test payment is
   not a real economic event, so omitting it isn't a GAAP "deletion" — it keeps
   the ledger purely real money. (Alternative if you'd rather record everything:
   keep the writes but make `getFinancialSummary` exclude `test`-classified
   orders by default. More moving parts; I lean toward skipping the writes.)
3. **Exclude `test` from the default financial summary** regardless of (2), as
   belt-and-suspenders: default view = real orders only; an explicit filter
   surfaces test for debugging. (Today `classificationFilter` filters *to* one
   class; add a default that excludes `test`.)
4. **Badge test orders.** Small "TEST" badge on `/orders` and `/admin` rows +
   detail when `classification === "test"`.

## Running a test order (runbook — replaces ad-hoc)

- Local or preview, Stripe **test** keys, `PRINTFUL_DRY_RUN=true`.
- `stripe listen --forward-to localhost:3000/api/webhooks/stripe` running
  **before** paying. If it wasn't up at pay time, replay:
  `stripe events resend <evt_id>` (the event persists in Stripe).
- Test card `4242 4242 4242 4242`, any future expiry / CVC / ZIP.
- Walk `docs/buy-existing-e2e-checklist.md`.
- With auto-classify, no manual classification — just confirm the TEST badge and
  that the financial summary is unchanged.

## One-off cleanup (today's residue)

- Reverse or remove the `sale`/`cogs` ledger entries tied to order `2ade8478`
  (known test). Append-only purists: add reversing entries; pragmatic: delete
  the two rows. Order is already classified `test`; reverting design
  `b7315b39…` from `ordered` is optional.

## Size / sequencing

Small, TDD-able: a pure `livemode → classification` mapping, conditional ledger
writes, a default summary exclusion, and a badge. ~half a day. Ties to existing
pieces: `order.classification` (already has `test`),
`getFinancialSummary(classificationFilter)`, the ledger module, and the
`feedback_test_orders` / `feedback_gaap` memories. Sequence after the homepage
rework (#18) unless a test run is needed sooner.
