# #289 item 2 — cart orders record the Shop composition

Date: 2026-10-08. Branch `claude/289-cart-attribution`. No migration.

## Context

`order.store_product_id` (`src/lib/db/schema.ts:117`) attributes an order to the Shop composition (`product` row) it was bought from. A direct buy from the image detail page sets it (`src/app/d/actions.ts` ~line 665: `published ? await requireMirrorProduct(db, imageId) : null`). `checkoutCart` (`src/app/cart/actions.ts`) never sets it, so a cart purchase of a published image books `null`. Nothing reads the column today; it exists for reporting.

Rulings (Claude, 2026-10-08; Nico approved the slice):

- `order.store_product_id` is a header column and a cart order may carry lines from several compositions. Set it when every line of the order that resolves to a **published** image shares one mirror product and there is at least one such line; otherwise leave it `null`. Per-line attribution would need an `order_item` column (schema change) and is out of scope. Document the rule in a comment at the write.
- The lookup is `requireMirrorProduct(db, imageId)` from `src/lib/model-b-writes.ts`, called only for lines whose `resolveBuyableImage` result has `published: true` (an unpublished own image has no composition; never give it a mirror lookup, same reasoning as the comment in `src/app/d/actions.ts` above the direct-buy call). A published line with no mirror row throws, as the direct buy does: fail loudly rather than book an order with no composition.
- "Line" here is the front image of the line. A back image never contributes attribution (the Shop sells the front).

## Global constraints

- Money path: real-DB integration tests (`createTestDb` in `src/lib/__tests__/test-db.ts`, factories in `src/lib/__tests__/factories.ts`). No mocks of the DB.
- `src/app/cart/actions.ts` is a `"use server"` file: async exports only; `server-action-exports.test.ts` pins its exports — add no new export there. A pure helper that decides the attribution from a list of `(published, mirrorProductId)` pairs goes in `src/lib/` (e.g. `src/lib/cart-attribution.ts`) with a unit test.
- Fence: `src/app/cart/actions.ts`, a new `src/lib/cart-attribution.ts` + test, `src/app/cart/__tests__/**`. Do not touch `src/app/d/**`, `src/lib/order-checkout.ts`, the webhook, or the schema.
- `catch (err)` narrowing per CLAUDE.md lint policy. No `any` in product code.
- Gate before reporting: `npm run lint && npm run typecheck && npm test`.

## Tasks

### Task 1 — attribution helper

`src/lib/cart-attribution.ts`: `cartOrderStoreProductId(lines: Array<{ published: boolean; storeProductId: string | null }>): string | null`. Returns the one shared id when every published line has the same non-null id and at least one line is published; `null` when no line is published or the published lines name different products. Unit tests for: no lines; all unpublished; one published; two published same product; two published different products; mixed published/unpublished sharing one product.

### Task 2 — `checkoutCart` sets it

In `checkoutCart`, for each validated line whose buyable result is `published`, look up `requireMirrorProduct` once per distinct front image id, feed the helper, and pass `storeProductId` to `createStripeCheckoutForOrder` (it already accepts `storeProductId?: string | null`, `src/lib/order-checkout.ts:74`). Integration tests on the real test DB:

1. Cart with one line, published image with a mirror product → the created `order.store_product_id` is that product id.
2. Cart with one line, the buyer's own unpublished image → `null`.
3. Cart with two lines, two different published images → `null`.
4. Cart with two lines, the same published image in two sizes → that product id.

Follow the existing checkoutCart test file's pattern for stubbing Stripe (grep `src/app/cart/__tests__/` for how `createStripeCheckoutForOrder` or Stripe is stubbed today, and do the same).

### Task 3 — PR

Open the PR on `claude/289-cart-attribution` with `gh pr create`. Body: what changed, the header-column ruling, the four integration cases, and "Closes nothing; #289 item 2". End the body with the attribution line from the session reminder.
