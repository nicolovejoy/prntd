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

## Whole-branch review (opus)

No Critical. Every caller of both moved functions re-read in full:
`createCheckoutSession`, `buyPublishedDesign`, `buyStoreProduct` each check
the session (non-anonymous), derive `userId` from it, price on the server and
guard pinned images; `ensureMockupsPrefetched` checks session + ownership
before `after()`. Bodies byte-identical to `9901586`; `after()` scoping
unaffected by the callee's module (request-scoped). No `vi.mock` of
`@/app/order/actions` carries the moved function.

1. **Important — merge hazard with held PR #249**
   (`claude/201-composition-drops-v2`). #249 edits `createStripeCheckoutForOrder`
   in place in `order/actions.ts` (drops the `storeId` param + docblock + the
   `storeId: params.storeId ?? null` insert) and deletes
   `src/app/shop/actions.ts`. Controller confirmed with
   `git merge-tree`: both are loud conflicts (content conflict in
   `order/actions.ts`, modify/delete on `shop/actions.ts`), nothing merges
   silently. **Ruling: not fixable from this branch** (it is not mine to
   push to, and the function must live here). Resolution recipe for whoever
   merges the second of the two:
   a. take this branch's `src/app/order/actions.ts` (the function is gone
      from it);
   b. re-apply #249's `storeId` removal to `src/lib/order-checkout.ts`: drop
      the `storeId?: string | null` param, replace its docblock with #249's
      ("Composition attribution: the `product` row bought — the published
      image's Shop composition. Null for design-your-own. See the schema
      comment on `order`."), drop `storeId: params.storeId ?? null,` from the
      order insert, drop "store attribution" from the file header, and drop
      the `buyStoreProduct` / shop clause from the function docblock;
   c. accept #249's deletion of `src/app/shop/actions.ts` and delete its
      entry from `pins` in `src/app/__tests__/server-action-exports.test.ts`;
   d. typecheck (catches a leftover `storeId` once the column leaves the
      schema), the pin test, and the full gate, before #249's runbook
      verify step.
2. **Minor — audit gap, dormant.** `saveProduct`
   (`dashboard/actions.ts`) → `store-service.updateProduct` writes
   `patch.placements` without `assertOwnsPlacementImages` (createProduct does
   check) and an unbounded `patch.price`, which `buyStoreProduct` then passes
   into checkout. Unreachable: `assertEnabled()` throws with `STORES_ENABLED`
   unset (removed from Vercel), and #249 deletes the path. **Ruling: not
   fixed** (out of #251's scope, dead code). If #249 slips, add the
   ownership check to `updateProduct`.
3. **Minor — stale moved docblock** (`mockup-prefetch.ts`: "Triggered via
   after() on accept"). **Fixed** (`34d5508`).
4. **Minor — stale caller list** (`order-checkout.ts` named two of three
   callers). **Fixed** (`34d5508`): names all three, notes the cart builds
   its own session. Haiku re-review clean.
5. **Minor — dead `prefetchProductMockups` mocks** in five design/designs
   tests. Agrees with the task-2 ruling: leave, follow-up.
6. **Minor — pin covers 4 of 13 `"use server"` files.** Follow-up: assert
   every file whose first statement is the directive has a `pins` entry.
7. **Minor — CLAUDE.md "Open issues" still lists #251.** Main session owns
   CLAUDE.md; noted for it.

## Gate (controller, on `34d5508`)

- `npm run lint`: exit 0, 0 errors, 22 warnings (none in touched files;
  `npx eslint` on the 9 touched files is clean).
- `npm run typecheck`: exit 0.
- `npx vitest run`: 188 files, 2065 tests passed.
- `npm run build` with the CI dummy env: exit 0. Server-reference manifest
  has 71 actions; neither `createStripeCheckoutForOrder` nor
  `prefetchProductMockups` has an action ID; `createCheckoutSession` and
  `ensureMockupsPrefetched` still do.
- `npm run db:generate`: "No schema changes, nothing to migrate".

## Follow-ups (not done here)

- `calculatePrice` returns `baseCost` + `generationCost` for any design id
  with no ownership check (information leak).
- Delete the five dead `vi.mock("@/app/preview/actions", { prefetchProductMockups })`.
- Pin every `"use server"` file's exports, not just the four touched.
- `store-service.updateProduct` placement ownership check, only if #249 slips.
