# The receipt's "Total paid" is what Stripe charged (#317 item 2): implementation plan

> Built subagent-driven on 2026-10-13: one Sonnet implementer in its own worktree, the controller re-runs the CI gate, one Opus whole-branch review. The ledger with every ruling is `docs/superpowers/ledgers/2026-10-13-317-item-2-paid-total.md`.

**Goal:** `/order/confirm` shows "Total paid" as the amount Stripe charged. Today, for a `pending` order (the common case: the buyer lands before the webhook), the page prints `order.totalPrice`, which is the pre-discount total written at order creation; the webhook later reconciles it to Stripe's `amount_total`. A buyer who used a promotion code sees the undiscounted number on the receipt, and on a Preview deployment (no webhook) it never corrects.

**Source of the work:** https://github.com/nicolovejoy/prntd/issues/317, item 2 (from the #314 adversarial review). Items 1 and 3 wait on Nico's answers; item 4 with 6 shipped as #332; item 5 is its own slice today; item 7 is unreachable.

**Architecture:** `getCheckoutSessionState` already retrieves the session for a pending order. It gains one field, `amountTotal` (cents, `session.amount_total`, null when Stripe reports none). `resolveConfirmView`'s `confirmed` view carries `paidTotal: number | null` (dollars): Stripe's total when the order is pending and the session is `complete` and settled; null in every other confirmed case (a non-pending order, whose `totalPrice` the webhook already reconciled; a failed Stripe read; a session Stripe reports with no `amount_total`). The page prints `paidTotal ?? order.totalPrice`. No schema change. No new user-facing string. One extra field on an existing Stripe read, no extra call.

**Branch and worktree:** `claude/317-item-2-paid-total` at `.claude/worktrees/317-item-2`, off `origin/main` at `548ce4b`.

## Review focus

- The non-pending path must stay zero Stripe calls and print `order.totalPrice` (the webhook-reconciled number).
- Cents to dollars: `amount_total / 100`, the same expression `handleStripeCheckoutCompleted` uses (`src/lib/webhook-handlers.ts:110`), so the receipt and the stored total agree once the webhook runs.
- A `complete` but unpaid session (delayed method) stays the "processing" view; it never prints a total.
- The docblock on `src/app/order/confirm/page.tsx` (lines 17 to 21) says the receipt renders no field the webhook writes. It must say what is true after this change.
- `resolveConfirmView`'s exhaustive matrix test (`src/lib/__tests__/checkout-session-status.test.ts:241`) must keep passing with the new field, and assert it where the matrix can.

---

## Global Constraints

These bind every task. They come from `CLAUDE.md`, `AGENTS.md` and the issue.

1. **No new user-facing string.** The strings on `/order/confirm` stay exactly as they are. If you think a new string is needed, stop and report; do not write one.
2. **No schema change.** `npm run db:generate` must print "No schema changes" and leave `drizzle/` untouched.
3. **Tests:** TDD. Unit tests for the pure helper; the page test is extended, not duplicated. `src/lib/**` tests run under node, not jsdom. Follow the mock shape of the neighbouring test file named in each task.
4. **Do not edit** `src/lib/__tests__/factories.ts`, `src/lib/__tests__/test-db.ts`, `CLAUDE.md`, `AGENTS.md`, or anything under `docs/`.
5. **Stay inside the file list** of each task. If the work needs a file outside it, say so in your report and explain why before (or instead of) editing it.
6. **Server Actions:** a `"use server"` file exports async functions only. Pure helpers live in `src/lib/`.
7. **Lint policy:** no `any` in product code (tests may use it). `catch (err)` and narrow with `err instanceof Error ? err.message : String(err)`.
8. **Comments and docs:** plain statements of what the code does and why. No hyperbole. Update every comment your change makes untrue, including doc comments on functions you touch and comments in other files that describe the behaviour you changed (grep for `Total paid`, `totalPrice`, `renders no field the webhook writes`, `ruling P3`, `getCheckoutSessionState`).
9. **This is Next.js 16.** If you touch anything Next-specific, read the relevant guide in `node_modules/next/dist/docs/` first.
10. **Never read `.env*` files or any secret material.** No network calls. Do not run the dev server. Do not run `npm run e2e` or `npm run e2e:stripe`.
11. **Git:** work only in your worktree, on its branch. Commit per task with a descriptive message ending with the line `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Do not push, do not open a pull request, do not touch other worktrees or branches, do not delete branches.
12. **Do not dispatch subagents.** Review comes from the controller after your report.

## Gate (run before reporting; all four must pass)

```
npm run lint
npm run typecheck
npm test
npm run db:generate
```

`npm test` is the full suite (about 265 files, under two minutes). Run it in the foreground and read the summary line. If a test you did not touch fails, run it again on its own before concluding anything, and report it either way. `npm run build` is not part of your gate (the worktree's `node_modules` is a symlink, which Turbopack refuses); the controller builds.

## Report (in your reply, not in a file)

Under 400 words:

- Status: `DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT` or `BLOCKED`.
- Commits: short sha and subject, in order.
- Gate: the summary line of each of the four commands.
- Files changed, one line each, with what changed.
- Every comment you updated because it had become untrue, and every comment you found that describes the old behaviour and decided to leave (say why).
- Anything you did that the plan did not say, and anything the plan said that you did not do, with the reason.
- Concerns, if any.

---

## Task 1: `getCheckoutSessionState` carries `amountTotal`; the confirmed view carries `paidTotal`

### Files

- `src/lib/checkout-session-status.ts`
- `src/lib/__tests__/checkout-session-status.test.ts`

### The change

`CheckoutSessionState` (`src/lib/checkout-session-status.ts:47`) gains:

```ts
/** `session.amount_total` in cents: what Stripe charged after any
 * discount, the number the webhook writes to `order.totalPrice`
 * (`handleStripeCheckoutCompleted`). `null` when Stripe reported none. */
