# Shop feed and checkout session expiry: implementation plan

> Built subagent-driven on 2026-10-13: one Sonnet implementer per slice in its own worktree, the controller re-runs the CI gate, one Opus whole-branch review per branch, and a dedicated Opus adversarial review for slice E (money path). The ledger with every ruling is `docs/superpowers/ledgers/2026-10-13-feed-and-session-expiry.md`.

**Goal:** a published listing that can no longer be ordered leaves the Shop, and a buyer has at most one payable Stripe Checkout session at a time.

**Source of the work:** Nico's answers on 2026-10-13 to the two open questions of the 2026-10-12 batch. (1) A listing whose conversation is gone also leaves the Shop feed (#321). (2) When `/checkout` refuses a session for an admin-hidden image it also expires that Stripe session, built with #315 (expire the buyer's earlier sessions when a new one is created). There is no separate spec: the two issues and the rulings quoted in each slice are the authority.

**Architecture:** slice D adds one condition to the feed's single query (the image's conversation must exist, the rule the buy gate already applies) and mirrors it in the parity read. Slice E adds `src/lib/expire-checkout-sessions.ts` and calls it from the two order-creation paths after the new session exists, and from `/checkout`'s hidden-artwork refusal. No schema change in either slice.

**Slices and branches:** D `claude/feed-drops-unorderable` (stacked on #322 until it merges); E `claude/expire-superseded-sessions`. They share no file.

## Review focus

- A card in the feed whose page shows no Order, or a sellable listing dropped from the feed (legacy rows with `source_design_id` null).
- Two concurrent checkouts expiring each other, leaving the buyer with no payable session.
- An `expire` call before the new session exists or after its creation failed.
- An order marked abandoned without a confirmed expiry, and anything that then treats a paid order as abandoned.
- The checkout click failing, hanging or returning a different URL because of the expiry step.

---

## Global Constraints (every slice)

These bind every task. They come from `CLAUDE.md`, `AGENTS.md` and Nico's rulings on #310, #321 and #315.

1. **No new user-facing string.** Each slice names the exact existing string to reuse. If you think a new string is needed, stop and report; do not write one.
2. **Hidden means admin-hidden**: the `image_publication` row's `is_hidden = true`, and nothing else. `image_publication` is the one reader of image visibility. Never read `product.status` to decide visibility.
3. **Owner ruling (2026-10-05):** once an admin hides an image nobody can buy, print or mock it up, its owner included, and the owner cannot undo the hide or delete the moderation record.
4. **No schema change.** `npm run db:generate` must print "No schema changes" and leave `drizzle/` untouched.
5. **Tests:** TDD. Real-DB integration tests run against an in-memory libSQL built from `schema.ts` (`src/lib/__tests__/test-db.ts`, `createTestDb`), with the shared factories in `src/lib/__tests__/factories.ts`. `src/lib/**` tests run under node, not jsdom. Follow the mock shape of the neighbouring test files named in your slice.
6. **Do not edit** `src/lib/__tests__/factories.ts`, `src/lib/__tests__/test-db.ts`, `CLAUDE.md`, `AGENTS.md`, or anything under `docs/`. Two slices are being built in parallel on separate branches; those files are shared. If a seed helper is missing, define it inside your own test file.
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

The names and line numbers in the brief were read from `main` at `ab929c4` (slice E) and from `5ec3d08` (slice D). The code is the authority for names; the behaviour described in the brief is the requirement.

---

# Slice D: the Shop feed leaves out a listing that cannot be ordered (#321)

Branch `claude/feed-drops-unorderable`, worktree `.claude/worktrees/feed-drops-unorderable`. The branch starts at `5ec3d08`, the head of `claude/no-order-without-conversation` (pull request #322, not merged yet), because this slice builds on that slice's gate change. Do not merge or rebase anything.

## Ruling this slice implements (Nico, 2026-10-13, on https://github.com/nicolovejoy/prntd/issues/321)

A published listing whose conversation is gone also leaves the Shop.

## The state

A published image can outlive its home conversation: the conversation is deleted while another conversation holds the image as a seed, or a composition or cart line pins it. #322 made the buy gate (`resolveBuyableImage`, `src/lib/buyable-image.ts`) refuse such an image and made its image detail page show no Order. The Shop feed (`getPublishedFeed`, `src/lib/discover-feed.ts`) still shows its card on the landing page and on `/shop`.

## The rule

The feed shows a published, visible listing only when the buy gate would let a signed-out visitor order it. For a published, visible `image` row that comes down to one condition: the image's conversation id names an existing `design` row. The conversation id is the one `getDesignImageWithOwner` derives (`src/lib/design-images.ts`): `image.source_design_id`, else the design of the image's `output` link in `conversation_image`. An image with neither has no conversation id, the gate answers `not-found` for it, and it leaves the feed too.

The page and the gate must never disagree with the feed in this direction: a card in the feed whose page shows no Order.

## Files

- Modify: `src/lib/discover-feed.ts` (`getPublishedFeed`, the header comment, the comment at the dedupe fallback)
- Modify: `src/lib/feed-visibility-parity.ts` (its SQL mirrors the feed's joins and its header says the two stay in step)
- Modify: `scripts/check-feed-visibility-parity.ts` (print the new section; `scripts/**` is outside lint and tsconfig, so read it carefully)
- Tests: `src/lib/__tests__/discover-feed.integration.test.ts`, `src/lib/__tests__/feed-visibility-parity.integration.test.ts`, `src/app/d/__tests__/buy-conversation-gone.integration.test.ts`
- Comments only, if they become untrue: `src/app/d/actions.ts` (`getDiscoverFeed`), `src/lib/back-sources.ts` (the comment near "the getDiscoverFeed surface"), `src/lib/buyable-image.ts`

## Task D1: the feed

Change `getPublishedFeed` so a listing with no live conversation is not returned. Requirements:

- One query, as today. The feed runs on every landing-page and `/shop` load; no second round trip and no per-row lookup.
- The condition is in SQL, before the `limit`, so a dropped row never takes a slot from a row that should show.
- `FeedRow.designId` is the dedupe key (one card per conversation). Make it the same conversation id the rule tests, and decide what happens to the `r.designId ?? r.imageId` fallback: if no row can reach it any more, remove it and its comment; if one can, say which. Report the decision.
- Ordering, ranking, the over-fetch window and the one-card-per-conversation collapse are unchanged for every listing that stays.
- `/admin/published` keeps listing the image (moderation needs it). Confirm it does not read `getPublishedFeed`; do not change it.

Then read every other place that lists published images to visitors (the back-source group described near `src/lib/back-sources.ts:333`, any sitemap, share-card or designer listing you find) and report, one line each, whether it still shows such an image and what happens when a visitor acts on it. Do not change them.

### Tests (real DB)

Build the conversation-gone state with the real delete path, as `src/app/d/__tests__/buy-conversation-gone.integration.test.ts` does (seed link in a second conversation, then `planDesignDeletion` and `executeDesignDeletion`), not by hand.

`src/lib/__tests__/discover-feed.integration.test.ts`:

1. An ordinary published listing is in the feed. Unchanged.
2. A published, visible listing whose conversation was deleted is not in the feed; a second ordinary listing seeded beside it still is.
3. Agreement with the gate. Seed this mix, each a published image with a composition: ordinary; admin-hidden; conversation gone; `source_design_id` null with a live `output` link; `source_design_id` null with no link at all; `source_design_id` naming a missing row while an `output` link names a live conversation (if the schema lets you build it; if `getDesignImageWithOwner` cannot resolve it either way, say so). Assert the set of feed image ids equals the set of seeded ids for which `resolveBuyableImage(id, null)` returns `ok`.
4. The dropped row does not take a slot: with `limit` 1 and a ranked conversation-gone listing ahead of an ordinary one, the feed returns the ordinary one.
5. Two published images of one live conversation still collapse to one card, the ranked one.
6. The existing tests in the file pass unchanged, or you report each change and why.

`src/app/d/__tests__/buy-conversation-gone.integration.test.ts`: `getDiscoverFeed()` does not contain the image, and does contain the ordinary published image seeded beside it.

Commit: `Shop feed leaves out a listing whose conversation is gone (#321)`.

## Task D2: the parity read

`src/lib/feed-visibility-parity.ts` compares the feed under the old visibility filter (`product.status`) and the new one (`image_publication`), for #319. Keep that comparison and its `clean` flag meaning what they mean today. Add, in the same single read batch:

- the image ids the feed now returns (visible and with a live conversation), and
- the visible published listings the feed leaves out for lack of a conversation: image id, product id, title, and the conversation id that names nothing (or null when the image has none).

`scripts/check-feed-visibility-parity.ts` prints that list under its own heading with a count, after the existing output, and its exit code is unchanged (a listing left out for this reason is expected, not a failure). Nico runs the script on Production before the merge to see which cards will leave the Shop, so the lines must identify the listing without a second lookup.

Update the module header and the comment in `discover-feed.ts` that points at it.

Tests in `src/lib/__tests__/feed-visibility-parity.integration.test.ts`: a database with one ordinary listing, one hidden and one conversation-gone listing reports exactly the conversation-gone one in the new list, the ordinary one in the feed ids, and the same `clean` and disagreement results as before your change.

Commit: `Feed parity read lists visible listings left out for lack of a conversation (#321)`.

## What a reviewer will attack

- A listing in the feed that the gate refuses, or one the gate allows that the feed drops.
- A second query, or a filter applied after the limit.
- A published image of a live conversation dropped because of how its conversation id is stored (legacy rows with `source_design_id` null).
- Ranking or dedupe changed for ordinary listings.
- The parity module's SQL drifting from the feed's.

---

# Slice E: a new checkout expires the buyer's earlier Stripe sessions; a hidden refusal expires its session (#315)

Branch `claude/expire-superseded-sessions`, worktree `.claude/worktrees/expire-superseded-sessions`, from `main` at `ab929c4`.

This is the money path. It gets a dedicated adversarial review after the ordinary one.

## Rulings this slice implements

- **Nico, 2026-10-13:** when `/checkout` refuses a session because a line shows an admin-hidden image, also expire that Stripe session.
- **#315's proposal** (https://github.com/nicolovejoy/prntd/issues/315), built as written there: once a new checkout session has been created for a buyer, expire that buyer's earlier open sessions for still-pending orders, after the new session exists and never before, ignoring failures. Keep the cart's Checkout button disabled until the page unloads and reset it on a back/forward-cache restore.

## The problem

Every Order or Checkout click creates a new pending order and a new Stripe Checkout session and leaves the earlier one payable for two hours (`CHECKOUT_SESSION_TTL_SECONDS`, `src/lib/checkout.ts`). A buyer who goes back, changes the cart, checks out again and pays can still open the first session from history and pay it: a second paid order, a second Printful order. And since #324, `/checkout` shows the expired screen for a session whose line was hidden, but a buyer who already has the form open can still pay it.

## Files

- Create: `src/lib/expire-checkout-sessions.ts` (not `"use server"`: it trusts the ids it is given)
- Create: `src/lib/__tests__/expire-checkout-sessions.integration.test.ts`
- Modify: `src/lib/order-checkout.ts` (`createStripeCheckoutForOrder`)
- Modify: `src/app/cart/actions.ts` (`checkoutCart` only)
- Modify: `src/lib/embedded-checkout-session.ts` (`loadEmbeddedCheckout`, the hidden branch and the doc comment)
- Modify: `src/app/cart/page.tsx` (`handleCheckout`, one effect)
- Modify tests: `src/app/cart/__tests__/checkout-cart-embedded.integration.test.ts`, `src/lib/__tests__/embedded-checkout-session.integration.test.ts`, `src/app/d/__tests__/buy-published-design-embedded.integration.test.ts`, `src/app/cart/__tests__/cart-page.test.tsx`, and any test whose Stripe mock now needs an `expire` function
- Modify: `e2e/stripe-money-path.spec.ts` (one test; see Task E4)
- Comments only: `src/lib/checkout.ts`, `src/lib/db/schema.ts` (the comment above `abandonedAt`; a comment change must leave `npm run db:generate` printing "No schema changes")

## Task E1: the helper

### Interfaces produced

```ts
/**
 * Asks Stripe to expire one open Checkout session. True when Stripe reports
 * it expired. Never throws and never waits longer than the timeout: Stripe
 * refuses a session that is complete or already expired, and that refusal,
 * a network error and a timeout all read as false.
 */
export async function expireCheckoutSession(sessionId: string): Promise<boolean>

/**
 * After a new checkout session exists for `orderId`, expires the same buyer's
 * earlier open sessions. Never throws. Returns what it attempted, for tests
 * and logs.
 */
export async function expireEarlierCheckoutSessions(params: {
  userId: string;
  orderId: string;
}): Promise<{ orderId: string; sessionId: string; expired: boolean }[]>
```

### Behaviour

`expireEarlierCheckoutSessions` selects `order` rows that are all of:

- the same `user_id`;
- `status = 'pending'`, `abandoned_at IS NULL`, `stripe_session_id IS NOT NULL`;
- strictly earlier than the new order. Read how `order.created_at` is stored and pick a total order (created time, then id) such that of two checkouts created at the same moment exactly one counts as earlier. Two concurrent checkouts must never expire each other;
- young enough to still be open: created within the session lifetime (`CHECKOUT_SESSION_TTL_SECONDS`) plus five minutes. An older order's session has already expired at Stripe.

It expires the matching sessions together (`Promise.all` over `expireCheckoutSession`), newest first, at most ten.

When Stripe reports a session expired, mark its order abandoned with the existing conditional writer `handleStripeCheckoutExpired` (`src/lib/webhook-handlers.ts`; only a still-pending, not-yet-abandoned order is touched). Stripe also sends `checkout.session.expired` for it and that delivery then finds nothing to do. When Stripe refuses or the call fails, the order row is left exactly as it is: a session that is being paid must stay claimable by the webhook.

Use `withTimeout` (`src/lib/timeout.ts`) with `STRIPE_SESSION_READ_TIMEOUT_MS` and `describeStripeError` (`src/lib/checkout-session-status.ts`) for the Stripe call. Log one `console.error` line per failed attempt (session id and Stripe's message, no card or customer data) and nothing on success.

A database error inside the helper is caught and logged; the helper still returns.

### Tests (real DB, Stripe mocked the way `src/lib/__tests__/embedded-checkout-session.integration.test.ts` mocks it)

1. No earlier order: Stripe is not called.
2. One earlier pending order with a session: `expire` is called once with its session id; that order now has `abandoned_at`; the new order is untouched.
3. Not touched, each its own case: an earlier order that is paid; one already abandoned; one with no session id; another buyer's pending order with a session.
4. An order created after the new one is not expired.
5. Two orders with the same created time: calling the helper for each expires at most one of them, and never both.
6. Stripe rejects (the session is complete): returns `expired: false`, the order stays `pending` with `abandoned_at` null, nothing is thrown.
7. Stripe never answers: the helper returns once the timeout has passed (fake timers), nothing is thrown, the order is unchanged.
8. An order older than the window is skipped.
9. Twelve earlier open orders: ten `expire` calls, for the ten newest.
10. The database read throws: nothing is thrown, Stripe is not called.
11. An order abandoned by this helper is still claimed when a paid `checkout.session.completed` arrives for it. If an existing test already pins that an abandoned order can be claimed, name it in your report and add this one beside it only if the existing one does not cover an order with a session id.

Commit: `Expire a buyer's earlier checkout sessions (#315)`.

## Task E2: the two checkout paths call it

In `createStripeCheckoutForOrder` and in `checkoutCart`, after the new session id has been written to the order and before returning, `await expireEarlierCheckoutSessions({ userId, orderId })`. Requirements:

- Never before the new session exists. When `stripe.checkout.sessions.create` throws, the earlier sessions are left alone (the buyer must keep a payable session) and no `expire` call is made.
- It cannot fail or change the result of the checkout: the returned URL is the same with or without it.
- It is awaited, not handed to `after()`: the attempt must have been made by the time the buyer is sent to the new form. The wait is bounded by the timeout, and there is a Stripe call only when an earlier open session exists.
- One live checkout per buyer across both surfaces: a cart checkout expires an earlier session from the image detail page, and the reverse.

The legacy `createCheckoutSession` (`src/app/order/actions.ts`) goes through `createStripeCheckoutForOrder` and gets the behaviour with no edit; do not edit that file. Update the doc comments on both functions, the comment in `checkoutCart` near "The cart is NOT cleared here", and `src/lib/checkout.ts`'s header comment on session lifetime.

### Tests

`src/app/cart/__tests__/checkout-cart-embedded.integration.test.ts` has a `describe` named "each Checkout makes its own order and session (known behaviour, #278 slice 6b)". Each Checkout still makes its own order and session; what changes is that the earlier session is expired. Rename it and assert:

1. Two `checkoutCart` calls: two orders, two sessions; `expire` was called once, with the first session's id, after the second `create` resolved (check call order); the first order is abandoned, the second is pending; the second call's URL names the second session.
2. The second `create` throws: `expire` is not called; the first order is still pending and not abandoned.
3. `expire` rejects: the second checkout still returns its URL.
4. Another buyer's open session is not expired by this buyer's checkout.

`src/app/d/__tests__/buy-published-design-embedded.integration.test.ts`: the same four for `buyPublishedDesign`, plus one cross-surface case (an order from the image detail page, then a cart checkout by the same buyer: the first session is expired).

Go through every test file that mocks `@/lib/stripe` and runs one of these paths; give each mock an `expire` so no test passes through a caught `TypeError`. List the files you touched for that.

Commit: `Checkout expires the buyer's earlier sessions once the new one exists (#315)`.

## Task E3: `/checkout` expires a session it refuses for hidden artwork

In `loadEmbeddedCheckout`'s hidden-artwork branch (the session is `open` and a line shows hidden artwork): `await expireCheckoutSession(params.sessionId)`; when it returns true, mark the order abandoned with `handleStripeCheckoutExpired`; return `{ kind: "expired" }` whether or not the expiry succeeded.

Nothing else in the function's order of checks changes. No expiry on any other path: not for a `complete` session, not when the hidden check throws (`unavailable`), not for a visible line. Rewrite the doc comment's last sentences, which today say the session is not expired.

### Tests (add to the hidden-artwork `describe` in `src/lib/__tests__/embedded-checkout-session.integration.test.ts`)

1. Hidden front, open embedded session: `expired`; `expire` called once with the session id; the order has `abandoned_at`.
2. `expire` rejects: still `expired`; the order is still pending and not abandoned.
3. `expire` never answers: still `expired` once the timeout passes.
4. Hidden and Stripe says `complete`: `complete`; `expire` not called.
5. Hidden, open, hosted session: `expired`; `expire` called.
6. Not hidden: `ready`; `expire` not called.
7. The hidden check throws: `unavailable`; `expire` not called.
8. A second load after a successful expiry returns `expired` without calling Stripe at all (the order is abandoned).

Commit: `/checkout expires the Stripe session it refuses for hidden artwork (#310 item 7, #315)`.

## Task E4: the cart's Checkout button, and one real-Stripe test

### Cart page

In `handleCheckout` (`src/app/cart/page.tsx`) the `finally` resets `checkingOut` as soon as the navigation has been requested, so during the wait for `/checkout` to render the button, the quantity steppers and the Edit links are live again and a second tap creates a second order. Keep `checkingOut` true once a navigation has been requested (the `url` case and the `needsAuth` case); reset it on every path that stays on the page (the action threw, a returned `error`, a null `url`). Add a `pageshow` listener that resets it when `event.persisted` is true, as `src/app/d/[imageId]/buy-panel.tsx` does for its Order button (read that effect and its comment first). No copy changes: the button already reads "Redirecting…".

Tests in `src/app/cart/__tests__/cart-page.test.tsx`:

1. After `checkoutCart` resolves with a `url`: the Checkout button is still disabled and reads "Redirecting…", the steppers are disabled and the lines have no Edit link.
2. A persisted `pageshow` re-enables them; a non-persisted one does not.
3. A returned `error`, a thrown action and a null `url` each leave the button enabled.
4. A second click while disabled does not call `checkoutCart` again.

### Real Stripe

`e2e/stripe-money-path.spec.ts` runs against real Stripe test mode in the nightly workflow. Add one test, following the file's existing helpers: a buyer reaches the embedded payment form from the image detail page and the test records that `/checkout?session=…` URL; the buyer goes back and orders again, reaching a second form; opening the first URL now shows the expired screen ("This checkout expired." and "Nothing was charged."). No payment is made in this test. You cannot run it (it needs Stripe keys): write it carefully against the helpers and selectors the file already uses, and say in your report exactly what you could not verify. The controller runs the workflow on the branch.

Commit: `Cart: Checkout stays disabled until the page unloads; a real-Stripe check that an earlier session expires (#315)`.

## What a reviewer will attack

- An `expire` call before the new session exists, or after its creation failed.
- Two concurrent checkouts expiring each other, leaving the buyer with no payable session.
- An order marked abandoned although its session was not confirmed expired, or a paid order that anything then treats as abandoned.
- Another buyer's session expired.
- The checkout click failing, hanging or returning a different URL because of the expiry step.
- An expiry on a `complete` session, or on the paths that return before the hidden check.
- The cart button stuck disabled after an error or after Back.
- A new user-facing string.
