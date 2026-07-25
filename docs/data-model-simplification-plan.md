# Data model simplification — plan & roadmap

Status: started 2026-06-25. Approach agreed with Nico. Companion to
`docs/conversation-image-model.md` (the Model B target for conversation/image).

## The four cleanups

Ranked by independence. The first two stand alone; the last two ride the
Model B (conversation/image) migration.

1. **Orders: header + lines, one source of truth.** `order` carries per-item
   scalar fields (`size`, `color`, `productId`, `placements`, `itemPrice`,
   `printfulCost`) *and* there's an `order_item` table with the same fields per
   line. Single-item orders use the scalars; cart orders use `order_item`. Two
   representations of "what was bought." Target: `order_item` is authoritative
   (every order has ≥1 line); `order` keeps only order-level money + linkage.
   **DONE** — see Phase 1 below (1c, migration `0006`).

2. **Rename `productId` → `blankId` where it means a blank.**
   `order.productId`, `order_item.productId`, `cart_item.productId` hold a *blank*
   catalog id (e.g. `bella-canvas-3001`), but there's now a `product` table (the
   organizer sellable) and `order.storeProductId`. "productId means blank" is a
   foot-gun. Rename to match the config rename already done (product→blank).

3. **Split `design_image`'s three roles** (rides Model B). One row is today an
   **artifact**, a **placement render** (`productId`/`placementId` set), and a
   **published listing** (`publishedAt`/`title`/`description`/`backgroundColor`)
   all at once. Target: `image` = artifact only; a **listing** points at an
   image; **renders** are a cache. Makes the immutable-published-image guardrail
   clean.

4. **Move provenance from `design` to `image`** (rides Model B).
   `design.forkedFromImageId` / `design.originalDesignerId` are image-lineage
   facts parked on the thread. Model B puts them on `image`, with the seed/output
   graph.

## Roadmap

Strangler-fig throughout: add the new shape, move readers behind a normalizer,
then writers, then drop the old columns — never a big-bang migration. Each phase
ships green.

### Phase 1 — Order header/lines (#1)

1a. **Read-side normalizer (no schema change).** Pure `resolveOrderLines(order,
    items)` → `OrderLine[]`: returns `order_item` rows when present, else a
    single synthetic line built from the legacy scalar columns. Exposes the
    blank id as `blankId` (read-layer half of #2). Point read sites at it.
    - DONE 2026-06-25: `src/lib/order-lines.ts` (6 unit tests).
    - DONE: `/orders` wired (`getUserOrders` → per-line thumbnail + attribution;
      page renders one row per shirt; real-DB integration test). This fixed a
      latent bug — multi-item cart orders previously showed only item 1.
    - DONE: `/order/confirm` wired (lists every line).
    - TODO: admin order detail display + order emails. NOTE: admin's Printful
      re-submit path (`admin/actions.ts` ~L109) reads the scalar fields for
      variant resolution — that's fulfillment, handle with care (it becomes a
      real consumer of lines only in 1b/1c, not the display pass).
1b. **Write-side: always write `order_item`.** Single-item checkout writes one
    `order_item` row alongside the order (keep scalars dual-written for one
    release so nothing breaks mid-deploy).
    - DONE 2026-07-18 (PR #54): `createStripeCheckoutForOrder` batches an
      `order_item` row with the order insert, so every checkout writes lines.
1c. **Drop the scalar item columns** from `order`. DONE — migration `0006`.
    - Dropped: `product_id`, `size`, `color`, `placements`. The migration
      backfills a line (`id = 'legacy-' || order.id`) for every order without
      one *before* dropping, so it's self-contained and idempotent on any target.
    - Kept: `item_price` and `printful_cost`. Both read as order-level money in
      practice — `item_price` is the product subtotal the Stripe webhook
      reconciles from `amount_subtotal` (`totalPrice = itemPrice +
      shippingPrice + taxCollected`), and `printful_cost` is the invoice total
      for the whole Printful order. `order_item` carries the per-line versions.
    - `resolveOrderLines` lost its legacy-scalar branch: it now just maps
      `order_item` rows (still exposing `blankId`).
    - Also moved off scalars: the Printful shipping-email hero (the last known
      reader), the sale-ledger description, and the delete-image order-reference
      guard (now reads `order_item.placements`).

### Phase 2 — blank rename (#2)

2a. Rename columns `order.product_id` → `blank_id`, same for `order_item` and
    `cart_item`. Drizzle migration (SQLite `ALTER TABLE RENAME COLUMN`).
2b. Sweep references in code; `store_product_id` stays (it points at `product`).

### Phase 3 — Model B foundation (additive)

3a. New `image` table (artifact: owner, r2 key, generator, provenance) and
    `conversation_image` join (`role` = output | seed). Add alongside
    `design_image`; backfill from it.
3b. New `listing` concept (published title/desc/backdrop/publishedAt) pointing at
    an image. Move readers.
3c. Treat placement renders as a cache, not artifacts.

### Phase 4 — cut over to Model B

Move writers to `image`/`conversation_image`/`listing`; relocate provenance
(#4); retire `design_image`. Adopt the immutability rule (published images are
snapshots). This is the big one — its own plan when we get there.

## Principles

- Every phase ships green; CI stays green; money-path integration tests
  (`money-path.integration.test.ts`) gate order changes.
- TDD: pure helpers first (red → green), then wire into actions.
- Additive migrations until a column has zero readers; only then drop it.
- No backfill of financial history beyond what's needed (matches the
  April-1 ledger-start convention).
