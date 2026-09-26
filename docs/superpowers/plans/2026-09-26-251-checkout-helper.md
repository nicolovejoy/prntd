# #251 — trusted-input helpers out of `"use server"` files

Branch `claude/251-checkout-helper`, from main `9901586`. Migration-free.
Ledger: `docs/superpowers/ledgers/2026-09-26-251-checkout-helper-progress.md`.

## Problem

Every export of a file that starts with `"use server"` is a Server Action
with an action ID. Next's own guidance
(`node_modules/next/dist/docs/01-app/02-guides/data-security.md`, "Security
features"): dead-code elimination keeps unused actions out of client
bundles, but "you should still treat Server Actions as reachable via direct
POST requests and verify authentication and authorization inside each one."

`createStripeCheckoutForOrder` (`src/app/order/actions.ts`) is exported from
such a file. It is the shared order-insert + Stripe-session step behind
`createCheckoutSession`, `buyPublishedDesign` (`src/app/d/actions.ts`) and
`buyStoreProduct` (`src/app/shop/actions.ts`). It takes `userId`,
`itemPrice`, `placements`, `storeId`/`storeProductId` and the rest from its
caller and re-checks none of them. It is safe today only because no client
component imports it; nothing enforces that.

## Audit of every `"use server"` export (done by the controller, 2026-09-26)

Scanned all 13 `"use server"` files under `src/` (plus the two inline
`"use server"` closures in `src/app/admin/published/page.tsx`, which delegate
to guarded admin actions). Exports with no session / ownership check of their
own:

- `createStripeCheckoutForOrder` (`order/actions.ts`) — trusted-input helper:
  takes `userId` and a price from the caller. **Moves.**
- `prefetchProductMockups` (`preview/actions.ts`) — trusted-input helper:
  takes a `designId` from its caller and does no auth or ownership check;
  its only caller is `ensureMockupsPrefetched`, which checks ownership and
  then schedules it with `after()`. As an action, anyone who has its ID can
  start a bulk Printful mockup render and an R2 upload + `design.mockup_urls`
  write for any design. Same class as the issue ("and any other trusted-input
  helper"). **Moves.**
- `calculatePrice` (`order/actions.ts`) — a real entry point
  (`src/app/preview/page.tsx` calls it from the client). Read-only; takes no
  userId or price. Stays. (It returns `computePrice`'s `baseCost` and
  `generationCost` for any design id with no ownership check — an
  information leak, not a trust problem; recorded in the ledger as a
  follow-up, not fixed here.)
- `getOrderBySession` (`order/confirm/actions.ts`) — the Stripe session id is
  the capability, by design (CLAUDE.md). Stays.
- `isMultiPlacementEnabled` (`preview/actions.ts`) — reads an env flag. Stays.
- `getImagePage` (`d/actions.ts`), `getHeaderState`
  (`components/site-header-actions.ts`) — resolve the viewer from the session
  inside. Stay.

Everything else reads the session and checks ownership / admin itself.

## Invariants

1. **No behaviour change.** The moved function bodies are byte-identical
   (docblocks may gain a line on why the function lives in `src/lib/`). Same
   DB writes, same Stripe params, same return values, same logging.
2. The new `src/lib/` modules do **not** start with `"use server"` (and do
   not contain the directive anywhere).
3. Existing tests pass unmodified, except import paths and comments that name
   the old location. In particular: `src/app/order/__tests__/front-pin.integration.test.ts`,
   `src/app/d/__tests__/buy-published-design*.integration.test.ts`,
   `src/app/d/__tests__/get-listing-*mockup.integration.test.ts`,
   `src/lib/__tests__/money-path.integration.test.ts`, the cart tests, and
   `src/app/preview/__tests__/*`.
4. No new dependencies (`server-only` is not installed; not adding it).
5. Migration-free; `npm run db:generate` reports no schema changes.

## Tasks

### Task 1 — move `createStripeCheckoutForOrder` to `src/lib/order-checkout.ts`

- New file `src/lib/order-checkout.ts`, no `"use server"`. Contains
  `createStripeCheckoutForOrder` with its current docblock and param type,
  body byte-identical, plus a short file header: it trusts every input
  (`userId`, `itemPrice`, placements, attribution), so it must never be
  exported from a `"use server"` module (#251); callers own auth, pricing and
  image guards.
- Remove it from `src/app/order/actions.ts`; `createCheckoutSession` imports
  it from `@/lib/order-checkout`. Drop imports that become unused there
  (`orderItem`, `stripe`, `computeOrderTotal`, `buildCheckoutSessionParams`,
  `embeddedCheckoutPath`, `resolveOrderVariant` — whichever are now unused;
  lint decides).
- `src/app/d/actions.ts` and `src/app/shop/actions.ts` import it from
  `@/lib/order-checkout`.
- Update the comment in `src/app/d/__tests__/get-listing-mockup.integration.test.ts`
  and `get-listing-back-mockup.integration.test.ts` that says d/actions
  imports it from order/actions (the `@/lib/stripe` mock stays — the new
  module imports `@/lib/stripe` too).
- Acceptance: `grep -rn createStripeCheckoutForOrder src` shows the
  definition only in `src/lib/order-checkout.ts`; `npm run typecheck`,
  `npm run lint`, and the test files named in invariant 3 pass unmodified
  (apart from those comments).

### Task 2 — move `prefetchProductMockups` to `src/lib/mockup-prefetch.ts`

- New file `src/lib/mockup-prefetch.ts`, no `"use server"`. Contains
  `prefetchProductMockups`, body byte-identical, with the docblock that
  currently sits orphaned above `ensureMockupsPrefetched`'s docblock in
  `preview/actions.ts` ("Issues a single multi-variant Printful task …"),
  plus a line saying it does no auth and callers must check ownership (#251).
- `ensureMockupsPrefetched` imports it; remove the orphaned docblock from
  `preview/actions.ts` and any imports that become unused there.
- Acceptance: definition only in `src/lib/mockup-prefetch.ts`;
  `ensureMockupsPrefetched` behaviour unchanged (still owner-gated, still
  `after(() => prefetchProductMockups(designId, productId))`); typecheck,
  lint and `src/app/preview/__tests__/` pass.

### Task 3 — pin the export lists

- New test `src/app/__tests__/server-action-exports.test.ts`. Uses the
  TypeScript compiler API (`typescript`, already a devDependency) to list the
  **runtime** exports of a source file (function / async function / const /
  let / var / class declarations with `export`, `export default`,
  `export { … }` specifiers that are not `type`-only, `export * from` — the
  last one fails the test outright, since it can't be pinned). Type-only
  exports (`export type`, `export interface`) are ignored.
- Pins, exactly (sorted):
  - `src/app/order/actions.ts` → `calculatePrice`, `createCheckoutSession`
  - `src/app/preview/actions.ts` → its current exports minus
    `prefetchProductMockups`
  - `src/app/d/actions.ts` and `src/app/shop/actions.ts` → their current
    exports (both touched by task 1).
- Also asserts: each of those four files starts with the `"use server"`
  directive (so the pin is testing what it thinks it is), and neither
  `src/lib/order-checkout.ts` nor `src/lib/mockup-prefetch.ts` contains a
  `"use server"` directive, and each exports its helper.
- The failure message says why: a new export from a `"use server"` file is a
  publicly callable endpoint; add it to the list only if it does its own
  auth; trusted helpers go in `src/lib/`.
- Acceptance: the test passes on the branch; the implementer shows it fails
  when `createStripeCheckoutForOrder` is re-exported from `order/actions.ts`
  (mutation check, reverted).

## Gate (controller runs it)

`npm run lint` (0 errors), `npm run typecheck`, `npx vitest run`,
`npm run build` with the CI dummy env, `npm run db:generate` → no schema
changes. Then one Opus whole-branch review that reads every caller of both
moved functions.
