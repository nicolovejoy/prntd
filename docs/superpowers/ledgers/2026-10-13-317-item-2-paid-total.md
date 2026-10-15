# Ledger: the receipt's "Total paid" is what Stripe charged (#317 item 2)

Plan: `docs/superpowers/plans/2026-10-13-317-item-2-paid-total.md`. Branch `claude/317-item-2-paid-total`, base `548ce4b` (origin/main). Built 2026-10-13 (Nico present, asked for the smokes and to "keep working SDD"). One Sonnet implementer for the slice, the controller's CI gate, one Opus whole-branch review. Every ruling below is Claude's.

## Preflight rulings

1. **Scope.** Build #317 item 2 alone (item 5 is its own slice the same day; items 1 and 3 wait on Nico's answers to questions 2 and 3 on the issue; item 7 is unreachable). Cost if wrong: a second small PR.
2. **The total comes from the existing Stripe read, not a second call.** `getCheckoutSessionState` already retrieves the session for every pending order; it gains `amountTotal`. Cost if wrong: none measurable; the field is on the object Stripe already returns.
3. **Only a pending, complete and settled session supplies the number.** A non-pending order prints its stored `totalPrice` (the webhook reconciled it from the same `amount_total`); a failed read or a missing `amount_total` falls back to the stored total, as today. Cost if wrong: a stale pre-discount figure on a receipt in a state that already shows one today.
4. **No discount line.** The receipt prints the right total and nothing new; the discount itself is not shown (it is not shown for paid orders either). Cost if wrong: a buyer with a code sees a smaller total with no line explaining it; the Stripe form they just left showed the code.
5. **Dollars are `amount_total / 100`**, the webhook's own expression, so the receipt and the row agree to the cent once the webhook runs. Cost if wrong: a one-cent disagreement between the receipt and `/orders`.

## Conflict scan

- The sibling slice (#317 item 5, `claude/317-item-5-return-origin`) edits `src/lib/embedded-checkout.ts` and the three actions that call `resolveReturnOrigin`. This slice edits `src/lib/checkout-session-status.ts` and `src/app/order/confirm/page.tsx` plus their tests. No file in common.
- `src/app/checkout/__tests__/page.test.tsx` mocks `getCheckoutSessionState`? To check in review: any mock of `CheckoutSessionState` outside this slice's file list that `toEqual`s the whole object.

## Progress

- Implementer (Sonnet): DONE in two commits (`5116dbd`, `676375c`), no deviations. Controller's gate on `676375c`: lint 0 errors, typecheck clean, 263 files / 4145 tests, no schema change.
- Opus whole-branch review of `676375c`: READY, nothing Blocking or Important. Three Minor: (1) the page docblock overclaimed ("the total comes from the Stripe read, not the row" is false when the read fails or carries no `amount_total`; `status` is also webhook-written; "That keeps…" lost its antecedent); (2) a test title listed fewer fields than it asserts; (3) outside the slice: on a Preview (no webhook) `/orders` shows the stored pre-discount total after `STALE_PENDING_MS`, so the receipt and `/orders` can disagree for an order the webhook never recorded. It ran the full suite, typecheck, eslint and a 0 to 10,000,000-cent rounding sweep (0 mismatches) itself. Agreed with all five rulings.
- Review round (`80a0106`, comments and a test title, by the controller): the docblock names the three webhook-written fields the receipt reads and states the fallback. Two touched test files 539 passed; eslint and tsc clean on the branch. Build exit 0 on `80a0106`. PR #335 opened; the real-Stripe e2e was dispatched on the branch (run 38444601656). The out-of-slice finding (Preview `/orders` versus receipt) is recorded on #317. The e2e passed. Combined tree of main `548ce4b` + #331 + #335 + #336: clean merge, 263 files / 4155 tests, build exit 0.
