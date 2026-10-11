# Plan review — cart on embedded checkout (2026-10-10)

A Sonnet reviewer read `docs/superpowers/specs/2026-10-10-cart-embedded-checkout.md` and `docs/superpowers/plans/2026-10-10-cart-embedded-checkout.md` against the code on `claude/cart-embedded-checkout` at `b1b5e61` (product code identical to main at `8bf8160`). Read-only; nothing was run. Recorded here by the controlling session from the reviewer's hand-back.

Verdict: READY AFTER EDITS. No blocker. Every file, line number, helper, factory, test id and copy constant the tasks name exists as written, and the test code reads as compilable against the repo's harness. Apply the edits below to the plan before building.

## Findings, most severe first

1. **Should fix. Task 6 Step 4, Step 6; Task 8 Step 5.** "HOLD:" in the title is the only guard against an early merge, merging is live in Production at once, and a HOLD PR in this repo has been merged before its gate three times. Edit: Task 6 Step 4 opens the PR with `gh pr create --draft` (GitHub cannot merge a draft; admin bypass does not change that). Task 8 Step 5 adds `gh pr ready` next to removing "HOLD:". Keep the title prefix as well.

2. **Should fix. Task 7 brief, missing attack vectors.** Add these (under vectors 5 and 13) and tell the reviewer to separate new exposure from existing:
   - `getOrderBySession` (`src/app/order/confirm/actions.ts:9`) is an exported "use server" function with no auth or ownership check. Anyone holding a cart `cs_` id gets every line's artwork URL, size, colour, status and the total. Vector 5 covers only `/checkout`. The cart adds the id to our own URLs. This exposure exists on main today.
   - A redirect-based payment method: the buyer returns on `return_url` unpaid, `/order/confirm` shows "incomplete" with the resume link `/checkout?session=<id>` (no `from`, `src/lib/checkout-session-status.ts:123`). Also session expiry while the embedded form is open.
   - A 100% promotion code gives `payment_status: no_payment_required`. `isSettledPaymentStatus` (`src/lib/webhook-handlers.ts:71`) accepts it, so the cart claim path runs with a zero-amount session. Vector 12 does not name it.
   - `checkoutCart` has no rate limit (no quota call anywhere in `src/app/cart/actions.ts`). Each call writes an order and creates a Stripe session that stays payable for two hours. Existing behaviour; ask the reviewer to size the abuse.

3. **Nit. Task 2 Step 3**, the comment inserted above `const appUrl`: "the buyer leaves our origin either way" is wrong for embedded. Replacement: "Hosted checkout always returns to NEXT_PUBLIC_APP_URL: the buyer leaves for Stripe's page, so the building deployment does not matter."

4. **Nit. Task 2 Step 4** leaves a stale sentence: `src/lib/embedded-checkout.ts:5` says "Each buy surface has its own switch", which the cart now contradicts. Change it to "The image detail page and the cart share one switch; /preview has its own". `flags.ts`'s `previewEmbeddedCheckoutFlag` has the same "independently" wording; slice 6a rewrites it, so leave it.

5. **Nit. "Append inside the describe"** is easy to get wrong in two places. Task 1 Step 1: `describe("buildCartCheckoutSessionParams")` is the last block in `checkout.test.ts`, so the cases go before its final `});`. Task 4 Step 2: the new `it`s for `page.test.tsx` go before the final `});` of `describe("CheckoutPage")`, the last line of the file. Add "insert before the closing `});`" to both.

6. **Nit. Handoff to implementers.** Global Constraints mention "Task 7", "Task 8" and "the attribution trailer lines the executing session's own instructions give"; an implementer who sees only its task has neither. The controller pastes the trailer lines into each dispatch. Task 5 Step 4 runs `playwright --list`, and `playwright.config.ts` loads `.env.local` through dotenv: harmless in a worktree with no such file, but say "do not create one".

7. **Nit. Task 8 Step 4, the smoke, step 1** says "In the Studio, tap the first result, tap Order, pick size M, tap Add to cart." On the focused stage Order is a link to the image detail page (`src/app/studio/focused-stage.tsx:124`, `order: true`), so the panel is already open on arrival. Edit: "tap the Order link under the big image; on the page that opens, pick size M and tap Add to cart". Same for step 2.

8. **Nit. Task 9 Step 1** says "run the command from there" (a scratch directory). Use `--body-file` with the absolute scratch path; the shared-shell rule is to avoid `cd`.

## Checked and found correct

- Task 1: `src/lib/checkout.ts:114-175` and its docblock match; `cartBase` and `CHECKOUT_SESSION_TTL_SECONDS` exist in `checkout.test.ts`; Stripe 20.4.1's types confirm `cancel_url` and `success_url` are not allowed with `ui_mode: embedded` and `return_url` is accepted.
- Task 2: line anchors in `src/app/cart/actions.ts` are exact (`:601-607`, `:615`, `:645`, `:673-677`); `headers` is already imported; `embeddedCheckoutConfig`, `embeddedCheckoutFlag`, `embeddedCheckoutPath`, `resolveReturnOrigin` exist with the stated signatures; the new test file's mock set matches the working `update-cart-item` test; every expected PASS and FAIL in Step 2 holds when traced; `makeSourceImage` with `publishedAt` creates the mirror product `requireMirrorProduct` needs.
- Task 3: the `window.location` stub is the pattern at `buy-panel.test.tsx:1193-1230`; the button reads "Redirecting…" while checking out, so there is no race; `CHECKOUT_FAILED` is the exact text in the smoke's FAIL line; the pre-change unhandled rejection in the third new test is real.
- Task 4: docblock and class-string line numbers are exact (`src/app/checkout/page.tsx:26-33`, `:166-185`; `checkout-line.tsx:22`, `:61-66`); the loader expectations check out; `md:aspect-square` is pinned at `page.test.tsx:261` and `checkout-line.test.tsx:64`; `checkout-preview` is used nowhere else except the e2e spec.
- Task 5: spec line anchors are right (`e2e/stripe-money-path.spec.ts:280`, `:431`, `:453-454`); `cartItemsForUser` exists in `e2e/helpers/db.ts` and is not yet imported; `stripe-e2e.yml` and the docs anchors match; the webhook cleanup deletes both cart lines on paid, so the cart-emptied poll is sound.
- No other test breaks: the seven cart tests the plan lists run with the switch unset; CI sets no embedded env; the guards `no-preview-links`, `server-action-exports` and `no-preselection-price` are untouched.
- Neither document contains a price literal. The smoke is self-contained and PASS and FAIL are decidable from the address bar and page text.
- Rollback claims hold: the switch off 404s `/checkout`, `/order/confirm` ignores the switch, and the expired webhook abandons stranded orders.
- Cross-task seams agree (`uiMode`, `checkout-review`, `compact`, the `/cart` path); no two tasks edit the same file.

## Could not determine

- Whether `CART_ENABLED` is set in Vercel's Preview scope (the plan's open question 5).
- Whether the dispatched Stripe e2e passes first time: Stripe's embedded DOM with two line items has not been exercised.
- Whether the tie order on `ORDER BY created_at` is stable on Turso's remote path; the new loader test pins it only on in-memory libSQL.
- Whether a Vercel Deployment Protection prompt will interrupt the Preview smoke.
