# PRNTD Accounting Architecture

## Principles

1. **Append-only ledger** — financial entries are never mutated or deleted. Corrections are new entries (reversals). This is GAAP's core requirement.
2. **Operational data is separate from financial data** — the `order` table tracks fulfillment state. The `ledger_entry` table tracks money. They reference each other via `orderId`.
3. **Tags over enums** — orders get flexible tags (`test`, `gift`, `promotional`, `customer`) rather than rigid status categories. Tags evolve as the business evolves.
4. **Double-entry ready** — each ledger entry has a `type` that maps to an account. When we export to hledger, types become account names.

## Current Financial Flow

```
Customer pays (Stripe Checkout)
  → Stripe takes ~2.9% + $0.30 fee
  → Net deposited to Nico's Stripe balance
  → Order submitted to Printful
  → Printful charges Nico's credit card directly (not through Stripe)
  → Shirt printed and shipped
```

### What we track today
- `order.totalPrice` — what the customer was charged
- `order.printfulCost` — what Printful charged us (from their API)
- `order.stripePaymentIntentId` — reference for refunds

### What we don't track yet
- Stripe processing fees per transaction
- Refund events
- Promotional/test classification
- AI generation costs as a business expense (Replicate, Anthropic)
- Hosting costs (Vercel, Turso, R2, Resend)

## Data Model

### `ledger_entry` table (new)

Append-only log of all financial events.

| Column | Type | Description |
|--------|------|-------------|
| id | text PK | UUID |
| orderId | text FK nullable | Links to order (null for non-order entries like subscriptions) |
| type | text | Entry type (see below) |
| amount | real | Positive = money in, negative = money out |
| currency | text | Always "USD" for now |
| description | text | Human-readable description |
| metadata | JSON | Flexible extra data (Stripe fee %, Printful invoice ID, etc.) |
| createdAt | timestamp | When the entry was recorded |

### Entry Types

| Type | Sign | Account (hledger) | When Created |
|------|------|-------------------|--------------|
| `sale` | + | Income:Sales | Stripe payment confirmed |
| `stripe_fee` | - | Expenses:StripeFees | Stripe payment confirmed (calculated) |
| `cogs` | - | Expenses:COGS | Printful order submitted (from API cost) |
| `refund` | - | Income:Sales (reversal) | Refund issued |
| `refund_cogs_reversal` | + | Expenses:COGS (reversal) | Canceled before production |
| `generation_cost` | - | Expenses:AIGeneration | Future: per-generation Replicate cost |

### Order Tags

Flexible JSON array on the `order` table. Examples:
- `["customer"]` — real paying customer
- `["test"]` — development/QA order
- `["gift"]` — bought for someone, no expectation of payment
- `["promotional"]` — free/discounted for marketing
- `["founder"]` — Nico's own orders

Tags affect reporting but not the ledger. A test order still generates real ledger entries (real money moved). The tags let you filter reports: "show me only customer revenue" or "how much did I spend on test orders?"

## Stripe Fee Calculation

Stripe charges 2.9% + $0.30 per successful card charge (US domestic).
For a $27.11 order: `$27.11 * 0.029 + $0.30 = $1.09`

We calculate and record this as a ledger entry at payment time. The exact fee is also visible in Stripe's dashboard if we need to reconcile.

## Export to hledger (future)

Script reads `ledger_entry` + `order.tags` → generates `.journal` file:

```
2026-03-28 Order 617dd9da (shipped) ; :customer:
  Income:Sales                        -$27.11
  Expenses:COGS                        $18.17
  Expenses:StripeFees                   $1.09
  Assets:Stripe                        $26.02
  Assets:Cash                         -$18.17  ; Printful CC charge

2026-03-28 Order 5d0e12d6 (canceled) ; :test:
  Income:Sales                        -$19.47
  Expenses:StripeFees                   $0.86
  Assets:Stripe                        $18.61
  ; TODO: refund pending
```

## What's Built vs Planned

### Built (this session)
- [x] `ledger_entry` table in schema
- [x] `tags` JSON column on order table
- [x] Auto-generate ledger entries on payment (sale + stripe_fee)
- [x] Auto-generate COGS entry on Printful submission
- [x] Auto-generate reversal entries on cancellation
- [x] Admin UI: tag orders, view ledger entries
- [x] Exclude canceled orders from financial summary

### Planned (future sessions)
- [ ] Admin refund flow (Stripe API + ledger entry)
- [ ] hledger export script
- [ ] Monthly P&L report in admin
- [ ] Track AI generation costs as expenses
- [ ] Track hosting/infrastructure costs
- [ ] Stripe fee reconciliation against actual Stripe data
