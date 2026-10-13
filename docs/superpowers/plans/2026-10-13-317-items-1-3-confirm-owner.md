# #317 items 1 and 3: `/order/confirm` requires the order's owner and shows a "checking" state when Stripe can't be read

Branch `claude/317-items-1-3-confirm-owner`, worktree `.claude/worktrees/317-items-1-3`, base `origin/main` at `5931ba2` (#335 merged). Nico answered 2026-10-13 evening: question 2, a "still checking" line is fine, wording left to Claude; question 3, yes, require the owner. Built subagent-driven: one Sonnet implementer, the controller's gate, an Opus whole-branch review (the issue says items 1 to 3 touch the money path's receipt page: real-DB tests and a review), fix rounds back to the implementer.

## Goal

1. **Item 3.** `/order/confirm?session_id=…` renders an order only for the signed-in real account that owns it. A signed-out visitor, or an anonymous guest session, is sent to `/sign-in?next=<this page's path and query>` and lands back here after signing in. A signed-in account that does not own the order sees the existing "Order not found." screen (no new string; no existence leak). The order read is no longer reachable as a server-action endpoint.
2. **Item 1.** A pending order whose Stripe session cannot be read (the read threw, timed out, or returned a status this code does not know) no longer renders "Order confirmed." with the lines and "Total paid". It renders a neutral "checking" screen with a Reload link and a View orders link.

## Architecture

### Item 3

- New `src/lib/order-receipt.ts` exporting `getOrderReceipt(params: { stripeSessionId: string; viewerId: string })`. It is the body of today's `getOrderBySession` (`src/app/order/confirm/actions.ts`), moved verbatim apart from one change: after `findFirst`, `if (!found || found.userId !== params.viewerId) return null;` (the same test `loadEmbeddedCheckout` makes in `src/lib/embedded-checkout-session.ts:171`). Return shape unchanged: `{ id, status, abandoned, totalPrice, lines }`.
- Delete `src/app/order/confirm/actions.ts`. Its only caller is the page. A plain lib read is never an action endpoint (the reasoning `getCheckoutSessionState`'s docblock already gives for itself). Check `grep -rn getOrderBySession src e2e` is empty afterwards.
- `src/app/order/confirm/page.tsx`: after `await searchParams`, read the session with `auth.api.getSession({ headers: await headers() })` (`@/lib/auth`, `next/headers`, exactly as `src/app/checkout/page.tsx:64` does). If there is no session or `isAnonymousUser(session.user)`, `redirect(withNext("/sign-in", selfPath))` where `selfPath` is `/order/confirm` plus the incoming query string rebuilt from `session_id` and `from` only (`URLSearchParams`), so a buyer whose cookie was lost signs in and lands on the same receipt. `withNext` is in `@/lib/safe-next`; `safeNextPath` keeps the query (`url.search`), and a test must prove the round trip keeps `session_id`. Do the session check before the order read, and only when `sessionId` is present (a bare `/order/confirm` with no id keeps today's "Order not found." for everyone, since there is nothing to protect). Then `getOrderReceipt({ stripeSessionId: sessionId, viewerId: session.user.id })`.
- The `loadFailed` screen (DB read threw) is unchanged: it shows no order data.
- The proxy (`src/proxy.ts`) is not touched: `/order` stays a funnel route. The page's own check is the gate.

### Item 1

- `ConfirmView` in `src/lib/checkout-session-status.ts` gains `| { kind: "checking" }`. `resolveConfirmView` returns it for a pending order when `params.stripe === null` (the read failed or timed out) and for the final fallthrough (a pending order whose session status is none of `complete`, `expired`, `open`). Everything else is unchanged. Update the docblocks that say a failed read renders the normal receipt (the module docblock, `getCheckoutSessionState`'s "null means…" comment, `resolveConfirmView`'s docblock) and the page docblock's line about the Stripe read.
- The page renders `checking` in the same status layout as `processing` / `expired` / `failed` (breadcrumb current "Checkout"), with:
  - heading `Checking your payment.`
  - body `We couldn't confirm it just now. Reload in a moment. A paid order appears under Orders once it's confirmed.`
  - a primary `Reload` as a plain `<a href={selfPath}>` wrapping the `Button` (a full navigation, so the server read runs again; not a `Link`, which may treat a same-URL href as a no-op), then a `View orders` text link to `/orders`.
  These three strings are Claude's (Nico left the wording to Claude). They live inline in the page next to the other status strings, which is where that file keeps them.
- `selfPath` is the same value item 3 uses for `next`.

## Constraints

- No schema change. `npm run db:generate` must print `No schema changes`.
- No new file outside `src/lib/order-receipt.ts`, its test, and the test changes below.
- TDD: write or change the failing test first, then the code.
- Do not edit `src/proxy.ts`, `src/lib/require-user.ts`, `src/lib/safe-next.ts`, `src/lib/embedded-checkout*.ts`, or any `"use server"` file other than deleting `src/app/order/confirm/actions.ts`.
- The secrets hook blocks any shell command whose text contains the literal `process.env`. Use the Edit tool for code; grep for other tokens.
- Commit trailer on every commit: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Run from the worktree: `npx vitest run <files>`, `npx eslint <files>`, `npx tsc --noEmit`. `npm run build` does not work in a worktree (symlinked `node_modules`); the controller builds.

## Tests

1. `src/lib/__tests__/order-receipt.integration.test.ts` (real in-memory DB: `src/lib/__tests__/test-db.ts`, factories in `src/lib/__tests__/factories.ts`; look at `src/lib/__tests__/embedded-checkout-session.integration.test.ts` for how an order with a `stripeSessionId` and order items is seeded):
   - the owner gets `{ id, status, abandoned, totalPrice, lines }` with one line per `order_item`;
   - another user id gets `null` for the same session id;
   - an unknown session id gets `null`;
   - `abandoned` is true when `abandoned_at` is set.
2. `src/lib/__tests__/checkout-session-status.test.ts`:
   - change "is confirmed when the Stripe read failed (stripe is null)" to expect `{ kind: "checking" }`;
   - change "is confirmed for an unexpected Stripe status" to expect `{ kind: "checking" }`;
   - a non-pending order with `stripe: null` stays `{ kind: "confirmed", paidTotal: null }` (existing test, keep);
   - update the exhaustive matrix's expectations for `read=failed` and `session=null` on a pending order.
3. `src/app/order/confirm/__tests__/confirm-page.test.tsx` (mock `@/lib/auth` and `next/navigation`'s `redirect` the way `src/app/checkout/__tests__/page.test.tsx:24-40` does; the mocked `redirect` throws so the page stops):
   - a signed-out visitor with a `session_id` is redirected to `/sign-in?next=` whose decoded `next` is `/order/confirm?session_id=cs_1&from=%2Fcart` (assert on the string, and assert `safeNextPath(next)` returns it unchanged);
   - an anonymous session is redirected the same way;
   - a signed-in real user: `getOrderReceipt` is called once with `{ stripeSessionId: "cs_1", viewerId: <that user's id> }`;
   - `getOrderReceipt` returning `null` renders "Order not found.";
   - no `session_id` at all: no session read, no redirect, "Order not found.";
   - pending order, `getCheckoutSessionState` resolves `null`: heading "Checking your payment.", the body line, a `Reload` link whose `href` is `/order/confirm?session_id=cs_1&from=%2Fcart` when `from=/cart` was in the query, a "View orders" link, and no "Total paid" and no "Order confirmed.";
   - every existing test still passes with the new auth mock returning a real user whose id matches the seeded order (adjust fixtures as needed).
4. `grep -rn "getOrderBySession" src e2e` is empty.

## Gate (controller)

`npm run lint`, `npm run typecheck`, `npm test`, `npm run db:generate` prints `No schema changes`, `npm run build` in the main checkout with CI's dummy env.

## Report format (in the reply, not a file)

Status `DONE` or `DONE_WITH_CONCERNS`; commits; files changed; test counts for the touched files; eslint and tsc results; every departure from this plan with its reason; anything found that this plan did not foresee.

## Task 1: item 3 (lib move, page gate, tests)

Tests 1, 3 (the ownership and redirect cases), 4. Commit.

## Task 2: item 1 (checking state, tests)

Tests 2, 3 (the checking case). Commit.
