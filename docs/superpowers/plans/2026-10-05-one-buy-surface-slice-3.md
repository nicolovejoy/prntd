# One Buy Surface, Slice 3: the owner orders an unpublished image through the panel

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Parent plan:** `docs/superpowers/plans/2026-10-01-one-buy-surface.md`. Its Decisions, Global Constraints and URL contract apply here unchanged. Read them first.

**Goal:** the owner of an unpublished image can order it, and add it to the cart, from its image detail page with the same panel a Shop buyer uses. Nobody else can.

**Branch:** `claude/278-owner-buy`. One PR. No schema change is expected; if one appears the PR is HOLD.

**Money path.** This slice changes who may create an order. It gets real-DB integration tests that assert on `order`, `order_item`, `ledger_entry` and the recorded Stripe params, and a dedicated adversarial review before the PR, in addition to the whole-branch review.

## What exists today (traced 2026-10-05, main at `1548a4b`)

- `buyPublishedDesign` (`src/app/d/actions.ts`) refuses anything `canBuyPublishedImage` rejects, then calls `requireMirrorProduct` and books `storeProductId`.
- The owner of an unpublished image is sent to `/preview` instead (`src/app/d/[imageId]/page.tsx`, the unpublished-owner branch). `/preview` orders go through `createCheckoutSession` (`src/app/order/actions.ts`), which checks `design.userId === session.user.id` and books no `storeProductId`.
- The item price is the same on both paths: `computePrice`'s `total` does not depend on `generationCost`.
- `getDesignImageWithOwner` resolves an id from `image`, and falls back to a `placement_render` row. For an `image` row, `designId` is `sourceDesignId ?? linkDesignId`, and an image with no `listing` row reads as `isHidden: false`.
- Slice 2's link handling is gated on published: `backToResolve(picks, { published, loggedIn, multiPlacement })` in `src/lib/buy-page-picks.ts`, and `resolveInitialBack` returns null when the page image is not buyable.
- `addToCart` (`src/app/cart/actions.ts`) has an image path used by the panel, with its own gate on the image.
- `getListingMockup` and `getListingBackMockup` already gate on `canViewImagePage`, so an owner can already render a mockup of their own unpublished image.
- In Production `EMBEDDED_CHECKOUT_ENABLED` is on, so an order created by `buyPublishedDesign` opens on our `/checkout` page. An owner's unpublished-image purchase from this page will therefore use embedded checkout, where `/preview` uses hosted.

## Rules this slice must hold

1. **Who may buy.** Published and not hidden: any signed-in real user, as today. Otherwise: only the image's owner, only when the image is not hidden, only when the image is an `image` row with a live conversation, and only when that conversation belongs to the buyer (`design.userId === session.user.id`). The last check is the one `/preview` makes today; keeping it means the new path is never weaker than the old one.
2. **A `placement_render` id is never a page image.** `getDesignImageWithOwner` would resolve one with an owner; the action must refuse it.
3. **An unpublished order has no Shop composition.** No `requireMirrorProduct`, no `storeProductId`. A published image still requires its mirror product and books it, including when its own owner buys it.
4. **Refusals write nothing.** A refused call leaves zero `order` rows, zero `cart_item` rows and makes zero Stripe calls.
5. **Anonymous owner.** A guest owns their images as an anonymous user. The panel shows Sign in to buy; the action returns `needsAuth` and writes nothing. After sign-in or sign-up `reparentUserData` moves the image and its conversation to the real account, and slice 2 returns them to the same picks.
6. **Back and swap** keep the bar they have today (`assertUsablePlacementImage`). For an owner the order's design is now their own, so the guard's "This design" origin applies to them; it must still give a non-owner nothing.

## Review Focus (name these to the reviewers as things to probe)

