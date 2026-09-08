# #231 — mark abandoned checkouts via `checkout.session.expired`; surface stranded-paid orders

**Source:** issue #231 (from PR #232's final review). Nico approved the timestamp design 2026-09-08. No spec doc; this plan is the spec.

## Context

Checkout (`createStripeCheckoutForOrder` in `src/app/order/actions.ts`, `checkoutCart` in `src/app/cart/actions.ts`) inserts the `order` row as `pending` before creating the Stripe Checkout Session, then back-fills `stripeSessionId`. Only `checkout.session.completed` is handled (`src/app/api/webhooks/stripe/route.ts`), so an abandoned session leaves a `pending` row forever, indistinguishable from a paid-but-webhook-stranded order. PR #232 hid every `pending` row from `/orders` as a stand-in.

Stripe fires `checkout.session.expired` when a session expires (default 24 h after creation; minimum `expires_at` is 30 minutes after creation) and never for a completed session.

## Design

**Amendment 2026-09-08 (fix wave, whole-branch review):** the numbers below were widened twice more after this plan was written. Final values: `CHECKOUT_SESSION_TTL_SECONDS = 2 * 60 * 60` (2h, `src/lib/checkout.ts`) and `STALE_PENDING_MS = 135 * 60 * 1000` (2h15m, `src/lib/user-orders.ts`) — the TTL is owner-facing (covers an interrupted buyer without leaving the order ambiguous for Stripe's 24h default expiry), the staleness window stays 15 minutes above it for webhook-delivery margin. The shown-pending branch also now requires a non-null `stripeSessionId` (a session-less row could never have been paid) and legacy pre-#231 pending rows are marked abandoned by a one-shot `scripts/mark-legacy-pending-abandoned.ts`, not by aging out on their own. Read the constants' own comments, not the numbers below, as the source of truth.

1. Additive column `order.abandoned_at` (nullable timestamp). No status change; `order-state.ts` transitions untouched.
2. Sessions expire 30 minutes after creation (`expires_at` on both session builders).
3. Webhook handles `checkout.session.expired`: conditional `UPDATE "order" SET abandoned_at = now WHERE id = ? AND status = 'pending' AND abandoned_at IS NULL`. One row updated → `abandoned`; zero → `ignored` (already paid, already marked, or unknown). Always 200.
4. `/orders` shows a `pending` row only when it is NOT abandoned AND older than `STALE_PENDING_MS` (45 minutes: the 30-minute session window plus margin for webhook delivery). Young pending rows stay hidden exactly as today; a pending row that survives the window un-abandoned is a webhook-stranded payment and surfaces as "Processing".

## Global Constraints

- Migration **0013**: exactly one `ALTER TABLE "order" ADD "abandoned_at" integer;` statement. If `drizzle-kit generate` emits a table recreate, STOP and report (the 2026-08-17 recreate hazard: unknown double-quoted columns become string literals). Do not apply the migration anywhere; the controller holds it for Nico. Do not touch PR #201's held migration.
- Every DB assertion is a real-DB test on the `createTestDb` harness (`src/lib/__tests__/test-db.ts`, which derives DDL from `schema.ts`, so the new column is available with no migration file).
- The `checkout.session.expired` branch must never return non-2xx for an unknown order or a non-pending order (repeated 4xx can get the endpoint disabled).
- `expires_at` is a UNIX-seconds integer; the builders are pure, so take `now` as an injectable parameter defaulting to `Date.now()`; never call `Date.now()` inside a test assertion path without injecting it.
- `STALE_PENDING_MS = 45 * 60 * 1000`, exported from `src/lib/user-orders.ts`, with a comment tying it to `CHECKOUT_SESSION_TTL_SECONDS`.
- Persona C copy, no new user-facing strings. `pending: "Processing"` in `src/app/orders/orders-list.tsx` becomes reachable again: drop its `// unreachable from /orders` comment.
- Run `npm run lint`, `npm run typecheck`, and the named test files before each commit; `npm test` once per task.

## Task 1: schema + migration

**Files:** `src/lib/db/schema.ts`, `drizzle/0013_*.sql`, `drizzle/meta/*`.

1. In the `order` table, after `archivedAt` (find it; if there is no `archivedAt`, after `updatedAt`), add `abandonedAt: integer("abandoned_at", { mode: "timestamp" })` with a comment: set by the Stripe `checkout.session.expired` webhook on a still-pending order; a pending row that is old and NOT abandoned is a webhook-stranded payment (see `user-orders.ts` and #231). Nullable, no backfill: legacy pending rows stay null and age out through the `/orders` staleness window.
2. `npm run db:generate` → inspect the SQL. It must be the single ALTER statement above. Commit schema + migration + meta together.
3. Test: extend `src/lib/__tests__/migration-chain.test.ts` or whichever test applies the migration chain to a file-backed libSQL (grep for `0012` in `src/**/__tests__` to find it) so it asserts `abandoned_at` exists on `order` after the chain. If no such test exists, add the column assertion to the nearest schema-derivation test.

## Task 2: session expiry + webhook handler

**Files:** `src/lib/checkout.ts`, `src/lib/__tests__/checkout.test.ts`, `src/lib/webhook-handlers.ts`, `src/app/api/webhooks/stripe/route.ts`, `src/app/api/webhooks/stripe/__tests__/route.test.ts`, a new `src/lib/__tests__/checkout-expired.integration.test.ts`.

1. `src/lib/checkout.ts`: `export const CHECKOUT_SESSION_TTL_SECONDS = 30 * 60;` Both `buildCheckoutSessionParams` and `buildCartCheckoutSessionParams` gain an optional `now?: number` (ms, default `Date.now()`) and set `expires_at: Math.floor(now / 1000) + CHECKOUT_SESSION_TTL_SECONDS`. Unit tests in `checkout.test.ts`: with `now` injected, `expires_at` equals `now/1000 + 1800` for both builders.
2. `src/lib/webhook-handlers.ts`: `export async function handleStripeCheckoutExpired(orderId: string, deps: { db: Db })` (use the file's existing `db` typing) → `Promise<{ action: "abandoned" | "ignored" }>`. Runs the conditional UPDATE from the Design section via Drizzle (`.update(orderTable).set({ abandonedAt: new Date() }).where(and(eq(id), eq(status, "pending"), isNull(abandonedAt)))`) and reads `rowsAffected` (the file already uses this pattern for the paid-claim, follow it). Do NOT change `handleStripeCheckoutCompleted`.
3. `src/app/api/webhooks/stripe/route.ts`: add an `else if (event.type === "checkout.session.expired")` branch: `orderId = event.data.object.metadata?.orderId`; if missing, log and return 200 `{ received: true, ignored: "no orderId" }`; else call the handler, log `Stripe event ${event.id}: order ${orderId} → ${action}`, return 200. No `stripe.checkout.sessions.retrieve` call is needed (metadata is on the event object).
4. Real-DB tests (`checkout-expired.integration.test.ts`, seed via `src/lib/__tests__/factories.ts`): pending order → `abandoned` and `abandonedAt` set; paid order → `ignored`, untouched; second delivery on an abandoned order → `ignored`, timestamp unchanged; unknown order id → `ignored`.
5. Route test (`route.test.ts`, following its existing real-signature pattern): a signed `checkout.session.expired` event with `metadata.orderId` → 200 and the order row is abandoned; the same event without metadata → 200.

## Task 3: `/orders` reader

**Files:** `src/lib/user-orders.ts`, `src/lib/__tests__/user-orders.integration.test.ts`, `src/app/orders/orders-list.tsx`, `src/app/order/confirm/page.tsx` (docblock only).

1. `export const STALE_PENDING_MS = 45 * 60 * 1000;` with the comment from Global Constraints. `getUserOrdersData(buyerId, now = Date.now())`. Replace `ne(orderTable.status, "pending")` with `or(ne(status, "pending"), and(isNull(abandonedAt), lt(createdAt, new Date(now - STALE_PENDING_MS))))`. Rewrite the comment above it: young pending = in-flight or not-yet-expired checkout (hidden); abandoned = Stripe said the session expired (hidden); old and not abandoned = paid but the completed webhook never landed (shown as Processing so the buyer has a record; admin Recover fixes it).
2. Tests (real DB, inject `now`): young pending hidden (created 5 min ago); old pending not abandoned SHOWN (created 2 h ago); old pending abandoned hidden; `paid` shown regardless of age. Keep the two tests PR #232 added; adjust the "hides pending orders" one so its pending order is young (`createdAt: now - 1 min`).
3. `orders-list.tsx`: drop the `// unreachable from /orders` comment on `pending: "Processing"`.
4. `src/app/order/confirm/page.tsx` docblock: the sentence added in #232 about `/orders` hiding pending rows now says "hides young pending rows" and names `STALE_PENDING_MS`.
