# Sales tax policy (Phase 1 / 1C)

Decided 2026-06-06, implemented 2026-06-07. PRNTD does **not** collect sales
tax from customers right now.

## Why

We are not registered to collect/remit sales tax in any jurisdiction. Charging
tax we can't remit creates a liability and a refund obligation, so until
registration is in place we collect none.

## How it works today

- **No customer-facing tax.** Stripe `automatic_tax` is **off**. The customer
  pays item + shipping only (`computeOrderTotal`). Nothing on the checkout page
  or `/order` shows a tax line.
- **Printful's fulfillment tax sits in COGS.** Printful charges us tax on the
  fulfillment invoice; that amount is already inside `printfulOrder.costs.total`,
  which becomes the `cogs` ledger entry. So the tax we actually pay is captured
  as a cost, not surfaced to the customer.
- **`order.taxCollected` exists but stays null.** Reserved for the day we
  register and collect. No backfill.
- **`sale` = item + shipping, never tax.** `recordSale` records the amount
  charged (item + shipping). If collection is ever enabled, tax must be a
  separate pass-through ledger type, **excluded from profit** —
  `summarizeLedger` (`src/lib/ledger.ts`) already excludes any non
  sale/refund/stripe_fee/cogs type from `grossProfit`, and a test locks that.

## If we register later (not done)

1. Turn on Stripe `automatic_tax` (or compute tax server-side).
2. Add a `tax` ledger type; persist Stripe's collected tax to
   `order.taxCollected` from the webhook.
3. Keep `tax` out of `grossProfit` everywhere (it's a liability we remit).
4. Add a remittance/report path.
