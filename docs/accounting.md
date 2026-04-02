# PRNTD Accounting Architecture

## Principles

1. **Append-only ledger** — financial entries are never mutated or deleted. Corrections are new entries (reversals). This is GAAP's core requirement.
2. **Operational data is separate from financial data** — the `order` table tracks fulfillment state. The `ledger_entry` table tracks money. They reference each other via `orderId`.
3. **Classification for financial categorization, tags for supplementary metadata** — each order has a single `classification` (the financial nature of the transaction) and optional freeform `tags` (supplementary metadata like `friend`, `repeat`).
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
- Refund events (Stripe refund API not wired up yet)
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

### Order Classification

Single-select `classification` column on the `order` table. Every order has exactly one classification representing its financial nature. Defined in `src/lib/order-classification.ts`.

| Value | Meaning | Revenue? | Accounting treatment |
|-------|---------|----------|---------------------|
| `customer` | Real third-party paid order | Yes | Revenue + COGS + Stripe fees |
| `sample` | Founder order to check quality/photograph | No | COGS as business expense |
| `test` | Pipeline verification, bogus, immediately canceled | No | No financial impact |
| `owner-use` | Founder bought for personal use | No | Owner's draw |

Future (defined in code, not yet in UI): `gift`, `comp`, `replacement`, `return`, `exchange`, `wholesale`.

Classification affects reporting: the admin financial summary can filter by classification (e.g., show only customer revenue). Classification does not affect the ledger — a test order still generates real ledger entries if real money moved.

New orders from Stripe checkout are auto-classified as `customer`. The admin can reclassify later.

### Order Tags (supplementary)

Freeform JSON array on the `order` table for supplementary metadata. No predefined values — the admin types whatever is relevant per order (e.g., `friend`, `repeat`, `photo-shoot`).

Tags do not affect financial calculations or reporting. They exist for organizational context only.

## Stripe Fee Calculation

Stripe charges 2.9% + $0.30 per successful card charge (US domestic).
For a $27.11 order: `$27.11 * 0.029 + $0.30 = $1.09`

We calculate and record this as a ledger entry at payment time. The exact fee is also visible in Stripe's dashboard if we need to reconcile.

## Export to hledger (future)

Script reads `ledger_entry` + `order.classification` → generates `.journal` file:

```
2026-03-28 Order 617dd9da (shipped) ; classification:customer
  Income:Sales                        -$27.11
  Expenses:COGS                        $18.17
  Expenses:StripeFees                   $1.09
  Assets:Stripe                        $26.02
  Assets:Cash                         -$18.17  ; Printful CC charge

2026-03-28 Order 5d0e12d6 (canceled) ; classification:test
  Income:Sales                        -$19.47
  Expenses:StripeFees                   $0.86
  Assets:Stripe                        $18.61
  ; TODO: refund pending
```

## What's Built vs Planned

### Built
- [x] `ledger_entry` table — append-only financial journal
- [x] Auto-generate ledger entries on payment (sale + stripe_fee)
- [x] Auto-generate COGS entry on Printful submission
- [x] Auto-generate reversal entries on cancellation
- [x] Order classification system (customer/sample/test/owner-use)
- [x] Composable filter/sort on admin page (multi-select classification, archived, sortable columns)
- [x] Client-side financial summary computed from ledger + order-table fallback
- [x] Order detail page (`/admin/orders/[id]`) with ledger timeline
- [x] Freeform tags for supplementary metadata

### Planned (future sessions)
- [ ] Admin refund flow (Stripe API + ledger entry)
- [ ] hledger export script
- [ ] Monthly P&L report in admin
- [ ] Track AI generation costs as expenses
- [ ] Track hosting/infrastructure costs
- [ ] Stripe fee reconciliation against actual Stripe data