1. A non-owner sends another person's unpublished image id to `buyPublishedDesign`, `addToCart`, `getBuyPageBackSources`, `resolveInitialBack`, `getListingMockup` and `getListingBackMockup`, signed in, anonymous and signed out.
2. An id that resolves through the `placement_render` fallback, sent by the render's owner.
3. An image whose conversation was deleted, or belongs to someone else (a link through `conversation_image` to another user's conversation).
4. An image published, then admin-hidden, bought by its owner; an image published, then unpublished.
5. The order's whole life for an unpublished image: Stripe session, webhook claim, `sale` and `stripe_fee`, fulfillment with the pinned image, `cogs`, the confirmation and owner emails, `/orders`, the admin order page, a refund. Each must behave as a `/preview` order does today with `storeProductId` null.
6. A published image bought by its own owner still books its `storeProductId`.
7. The cart: an unpublished image added from the panel, then checked out from the cart.

---

### Task 3.1: `canBuyImage` (pure)

**Files:** `src/lib/design-publish.ts`, `src/lib/__tests__/design-publish.test.ts` (or the file that tests `canBuyPublishedImage` today).

- [ ] Write tests first for `canBuyImage({ image: { publishedAt, isHidden }, imageOwnerId, userId })`: published and visible → true for anyone including `userId: null`; published and hidden → false for everyone including the owner; unpublished → true only when `userId === imageOwnerId`; unpublished with `userId: null` or `""` → false.
- [ ] Implement it as `canBuyPublishedImage(image) || (userId !== null && userId !== "" && userId === imageOwnerId && !image.isHidden)`.
- [ ] Keep `canBuyPublishedImage` for callers that mean "anyone". Rewrite its doc comment: it currently says the owner buys unpublished work "through the normal /order flow", which stops being true in this slice.
- [ ] Commit.

### Task 3.2: `buyPublishedDesign` accepts the owner's unpublished image

**Files:** `src/app/d/actions.ts`, new `src/app/d/__tests__/buy-own-unpublished.integration.test.ts`.

- [ ] List every caller of `buyPublishedDesign`, `requireMirrorProduct` and `getDesignImageWithOwner`, and every reader of `order.storeProductId`, in the task report.
- [ ] Write the integration tests first (`createTestDb`, factories). Each asserts on rows and on the recorded Stripe params, and matches prices by pattern only:
  - owner buys own unpublished image: one `order`, one `order_item`, `placements.front` is the image, `store_product_id` null, `design_id` is the image's conversation;
  - the same with a back from the owner's own conversation, and with a swap;
  - a signed-in non-owner sends the same id: throws, zero `order` rows, zero Stripe calls;
  - anonymous owner: `{ url: null, needsAuth: true }`, nothing written;
  - a `placement_render` id owned by the caller: throws, nothing written;
  - an image whose conversation row is gone: throws, nothing written;
  - an image linked to a conversation owned by another user: throws, nothing written;
  - owner's image that is published and hidden: throws;
  - a published image bought by a stranger, and by its own owner: both book `store_product_id`.
- [ ] Implement. Gate on `canBuyImage`. Decide "published" once from the loaded image and branch on it: the published branch is today's code unchanged; the unpublished branch adds the conversation-owner check and passes no `storeProductId`. Refuse a `placement_render` id before either branch.
- [ ] Keep the export name (it is pinned in `server-action-exports.test.ts`). Rewrite the function's doc comment and the inline comments that say the order's design is "the SELLER's": that is now true only on the published branch.
- [ ] `returnPath`, `cancelUrl` and the embedded `backPath` are unchanged. Add the unpublished case to `buy-return-paths.integration.test.ts`'s round trip.
- [ ] Commit.

### Task 3.3: back sources and link handling follow the same gate

**Files:** `src/app/d/actions.ts`, `src/lib/buy-page-picks.ts`, `src/app/d/[imageId]/page.tsx`, their tests.

- [ ] `getBuyPageBackSources`: gate on the same decision as Task 3.2 (extract one helper inside `src/lib/` if that keeps the two from drifting; it must not be exported from a "use server" file). Tests: the owner of an unpublished image gets groups including This design; a non-owner and an anonymous viewer get none.
- [ ] `resolveInitialBack`: "page image not buyable" must use the new gate with the viewer. Extend `resolve-initial-back.integration.test.ts`.
- [ ] `backToResolve`: rename its `published` input to `buyable` and pass the new decision from the page. Update the unit tests and the round trip.
- [ ] Commit.

### Task 3.4: the cart accepts the owner's unpublished image

**Files:** `src/app/cart/actions.ts`, its integration tests.

- [ ] Read `addToCart`'s image path and the cart's checkout action; list in the report what each checks today.
- [ ] Tests first: the owner adds their unpublished image from the panel's call shape (line written, front pinned to the image, design is their conversation); a non-owner is refused and no line is written; the same `placement_render` and foreign-conversation refusals as Task 3.2; a cart holding that line checks out to an `order_item` with the same placements and no `store_product_id`.
- [ ] Implement with the same gate helper as Tasks 3.2 and 3.3.
- [ ] Commit.

### Task 3.5: the page shows the panel to the owner

**Files:** `src/app/d/[imageId]/page.tsx`, `buy-hero.tsx` and `buy-panel.tsx` only if a prop is missing, their tests.

- [ ] The unpublished-owner branch renders `BuyHero` with `canEdit={false}` (no backdrop picker without a publication) in place of the link to `/preview`, when `img.sourceDesignId && img.hasSourceConversation`. Without a live conversation: no Order, as today.
- [ ] `initialPicks` are parsed and applied for this branch too (slice 2 gated them on published).
- [ ] An anonymous owner sees Sign in to buy (`isLoggedIn` is already false for anonymous sessions; pin it with a test).
- [ ] Mockups: confirm with a test that `getListingMockup` for an unpublished image that is not its conversation's primary caches under that image's key and never under the conversation's default key (the invariant #280 added for `/preview`).
- [ ] Remove or rewrite the page comment that says private work "links out to /preview".
- [ ] The Publish and owner actions on this branch stay where they are. Check the layout at 390px: no horizontal scroll, 44px targets.
- [ ] Commit.

### Task 3.6: the order's life after checkout

**Files:** a new integration test beside the webhook and fulfillment tests; no product code expected.

- [ ] One test that takes an order created by Task 3.2's unpublished path through the real handlers: `handleStripeCheckoutCompleted` claims it and books `sale` and `stripe_fee`; `submitOrderFulfillment` submits the pinned image and books `cogs`; `sendPostOrderEmails` builds both emails without throwing.
- [ ] Render checks for `/orders` and the admin order detail with that order (or name the existing tests that already cover a null `storeProductId`).
- [ ] If any of these needs a product-code change, stop and report before making it.
- [ ] Commit.

### Task 3.7: Playwright

**Files:** `e2e/` specs, `.github/workflows/stripe-e2e.yml`, `docs/stripe-e2e.md`.

- [ ] PR e2e: the owner of a seeded unpublished image opens its image detail page, taps Order, picks a size, and the Order button is enabled; a second signed-in user opening the same URL gets the not-found page.
- [ ] Nightly Stripe e2e: one purchase of an unpublished image through the panel. The nightly sets only `PREVIEW_EMBEDDED_CHECKOUT_ENABLED` today; add `EMBEDDED_CHECKOUT_ENABLED: "true"` so the purchase runs on our `/checkout` page as it does in Production. Say in `docs/stripe-e2e.md` what the nightly now covers.
- [ ] The new nightly selectors cannot be run locally. Before the PR is called ready, run the nightly workflow by `workflow_dispatch` on the branch and calibrate from that run.
- [ ] Commit.

### Slice 3 close

- [ ] Gate: `npm run lint && npm run typecheck && npm test && npm run db:generate && npm run build` (build env: the dummy block in `ci.yml`'s `check` job).
- [ ] Whole-branch review, with the Review Focus list given as things to probe.
- [ ] Dedicated adversarial review of the money path: a second reviewer whose only brief is to make the branch create an order, a cart line or a Stripe session it should not, or to book one wrongly.
- [ ] Fix round, re-gate, PR. CI's e2e and the dispatched nightly both green before it is called ready.
- [ ] After merge: merge main into #249 and re-gate. #249 renames `listing` and touches `src/app/d/actions.ts`; search its tree for raw SQL naming `listing` in `e2e/`.

Smoke for Nico (after merge, in a desktop browser at phone width, signed in):

1. Open https://prntd.org/designs and click a design you have not published.
2. On its image detail page click **Order**, click size **L**, then click **Order** again.

- PASS: the page stays on prntd.org and shows the payment form for that shirt in size L. Close the tab without paying.
- FAIL: the browser goes to `/preview`, or no Order button is shown, or an error appears.

## Not in this slice

- Entry points (Studio lightbox, My Designs, the conversation page) still open `/preview`. Slice 4 moves them and turns `/preview` into a redirect.
- The front picker stays on `/preview` until slice 4.
- An unpublished image whose conversation was deleted still cannot be ordered (`order.design_id` is NOT NULL).
