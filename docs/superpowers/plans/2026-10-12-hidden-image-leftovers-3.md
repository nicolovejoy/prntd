# Hidden-image leftovers 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the parts of #310 that Nico has ruled on and that were waiting on #314: the cart thumbnail (item 1), the `/checkout` re-check (item 7), the conversation delete (item 2) with its two refusals, and the follow-up #321 (no Order when an image's conversation is gone).

**Architecture:** Three slices on three branches, built in parallel because their files do not overlap. Each is one Sonnet implementer in its own worktree, a gate re-run by the controller, and an Opus whole-branch review; slice A also gets an adversarial review because it changes the checkout page's loader. No schema change, no new string, no new environment variable.

**Tech Stack:** Next.js 16 App Router, Drizzle on libSQL, Vitest with an in-memory libSQL.

**Spec:** The rulings on https://github.com/nicolovejoy/prntd/issues/310 (comments of 2026-10-11) and https://github.com/nicolovejoy/prntd/issues/321. There is no separate spec document.

**Slices and branches** (base `5a6576c`):

- A. `claude/hidden-cart-checkout`: #310 items 1 and 7.
- B. `claude/hidden-conversation-delete`: #310 item 2, `deleteDesignImage` and `startConversationFromImage` refusals.
- C. `claude/no-order-without-conversation`: #321.

