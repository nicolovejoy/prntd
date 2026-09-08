# /orders follow-ups: hide unpaid pending orders, drop the header "New Design" button

**Source:** Nico's 2026-09-08 smokes on #229 (CLAUDE.md "Prod smokes 2026-09-08"). No spec doc; this plan is the spec.

## Context

`/orders` (`src/app/orders/page.tsx` → `getUserOrdersData` in `src/lib/user-orders.ts` → `OrdersList` in `src/app/orders/orders-list.tsx`) lists every `order` row owned by the buyer. Checkout (`createStripeCheckoutForOrder` in `src/app/order/actions.ts`, `checkoutCart` in `src/app/cart/actions.ts`) inserts the `order` row with `status = "pending"` BEFORE the Stripe session is created, and the row stays `pending` until the Stripe webhook flips it to `paid`. So every abandoned or in-flight checkout attempt appears on `/orders` as "Processing". Nico saw an item that was still in his cart listed as an order.

**Ruling (controller, 2026-09-08): hide `pending` rows from the buyer view; do NOT move the insert after Stripe session creation.** Moving the insert would leave a paid Stripe session with no order row if the process died between the two, which is strictly worse than an orphan pending row. Admin (`/admin`) keeps seeing pending rows — that is where `recoverPendingOrderCore` is triggered from. The confirm page (`/order/confirm`) is keyed on the Stripe session id and does not go through `getUserOrdersData`.

Known consequence, accepted: between Stripe redirecting the buyer back and the webhook landing (normally < 2 s), a just-paid order is not yet on `/orders`. The confirm page is the receipt for that window.

## Global Constraints

- `getUserOrdersData` must exclude rows with `status = "pending"` in the SQL `where`, not in JS after the fetch (no wasted `order_item` / identity lookups for hidden rows).
- No schema change. No change to any checkout or webhook code path.
- Real-DB test (the `createTestDb` harness in `src/lib/__tests__/test-db.ts`) for the filter — money-adjacent, so not a mocked-db test.
- The empty-state CTA "Make your first design" → `/studio` on `/orders` stays (ruling W1: `/orders` is behind `requireRealUser`, so `/studio` is right). Only the HEADER button "New Design" goes.
- Persona C copy: no new strings.
- Run `npm run lint`, `npm run typecheck`, and the named test files before each commit.

## Task 1: hide `pending` orders in `getUserOrdersData`

**Files:** `src/lib/user-orders.ts`, `src/lib/__tests__/user-orders.integration.test.ts`.

1. In `getUserOrdersData`, change the `where` to `and(eq(orderTable.userId, buyerId), ne(orderTable.status, "pending"))` (import `and`, `ne` from `drizzle-orm`). Add a short comment above it stating: pending = checkout started but not paid (the row is inserted before the Stripe session exists and only the webhook promotes it), so it is not an order the buyer placed; admin still sees pending rows for recovery.
2. Add two tests to `src/lib/__tests__/user-orders.integration.test.ts`, following the file's existing seeding helpers:
   - `"hides pending orders (checkout started, never paid)"`: seed for one buyer a `pending` order (with an `order_item` row and a non-null `stripeSessionId`, i.e. the Stripe session WAS created) and a `paid` order. Assert the result contains exactly the paid order's id.
   - `"still returns every non-pending status"`: seed one order each in `paid`, `submitted`, `shipped`, `delivered`, `canceled` for one buyer. Assert all five ids come back (order irrelevant).
3. Check `src/app/orders/orders-list.tsx` line ~13: the `pending: "Processing"` label entry becomes unreachable from `/orders`. Leave it in place (the `UserOrder` status type still includes `pending`, and the label map is exhaustive by type); add no comment.

## Task 2: drop the header "New Design" button on `/orders`

**Files:** `src/app/orders/orders-list.tsx`, `src/app/orders/__tests__/orders-list.test.tsx`, `src/app/__tests__/maker-cta-hrefs.test.tsx`.

1. In `orders-list.tsx`, remove the `<Link href="/studio"><Button …>New Design</Button></Link>` from the masthead row. The `<div className="flex items-center justify-between mb-6">` wrapper can become a plain `mb-6` block holding the `<h1>`; keep the `h1` and its class string byte-identical (the masthead test asserts the class). If `Button` / `Link` imports become unused, remove them (the empty-state CTA also uses `Link` + `Button` — check before deleting imports).
2. Delete the test `"points the header New Design link at /studio"` in `orders-list.test.tsx`. Keep `"points the empty-state action at /studio"`.
3. In `maker-cta-hrefs.test.tsx`, delete the test `"/orders header link 'New Design' points at /studio"` and remove item 1 from the docblock's numbered list (renumber the rest). Keep the empty-state test.
4. Add one assertion to `orders-list.test.tsx` (in the masthead test or a new one): rendering `<OrdersList orders={[makeOrder()]} />` yields no link with the accessible name "New Design" (`queryByRole("link", { name: "New Design" })` is null).
