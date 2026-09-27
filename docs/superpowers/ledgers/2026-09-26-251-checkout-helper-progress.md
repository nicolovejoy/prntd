# #251 — trusted-input helpers out of `"use server"` files — progress ledger

Plan: `docs/superpowers/plans/2026-09-26-251-checkout-helper.md`.
Branch `claude/251-checkout-helper`, from main `9901586`. Controller: Opus.
Implementers and task reviewers: `claude -p --model sonnet`; scoped
re-reviews `haiku`; whole-branch review `opus`.

## Rulings (controller)

1. **Scope of "any other trusted-input helper".** The brief's grep hint
   (exports taking a `userId` or a price) finds only
   `createStripeCheckoutForOrder`. A guard scan of all 13 `"use server"` files
   found one more export with no auth of its own that exists only to be
   called by trusted code: `prefetchProductMockups` (`preview/actions.ts`),
   callable by anyone with its ID to trigger a bulk Printful render + R2 + DB
   write on any design. The issue text says "and any other trusted-input
   helper", so it moves too (task 2). Judgment call, flagged.
2. **`calculatePrice` stays.** It is a client-called entry point
   (`/preview`), read-only, and takes no userId or price. It does leak
   `baseCost` and `generationCost` for any design id with no ownership check.
   That is an information leak, not the trust problem #251 is about; not
   fixed here (no scope added). Follow-up candidate.
3. **No `server-only` package.** Not installed; adding a dependency is out of
   scope. The moved modules import `@/lib/db` / `@/lib/stripe`, which would
   not work in a client bundle anyway, and the pin test (task 3) guards the
   `"use server"` side.
4. **Tasks 1 and 2 ran in parallel** (disjoint files).

## Tasks

### Task 1 — `createStripeCheckoutForOrder` → `src/lib/order-checkout.ts` (`aa24658`)

Implementer (sonnet): copied the function with `sed`, so docblock, param
docs and body are byte-identical (controller re-diffed: identical). Dropped
the seven imports that became unused in `order/actions.ts`; d and shop
actions import from `@/lib/order-checkout`; two test comments renamed the
location. 46 files / 453 tests green (controller re-ran).

Review (sonnet): one Minor — the new module's header comment contains the
quoted phrase `"use server"`, which a substring-based check would trip.
**Ruling: keep.** It is a comment, not a directive; the task 3 check parses
the file and matches only string-literal expression statements, and the
repo's usual `grep '^"use server"'` doesn't match a line starting with `//`.

### Task 2 — `prefetchProductMockups` → `src/lib/mockup-prefetch.ts` (`ec6f31e`)

Implementer (sonnet): body copied with `sed` (controller re-diffed:
identical); the orphaned docblock above `ensureMockupsPrefetched` moved with
it, plus "Does no auth or ownership check on designId; callers must do it
(#251)". Six unused imports dropped from `preview/actions.ts`.
`ensureMockupsPrefetched` unchanged.

Review (sonnet): one Minor — five design/designs integration tests still
`vi.mock("@/app/preview/actions", { prefetchProductMockups })`.
**Ruling: leave.** Those mocks were already dead before this branch
(`design/actions.ts` at `9901586` imports nothing from `preview/actions`), and
the slice brief allows test edits only for import paths. Follow-up cleanup
candidate.

### Task 3 — export-list pin test (`b628527`)

`src/app/__tests__/server-action-exports.test.ts`: TypeScript-parser export
lister; pins `order/actions.ts` (`calculatePrice`, `createCheckoutSession`),
`preview/actions.ts` (6), `d/actions.ts` (7), `shop/actions.ts` (3); checks
each starts with the directive; checks both new lib modules export their
helper and contain no directive anywhere. Mutation checks: implementer
appended `createStripeCheckoutForOrder` to `order/actions.ts` → pin failed;
controller independently appended `prefetchProductMockups` to
`preview/actions.ts` → pin failed; both reverted, 17/17 green.

Review (sonnet), six Minors. Fixed (sonnet fix round, haiku re-review
clean): (1) an exported statement form the lister doesn't recognise
(`export namespace`, `export import A = B.C`) fell through silently — now
throws, tested; (2) `runtimeExports` no longer exported from the test file;
(3) `export default interface` no longer reported as a runtime default;
(5) destructuring walk no longer descends into initializers, plus tests for
destructuring, `export { x } from`, `export * as ns`, `export let/var`,
`export default async function`. **Not fixed:** (4) `"use strict";
"use server";` prologue would be rejected — strict is safe for a pin and
matches all four files; (6) only 4 of 13 `"use server"` files are pinned —
matches the plan ("any other file touched"); pinning all 13 is a follow-up
candidate. Controller widened the lister's docblock to mention the new
throw. 21/21 green.