**Not built here:** whether a listing whose conversation is gone also leaves the Shop feed (open question on #321); expiring a Stripe session at the moment of a hide (#310, not ruled); #310 item 6's two Production counts.

## Review Focus

1. A buyer who paid while the webhook is in flight opens `/checkout` after the image was hidden: they must reach `/order/confirm`, never "Nothing was charged." (slice A, task A2 test 4).
2. A cart with no stale line pays no extra query for the thumbnail rule (slice A, task A1: only unavailable lines are checked).
3. A hidden image must not keep alive a conversation its owner asked to delete, and must not make the delete batch fail on a foreign key (slice B, task B1 tests 1 and 11).
4. `deleteDesignImage`'s refusal order must not tell a stranger that an image is hidden (slice B, task B2 test 2).
5. The image detail page and the buy gate must agree for every image, with no extra query on a public page load (slice C, task C1).

---

## Global Constraints (every slice)

These bind every task. They come from `CLAUDE.md`, `AGENTS.md` and Nico's rulings on #310.

1. **No new user-facing string.** Each slice names the exact existing string to reuse. If you think a new string is needed, stop and report; do not write one.
2. **Hidden means admin-hidden**: the `image_publication` row's `is_hidden = true`, and nothing else. `image_publication` is the one reader of image visibility. Never read `product.status` to decide visibility.
3. **Owner ruling (2026-10-05):** once an admin hides an image nobody can buy, print or mock it up, its owner included, and the owner cannot undo the hide or delete the moderation record.
4. **No schema change.** `npm run db:generate` must print "No schema changes" and leave `drizzle/` untouched.
5. **Tests:** TDD. Real-DB integration tests run against an in-memory libSQL built from `schema.ts` (`src/lib/__tests__/test-db.ts`, `createTestDb`), with the shared factories in `src/lib/__tests__/factories.ts`. `src/lib/**` tests run under node, not jsdom. Follow the mock shape of the neighbouring test files named in your slice.
6. **Do not edit** `src/lib/__tests__/factories.ts`, `src/lib/__tests__/test-db.ts`, `CLAUDE.md`, `AGENTS.md`, or anything under `docs/`. Three slices are being built in parallel on separate branches; those files are shared. If a seed helper is missing, define it inside your own test file.
7. **Stay inside your slice's file list.** If the work needs a file outside it, say so in your report and explain why before (or instead of) editing it.
8. **Server Actions:** a `"use server"` file exports async functions only. Pure helpers and anything that trusts a user id passed as an argument live in `src/lib/` (not a `"use server"` module).
9. **Lint policy:** no `any` in product code (tests may use it). `catch (err)` and narrow with `err instanceof Error ? err.message : String(err)`.
10. **libSQL over HTTP has no interactive transactions:** use `db.batch` and conditional writes. Independent reads go in one `Promise.all`.
11. **Comments and docs:** plain statements of what the code does and why. No hyperbole. Update every comment your change makes untrue, including doc comments on functions you touch and comments in other files that describe the behaviour you changed (search for them).
12. **This is Next.js 16.** If you touch anything Next-specific, read the relevant guide in `node_modules/next/dist/docs/` first.
13. **Never read `.env*` files or any secret material.** No network calls. Do not run the dev server.
14. **Git:** work only in your worktree, on its branch. Commit per task with a descriptive message ending with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push, do not open a pull request, do not touch other worktrees or branches, do not delete branches.
15. **Do not dispatch subagents.** Review comes from the controller after your report.

## Gate (run before reporting; all four must pass)

```
npm run lint
npm run typecheck
npm test
npm run db:generate
```

`npm test` is the full suite (about 250 files, under two minutes). Run it in the foreground and read the summary line. If a test you did not touch fails, run it again on its own before concluding anything, and report it either way.

## Report (in your reply, not in a file)

Under 400 words:

- Status: `DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT` or `BLOCKED`.
- Commits: short sha and subject, in order.
- Gate: the summary line of each of the four commands.
- Departures from the brief, each with its reason.
- Anything in the brief that the code contradicts (names, line numbers, behaviour).
- Concerns and open questions.

The names and line numbers in the brief were read from `main` at `5a6576c`. The code is the authority for names; the behaviour described in the brief is the requirement.

---

# Slice A: a hidden image in the cart and at /checkout (#310 items 1 and 7)

Branch `claude/hidden-cart-checkout`, worktree `.claude/worktrees/hidden-cart-checkout`.

## Rulings this slice implements (Nico, 2026-10-11, on #310)

- **Item 1.** A cart line whose image was admin-hidden: drop the thumbnail for everyone, keep the line with its "No longer available" label. The cart's owner can be a Shop buyer, not the image's owner.
- **Item 7.** An image is hidden while a checkout session for it is open: stop the buyer at `/checkout` (the page re-checks its lines and shows the expired screen). Fulfilment is left alone. Expiring the Stripe session is not ruled and is not built.

## Files

- Modify: `src/lib/back-sources.ts` (export one helper)
- Create: `src/lib/line-hidden-art.ts`
- Create: `src/lib/__tests__/line-hidden-art.integration.test.ts`
- Modify: `src/app/cart/actions.ts` (`buildCart`, `CartLine` doc comments)
- Create: `src/app/cart/__tests__/cart-hidden-thumbnail.integration.test.ts`
- Modify: `src/app/cart/__tests__/cart-page.test.tsx` (one test, only if no existing test covers it)
- Modify: `src/lib/embedded-checkout-session.ts` (`loadEmbeddedCheckout`)
- Modify: `src/lib/__tests__/embedded-checkout-session.integration.test.ts`

No change is expected in `src/app/cart/page.tsx` or `src/app/checkout/page.tsx`: the cart already renders an empty tile when `imageUrl` is null and no back tile when `backImageUrl` is null, and `/checkout` already renders `kind: "expired"` as "This checkout expired." / "Nothing was charged.". Confirm both by reading them; report if either is not so.

## Task A1: the helper, and the cart drops a hidden thumbnail

### Interfaces produced

`src/lib/back-sources.ts` already has a private `hiddenThroughSources(image)` that follows a placement render to the image it renders (up to `MAX_RENDER_HOPS`). Export one function built on it:

```ts
/**
 * Whether the artwork behind an image id is admin-hidden: the image itself,
 * or, for a placement render, the image it renders (followed down the chain).
 * False for an id that resolves to nothing.
 */
export async function isPlacementImageHidden(imageId: string): Promise<boolean> {
  const image = await getDesignImageWithOwner(imageId);
  return image ? hiddenThroughSources(image) : false;
}
```

`assertPrimaryNotHidden` may call it instead of repeating the two lines. Its behaviour must not change.

New module `src/lib/line-hidden-art.ts` (not `"use server"`):

```ts
export type LineHiddenArt = { front: boolean; back: boolean };

/**
 * Which sides of a cart or order line show admin-hidden artwork.
 * front: the `front` pin when the line has one; otherwise the design's
 *   `primary_image_id` (a pinless legacy line prints the primary); false when
 *   there is neither.
 * back: the `back` pin when the line has one; otherwise false.
 */
export async function lineHiddenArt(line: {
  designId: string;
  placements: Record<string, string> | null;
}): Promise<LineHiddenArt>
```

Run the front and back checks together (`Promise.all`). The design row is read only for a pinless line.

### Cart behaviour

In `buildCart` (`src/app/cart/actions.ts`), after the `cartLineStillValid` re-check has set `unavailable` on every line: for each line with `unavailable === true`, call `lineHiddenArt({ designId, placements })` (all such lines together, one `Promise.all`) and set `imageUrl = null` when `front` is hidden and `backImageUrl = null` when `back` is hidden.

Only unavailable lines are checked. A hidden pin always fails `cartLineStillValid` (`assertUsablePlacementImage` and `assertPrimaryNotHidden` both refuse a hidden image, through render sources too), so an available line has none, and a cart with no stale line pays no extra query. Say this in a comment at the call.

A line that is unavailable for another reason (the owner unpublished the image, the size left the catalog) keeps its thumbnails. The rule is hidden-only.

Update the `CartLine` doc comments for `imageUrl` and `backImageUrl` to say they are null for a hidden image.

### Tests

`src/lib/__tests__/line-hidden-art.integration.test.ts` (real DB; mock `@/lib/db` the way `src/lib/__tests__/back-sources.integration.test.ts` does):

1. Front pin hidden, no back: `{ front: true, back: false }`.
2. Front visible and published, back pin hidden: `{ front: false, back: true }`.
3. Both pins published and visible: `{ front: false, back: false }`.
4. A pin with no publication row (never published): `false`.
5. No placements (`null`), design's primary hidden: `front: true`.
6. No placements, design's primary visible: `front: false`.
7. No placements and the design has no primary: `front: false`.
8. A `placement_render` pin whose `source_image_id` is a hidden image: `true` for that side.
9. A pin id that names no row in either table: `false`.
10. Hidden, then unhidden: `false`.

`src/app/cart/__tests__/cart-hidden-thumbnail.integration.test.ts` (pattern and mocks: `src/app/cart/__tests__/checkout-revalidates-lines.integration.test.ts`, which already seeds a stranger's cart line and hides the image):

1. A stranger's line on a published image; an admin hides it. `getCart()`: the line is still there, `unavailable` is true, `imageUrl` is null.
2. A two-sided line; the back image is hidden, the front is not. `imageUrl` is the front's URL, `backImageUrl` is null, `unavailable` is true, `hasBack` is still true.
3. A line made unavailable by the owner unpublishing the image (not hidden): `unavailable` true, `imageUrl` still the image's URL.
4. An available line: both URLs as before.
5. Hide, then unhide: `unavailable` false and `imageUrl` back.
6. The image's own owner, with their own hidden image in their cart: `imageUrl` null (everyone, the owner included).
7. A pinless line on the user's own design whose primary is hidden: `imageUrl` null.

`cart-page.test.tsx`: if no test already renders an unavailable line with `imageUrl: null`, add one asserting that line contains no `<img>` and still shows "No longer available".

Commit: `Cart: a line whose image was hidden shows no thumbnail (#310 item 1)`.

## Task A2: /checkout refuses a session whose line shows a hidden image

### Behaviour

In `loadEmbeddedCheckout` (`src/lib/embedded-checkout-session.ts`), after the three `session.status` checks have established the session is `open`, and **before** the `ui_mode` branch: resolve the order's lines and call `lineHiddenArt` for each (one `Promise.all`). If any line has `front` or `back` hidden, return `{ kind: "expired" }`.

Why that position, and say it in the function's doc comment ("Order of checks"):

- After Stripe says `open`: the expired screen says "Nothing was charged.", which is only known once the session is open. A `complete` session must still return `{ kind: "complete" }` so a buyer who paid reaches `/order/confirm`, hidden or not.
- Before the `ui_mode` branch: a hidden line must not be redirected to Stripe's hosted page either.
- The existing cheapest-first order (DB ownership and status, then key config, then Stripe) is unchanged for everything before it.

The lines are the `order_item` rows run through `resolveOrderLines`, exactly as `loadCheckoutSummary` reads them. Read them once and pass them to both the hidden check and the summary (refactor `loadCheckoutSummary` to take the resolved lines, or split out a loader; do not query `order_item` twice).

The order row is not changed (it stays `pending` until Stripe expires the session). The Stripe session is not expired. Known and accepted: a buyer who already has the payment form open when the image is hidden can still pay.

### Tests

Add a `describe` to `src/lib/__tests__/embedded-checkout-session.integration.test.ts` (it has `seedOrder`, the Stripe `retrieve` mock and the config mocks; extend `seedOrder` locally if you need a back pin, a second line or a publication row):

1. Open embedded session; the front image is published, then hidden after the order exists: `{ kind: "expired" }`. `retrieve` was called once (the check runs after Stripe).
2. The back image is hidden, the front is not: `expired`.
3. An order with two lines, one of them hidden: `expired`.
4. Front hidden and Stripe reports the session `complete`: `{ kind: "complete" }`.
5. Front hidden and the order's status is no longer `pending`: `complete`, and `retrieve` was not called.
6. Front hidden and the open session is hosted (`ui_mode: "hosted"`, with a `url`): `expired`, not `hosted`.
7. Front hidden then unhidden: `ready`.
8. The owner unpublished the image after the order exists (no publication row, not hidden): `ready`. The rule is hidden-only.
9. The front pin is a `placement_render` whose source image is hidden: `expired`.
10. Not hidden: `ready` with the same summary as before (the existing tests must keep passing unchanged).

Commit: `/checkout: a session whose line shows a hidden image reads as expired (#310 item 7)`.

## What a reviewer will attack

- A paid session with the webhook still in flight must never see "Nothing was charged.".
- The hidden check must not run, and must not throw, on the paths that return before it.
- A Stripe timeout or error still returns `unavailable` exactly as today.
- No second `order_item` query, no extra query for a cart with no stale line.
- The summary returned for `ready` is byte-for-byte what it was.

---

# Slice B: deleting a conversation keeps a hidden image; two refusals (#310 item 2)

Branch `claude/hidden-conversation-delete`, worktree `.claude/worktrees/hidden-conversation-delete`.

## Rulings this slice implements (Nico, 2026-10-11, on #310)

- **Item 2.** Deleting a conversation that holds an admin-hidden image: delete the conversation, keep the image row, its `image_publication` row and its composition (the mirror `product`). Built as one keeper flag in `planDesignDeletion`, plus a hidden refusal in `deleteDesignImage`.
- **`startConversationFromImage`** refuses the owner's own hidden image, with the existing "Image is not available".

Background, from the trace on the issue (https://github.com/nicolovejoy/prntd/issues/310#issuecomment-6110978666): three paths delete a conversation and none checks hidden state today, so a hidden image with no other reference is deleted with its publication row (the moderation record) and its composition. `deleteImages` (My Designs) already refuses a hidden id for that reason (`src/app/designs/actions.ts`, skip reason `hidden`).

## Files

- Modify: `src/lib/model-b-writes.ts` (one batched reader next to `isImageAdminHidden`)
- Modify: `src/lib/delete-design.ts` (`ImageDeletionOutcome`, `planDesignDeletion`, header and `executeDesignDeletion` comments)
- Modify: `src/lib/delete-designs-since.ts` only if its report needs it (see Task B1)
- Modify: `src/app/design/actions.ts` (`deleteDesignImage`, and the `startConversationFromImage` doc comment)
- Modify: `src/lib/design-publish.ts` (`canStartFromImage`)
- Tests: `src/app/designs/__tests__/delete-design.integration.test.ts`, `src/app/studio/__tests__/delete-conversations.integration.test.ts`, `src/lib/__tests__/delete-designs-since.integration.test.ts`, `src/lib/__tests__/design-publish.test.ts`, `src/app/design/__tests__/fresh-start-seed.integration.test.ts`, and one new file `src/app/design/__tests__/delete-design-image-hidden.integration.test.ts`

## Task B1: `planDesignDeletion` keeps a hidden image

### Interfaces produced

`src/lib/model-b-writes.ts`, next to `isImageAdminHidden` (same column, same rule, many ids in one query):

```ts
/**
 * The ids among `imageIds` that an admin has hidden: `isImageAdminHidden` for
 * many images in one query. An empty list returns an empty set without a
 * query.
 */
export async function adminHiddenImageIds(
  db: typeof appDb,
  imageIds: string[]
): Promise<Set<string>>
```

`src/lib/delete-design.ts`:

- `ImageDeletionOutcome` gains `"keep-hidden"`.
- `planDesignDeletion` reads the hidden ids inside its existing `Promise.all` (the one that runs when `imageIds.length > 0`). For each image: when the reference decision is `"delete"` and the image is hidden, the outcome is `"keep-hidden"` and the id is **not** pushed to `removableImageIds`. `"blocked-by-order"` and the three `detach-*` outcomes are unchanged (they already keep the image row).

Everything else follows from `removableImageIds`, and must be confirmed by test rather than assumed:

- `removableMirrorIds` is derived from it, so the composition stays.
- `executeDesignDeletion` deletes `image` and `image_publication` rows only for `removableImageIds`, so both rows stay, with `is_hidden` still true.
- `r2KeysForPlan` (`src/lib/delete-designs-since.ts`) lists only removable images, so the Studio bulk delete leaves the R2 object.
- The conversation itself still goes: its `conversation_image` links (the hidden image's output link included), chat, placement renders, cart lines and generation jobs are deleted as today. The kept image's `source_design_id` then names a deleted conversation; the column has no foreign key, and an image that survives through a seed or a pin is already in that state.

Update the header comment's "Rules" in `delete-design.ts` and the comment in `executeDesignDeletion` ("a detached image … keeps its publication row AND its composition") so they describe the hidden keeper too.

`delete-designs-since` (`formatReport` and the apply step) uses the same plan. Read how it prints an image's outcome; `keep-hidden` should read sensibly in the report with no code change. Change it only if the report would mislabel a kept hidden image, and say so in your report.

### Tests (real DB)

Use the harness that fits each case; the three existing files already seed conversations, publications and compositions. Hide an image the way production does (the admin action's writer, `setImageHidden` or what it is called now) so the publication row and the mirror product's status are both written.

1. Lane Delete (`deleteDesign`) on a conversation whose only image is published and hidden: the `design` row is gone; the `image` row, its `image_publication` row (`is_hidden` true) and its mirror `product` row are still there; the conversation's `conversation_image` and `chat_message` rows are gone.
2. A conversation with one hidden image and one ordinary unpublished image: the ordinary image row is gone, the hidden one is kept.
3. Studio bulk delete (`deleteConversations`) of such a conversation: same rows kept; the R2 delete is called for the ordinary image's key and not for the hidden image's key.
4. The plan itself: `plan.images` carries `outcome: "keep-hidden"` for the hidden image; `removableImageIds` and `removableMirrorIds` do not contain it or its mirror.
5. `r2KeysForPlan` on that plan returns no key for the hidden image.
6. A hidden image that is also a seed in another conversation: outcome stays `detach-seed`, the image is kept.
7. A hidden image pinned by an order line: the plan is still blocked (`orderReferenced`), outcome `blocked-by-order`.
8. A published image that is not hidden, with no other reference: still deleted with its publication row and composition (the rule is hidden-only).
9. `deleteDesignImage`/`removeDesignIfNowEmpty` interplay: a conversation with one visible image and one hidden image; delete the visible one with `deleteDesignImage`. The conversation is kept (it still has the hidden image's link), and a following lane Delete removes the conversation and keeps the hidden image.
10. `delete-designs-since`: its report line for a kept hidden image names `keep-hidden`, and its apply step keeps the rows and the R2 object.
11. After the delete, unhide the image with the production writer: the publication row reads `is_hidden` false and the rows are intact (no error from the missing conversation).

Commit: `Conversation delete keeps an admin-hidden image, its publication row and its composition (#310 item 2)`.

## Task B2: `deleteDesignImage` and `startConversationFromImage` refuse a hidden image

### `deleteDesignImage` (`src/app/design/actions.ts`)

After the existing checks (session, design ownership, `blocked-by-order`, `not-found`) and before `executeImageDeletion`:

```ts
if (await isImageAdminHidden(db, imageId)) {
  throw new Error("This image is not available");
}
```

Use the string exactly as `selectImage` and `setPrimaryImage` throw it (it is `publishImage`'s string; if it lives in a constant, use the constant). The order of checks matters and is pinned by tests: a foreign design is still "Unauthorized", an order-referenced image still gets the order message, an id the thread can't reach is still "Image not found". Every hidden id is refused, whatever the plan's outcome would have been. Update the function's doc comment.

### `startConversationFromImage`

`canStartFromImage` (`src/lib/design-publish.ts`) currently returns true for the owner before looking at `isHidden`. Make a hidden image refused for everyone, the owner included:

```ts
if (params.image.isHidden) return false;
if (params.imageOwnerId === params.userId) return true;
return params.image.publishedAt !== null;
```

The action already selects `isHidden` and throws "Image is not available" when `canStartFromImage` is false, so the action body needs no new check. Update the doc comment on `canStartFromImage` and the "Visibility:" paragraph above `startConversationFromImage`. Check every other caller of `canStartFromImage` and report what each one's behaviour change is (none is expected outside this action).

### Tests

New `src/app/design/__tests__/delete-design-image-hidden.integration.test.ts` (pattern and mocks: `src/app/design/__tests__/set-primary-image.integration.test.ts`, which #319 extended for the same kind of refusal):

1. The owner calls `deleteDesignImage` on their own hidden image: throws "This image is not available"; the image, publication, composition, link and conversation rows are all intact.
2. Someone who does not own the design: "Unauthorized" (not the hidden message).
3. An id the thread cannot reach: "Image not found".
4. A hidden image pinned by an order line: the order message, as before.
5. A visible image: deleted as before.
6. A hidden image that is a seed in this thread (owned by someone else): refused with "This image is not available"; the seed link is intact.

`src/lib/__tests__/design-publish.test.ts`, `canStartFromImage`: owner and hidden is false; owner and not hidden is true (published or not); stranger, published and visible is true; stranger and hidden is false; stranger and unpublished is false. Change any existing case that asserts the old owner-and-hidden result, and say so in your report.

`src/app/design/__tests__/fresh-start-seed.integration.test.ts`: the owner starts from their own hidden image: throws "Image is not available", and no `design` row and no `conversation_image` row was written.

Commit: `deleteDesignImage and startConversationFromImage refuse an admin-hidden image (#310 item 2)`.

## What a reviewer will attack

- Any path that still deletes a hidden image's `image`, `image_publication` or mirror `product` row, or its R2 object.
- A foreign-key failure in `executeDesignDeletion`'s batch caused by a row that now survives.
- A hidden image keeping a conversation alive that the owner asked to delete.
- The order of refusals in `deleteDesignImage` leaking that a foreign id is hidden.
- `adminHiddenImageIds` disagreeing with `isImageAdminHidden` on any input (no publication row, `is_hidden` false, a placement-render id).

---

# Slice C: no Order when the image's conversation is gone (#321)

Branch `claude/no-order-without-conversation`, worktree `.claude/worktrees/no-order-without-conversation`.

## Ruling this slice implements (Nico, 2026-10-11; issue https://github.com/nicolovejoy/prntd/issues/321)

1. `resolveBuyableImage` refuses a published image whose conversation is gone.
2. `getImagePage` takes `canOrder` from that, so the image detail page shows no Order instead of one that fails.

**Not in this slice:** whether such a listing also leaves the Shop feed. That question is still open with Nico. Do not touch `src/lib/discover-feed.ts` or any feed query.

## The state being fixed

A published image can outlive its home conversation: the conversation is deleted while another conversation holds the image as a seed (the delete plan's `detach-seed` outcome), or a composition or cart line pins it. `image.source_design_id` then names a conversation row that no longer exists (the column has no foreign key).

Today `resolveBuyableImage`'s published branch returns `designId = image.designId` without checking the row exists (`src/lib/buyable-image.ts`). `createStripeCheckoutForOrder` then inserts the order first and the insert fails on `order.design_id`'s foreign key, before any Stripe session. Add to cart fails the same way on `cart_item.design_id`. The buyer sees a generic error. `getImagePage` (`src/app/d/actions.ts`) sets `canOrder` true for any published image without looking.

## Files

- Modify: `src/lib/buyable-image.ts`
- Modify: `src/app/d/actions.ts` (`getImagePage`'s `canOrder`, and the comments that describe it)
- Create: `src/lib/__tests__/buyable-image.integration.test.ts` (if a test file for `resolveBuyableImage` already exists under another name, extend that one instead)
- Create: `src/app/d/__tests__/buy-conversation-gone.integration.test.ts`
- Modify: `src/app/d/[imageId]/__tests__/owner-order-page.test.tsx` (one test)
- Comments only, if they become untrue: `src/lib/design-publish.ts` (`canBuyPublishedImage`'s doc), `src/app/d/[imageId]/page.tsx`, `src/lib/mockup-render.ts`, `src/lib/back-sources.ts`

No change is expected in `src/app/d/[imageId]/page.tsx`'s markup: it already has a branch for `img.canOrder === false` (the plain hero, no Order), written for the owner of an unpublished image with no live conversation.

## Task C1: the gate and the page

### `resolveBuyableImage`

Move the conversation lookup above the published branch and make it answer both branches with one query:

- **Published and visible:** the conversation row named by `image.designId` must exist. Its owner is not checked (on a Shop sale the conversation is the seller's). Missing: `{ ok: false, reason: "not-allowed" }`.
- **Unpublished:** unchanged. The row must exist and belong to the buyer.

`reason` is `not-allowed`, not `not-found`: the image exists and is public, it just cannot be ordered. Callers word `not-allowed` as "Image is not available" (cart) or "Unauthorized" (the image detail page's actions); do not change their wording.

Rewrite the function's doc comment: "Published: nothing more is asked" is no longer true. Search for other comments that say a published image is always buyable and correct them.

Every caller gains the refusal with no change of its own: `buyPublishedDesign`, `addToCart`'s image path, `updateCartItem` through the same resolver, the two mockup actions, the back-source read, and the cart's attribution lookup. List them in your report with one line each on what a buyer now gets.

### `getImagePage`

`canOrder` is currently `publishedAt !== null || (await resolveBuyableImage(imageId, viewerId)).ok`. The page query already left-joins the conversation for `hasSourceConversation` (`r.sourceDesignRowId !== null`). Make a published image's `canOrder` false when its conversation is gone. Prefer the value the query already has, so a public page load costs no extra query; but first confirm that the page query's join and `resolveBuyableImage`'s `image.designId` name the same conversation for every image (`getDesignImageWithOwner` documents how `designId` is derived). If they can differ, call `resolveBuyableImage` for both branches instead and say so in your report: the page and the gate must never disagree.

Update the comments above `canOrder` and on the `canOrder` field of the page type.

### The page for such an image

Read the `img.canOrder === false` branch of `src/app/d/[imageId]/page.tsx` and report, without changing it, what each of these viewers sees and can do on a published image whose conversation is gone: a signed-out visitor, a signed-in stranger, and the owner (in particular whether the owner still reaches Unpublish and the naming and backdrop controls). If the owner loses a control they need, report it as a concern; do not add UI.

### Tests (real DB)

Build the state with the real delete path, not by hand: seed user A's conversation with a published image, link that image as a `seed` in a second conversation, then run `planDesignDeletion` and `executeDesignDeletion` (`src/lib/delete-design.ts`) on the first. The image must come out as `detach-seed` with its row, publication row and composition intact and its conversation row gone. Assert that precondition in the test.

`src/lib/__tests__/buyable-image.integration.test.ts`:

1. Published image, conversation exists: `ok`, `published: true`, for a stranger, for the owner and for a signed-out viewer (`null`). Unchanged behaviour.
2. Published image, conversation gone: `{ ok: false, reason: "not-allowed" }` for a stranger, for the owner and for `null`.
3. Unpublished own image, live conversation: `ok`, `published: false`. Unchanged.
4. Unpublished own image whose conversation is gone: `not-allowed`. Unchanged.
5. Published and admin-hidden: `not-allowed`. Unchanged.
6. A placement-render id, and an id that names nothing: `not-found`. Unchanged.

`src/app/d/__tests__/buy-conversation-gone.integration.test.ts` (pattern and mocks: `src/app/d/__tests__/buy-published-design.integration.test.ts` and `src/app/cart/__tests__/add-to-cart-front-pin.integration.test.ts`):

1. `getImagePage` for the image: a page is returned (it is still public), `canOrder` is false, `hasSourceConversation` is false, `publishedAt` is set.
2. `getImagePage` for an ordinary published image: `canOrder` true.
3. `buyPublishedDesign` on the image: rejects; no `order` row was written; the Stripe session create mock was not called.
4. `addToCart` with the image as the front: rejects with "Image is not available"; no `cart_item` row.
5. The front mockup action on the image: rejects (its `not-allowed` wording).

`owner-order-page.test.tsx`: a published image with `canOrder: false` renders no Order button.

Commit: `No Order on a published image whose conversation is gone (#321)`.

## What a reviewer will attack

- The page showing Order while the gate refuses, or the reverse, for any image.
- An extra query on every public image-page load.
- A published image with a live conversation being refused (a Shop sale to a stranger must not require the buyer to own the conversation).
- `not-found` and `not-allowed` being swapped for any existing case.
- A caller of `resolveBuyableImage` that now fails in a new way (the cart's attribution lookup treats a refused page image as contributing nothing).