amountTotal: number | null;
```

`getCheckoutSessionState` sets it from `session.amount_total ?? null`.

`ConfirmView`'s confirmed member becomes `{ kind: "confirmed"; paidTotal: number | null }`:

- `paidTotal` is dollars (`amountTotal / 100`, the webhook's expression) when all of: the order is `pending`, the Stripe read succeeded, `status === "complete"`, and `paymentStatus` is `paid`, `no_payment_required` or null (the existing settled test), and `amountTotal` is not null.
- `null` in every other confirmed return: a non-pending order (its stored total is already reconciled), a null Stripe read, an unexpected Stripe status, a settled session with no `amount_total`.

Doc comments: the type says what `paidTotal` is and when it is null; the function's docblock gets one sentence on it. The module docblock's line "`getCheckoutSessionState` is the one Stripe read this needs" stays true; add that the same read supplies the charged total for the receipt (#317).

### Tests (`src/lib/__tests__/checkout-session-status.test.ts`)

- `getCheckoutSessionState`: the existing "returns status/uiMode/url" test's `toEqual` gains `amountTotal` (give the mocked session `amount_total: 2412` and expect `2412`); a new case with no `amount_total` on the session expects `null`.
- `resolveConfirmView`:
  - pending + `complete` + `paid` + `amountTotal: 2412` → `{ kind: "confirmed", paidTotal: 24.12 }`.
  - pending + `complete` + `paid` + `amountTotal: null` → `paidTotal: null`.
  - pending + `complete` + `no_payment_required` + `amountTotal: 0` → `paidTotal: 0` (zero is a value, not "none").
  - non-pending (`paid`) order with any stripe state carrying `amountTotal: 2412` → `paidTotal: null` (stored total wins once the webhook ran).
  - pending + stripe `null` → `paidTotal: null`.
  - pending + `complete` + `unpaid` → still `{ kind: "processing" }` (no `paidTotal` on that view).
  - Every existing `toEqual({ kind: "confirmed" })` becomes `{ kind: "confirmed", paidTotal: null }` or the right number; do not weaken them to `toMatchObject`.
  - The exhaustive matrix at line 241: keep it exhaustive; where it builds a stripe state, give it `amountTotal` and assert `paidTotal` for the confirmed rows (a number only on the pending + complete + settled rows, null elsewhere).

---

## Task 2: the page prints `paidTotal` when it has one

### Files

- `src/app/order/confirm/page.tsx`
- `src/app/order/confirm/__tests__/confirm-page.test.tsx`

### The change

`src/app/order/confirm/page.tsx`: `view` starts as `{ kind: "confirmed", paidTotal: null }`. In the confirmed render, the "Total paid" value is `(view.kind === "confirmed" && view.paidTotal != null ? view.paidTotal : order.totalPrice).toFixed(2)`; compute it once into a `const totalPaid` above the JSX with a two-line comment: for a pending order the stored total is the pre-discount figure written at creation, so the receipt prints Stripe's charged total; once the webhook has reconciled the row the stored total is that same number (#317).

Docblock (lines 17 to 29): the sentence "which renders no field the webhook writes (ruling P3)" is no longer the whole truth. Rewrite that passage to say: the receipt reads the order row written before the session existed, and one webhook-written field, `abandoned` (as today); for a pending order the total comes from the Stripe read, not the row, because the webhook is what reconciles `totalPrice` to the charged amount. Keep the rest of the docblock.

### Tests (`src/app/order/confirm/__tests__/confirm-page.test.tsx`)

Follow the file's existing `renderConfirm` helper and the `getCheckoutSessionState` mock. Mocked states must now include `amountTotal` (add it to every existing mocked state object so `toEqual`-shaped code elsewhere does not drift; existing assertions are unchanged).

- New: pending order with `totalPrice: 24.12`, flag on, `getCheckoutSessionState` resolves `{ status: "complete", paymentStatus: "paid", uiMode: "embedded", url: null, amountTotal: 1912 }` → the page shows "Order confirmed." and `$19.12`, and does not show `$24.12`.
- New: the same with `amountTotal: null` → `$24.12`.
- New: a `paid` (non-pending) order with `totalPrice: 19.12` → `$19.12` and `getCheckoutSessionState` not called (the existing "no Stripe read" test at line 421 is the model; extend it with the amount assertion if that is simpler than a new case).
- Existing: the "flag on + pending + helper returns null" case (line 351) also asserts `$24.12` (the stored total).

---

## What a reviewer will attack

- A confirmed view built without `paidTotal` anywhere (`view` initial value, the two early returns in `resolveConfirmView`, the fallthrough).
- Rounding: `amount_total / 100` then `toFixed(2)` for values like 1912 and 1005; compare with the webhook's stored value for the same cents.
- The docblock rewrite claiming more or less than the code does.
- The "processing" and "failed" views never printing a total (they do not render the receipt).
