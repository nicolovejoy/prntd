# Cart on embedded checkout — spec (#278 slice 6b, #135 slice 4)

Decided with Nico on 2026-10-10; his decisions are listed under "Decisions".
Everything below that those decisions did not settle is Claude's ruling,
marked *(ruling)*, each with what it costs if wrong. Written against main at
`8bf8160`. No price appears in this document, by rule.

## What it is

The multi-item cart's Checkout button opens Stripe Embedded Checkout on our
own `/checkout` page, as the image detail page's Order button has done since
2026-09-29, instead of sending the buyer to Stripe's hosted page. One order,
N lines, one payment form, on prntd.org from the cart to the receipt.

No schema change, no migration, no new environment variable, no new
user-facing string.

## Decisions (Nico, 2026-10-10)

1. The cart rides the existing `EMBEDDED_CHECKOUT_ENABLED` switch. No new
   switch. Two consequences:
   - Merging makes it live in Production at once, because that switch is on
     there. There is no dark launch.
   - There is one kill switch for both surfaces. Turning
     `EMBEDDED_CHECKOUT_ENABLED` off sends new checkouts from the image detail
     page and from the cart to Stripe's hosted page. See "Rollback" for what
     it does to sessions that are already open.
2. When the embedded config fails closed (publishable key missing, malformed,
   or in the other mode than the secret key), the cart uses hosted checkout
   and logs one `console.error` naming the reason, as the image detail page
   does.
3. The cart's session builder (`buildCartCheckoutSessionParams`) gets an
   embedded mode. The two order-creation paths, `checkoutCart` and
   `createStripeCheckoutForOrder`, stay separate.
4. The session's `return_url` uses the deployment's own origin
   (`resolveReturnOrigin`), so a purchase on a Preview deployment returns to
   that Preview.
5. "← Back" on `/checkout` goes to `/cart` for a cart session.
6. Shipping is unchanged: the amount quoted when the cart is priced, sent as
   one fixed `shipping_options` line.
7. Each Checkout click still creates a new pending order and a new session,
   and leaves the earlier session payable until it expires. Not changed here.
   A follow-up issue is opened for it.
8. The cart page's Checkout handler gets a `catch` that shows the existing
   checkout-failed line (`CHECKOUT_FAILED` in `src/lib/action-copy.ts`).
9. The dead `/preview` checkout code and `PREVIEW_EMBEDDED_CHECKOUT_ENABLED`
   are removed by a separate slice (6a), not this one.

## Today and after

Today: Cart → Checkout → `checkoutCart` writes one `order` and N `order_item`
rows, creates a hosted session, saves its id, returns Stripe's URL → the
browser leaves for `checkout.stripe.com` → Stripe returns to
`NEXT_PUBLIC_APP_URL/order/confirm`. Backing out returns to
`NEXT_PUBLIC_APP_URL/cart`.

After, with the switch on and a usable key pair: the same rows are written in
the same order, the session is created with `ui_mode: "embedded"`, and
`checkoutCart` returns the relative path `/checkout?session=<id>&from=%2Fcart`.
The buyer stays on our origin: `/checkout` shows "← Back", the review block,
and Stripe's form; Stripe then sends the browser to `/order/confirm` on the
same origin.

With the switch off, or on with a bad key pair: exactly today's behaviour.

## The session

`buildCartCheckoutSessionParams` takes `uiMode?: "hosted" | "embedded"`,
default hosted, the same parameter `buildCheckoutSessionParams` has.

- Hosted: the object it returns today, unchanged, key for key.
- Embedded: the same object with `ui_mode: "embedded"` and
  `return_url: <appUrl>/order/confirm?session_id={CHECKOUT_SESSION_ID}` in
  place of `success_url` and `cancel_url`. Stripe does not accept a cancel URL
  for an embedded session; the way back is our own Back link.

Everything else is identical in both modes: `mode: "payment"`, promotion codes
allowed, the two-hour expiry, US shipping address collection, one line item
per cart line with its quantity, one fixed shipping option, and
`metadata: { orderId, designId }`. The webhook reads `metadata.orderId` and is
indifferent to the mode.

## `checkoutCart`

Order of steps. Only the three marked steps are new.

1. Sign-in gate: no session or an anonymous one returns `{ needsAuth }`.
2. `buildCart` reprices and re-checks every line. An empty cart returns
   `{ url: null }`; a stale line returns `{ url: null, error }`.
3. Shop attribution (may throw before anything is written).
4. **New.** Resolve the embedded config (`embeddedCheckoutConfig()`). Switch
   on but config disabled: `console.error` with the reason, never a key.
   When enabled, resolve the return origin from the request's `Origin` header
   (`resolveReturnOrigin`). This runs before the insert so nothing new can
   throw between the insert and the Stripe call.
5. One `db.batch`: the `order` row and its N `order_item` rows.
6. `stripe.checkout.sessions.create`, **now with `uiMode` and the origin**.
   A throw marks the order abandoned (`abandonSessionlessOrder`) and is
   re-thrown.
7. Save `stripe_session_id` on the order.
8. **New.** Embedded: return
   `{ url: embeddedCheckoutPath(session.id, "/cart") }`. Hosted: return
   `{ url: session.url }` as today.

The return type does not change. `url` is an absolute Stripe URL (hosted) or
a path on our own origin (embedded); the cart page assigns either to
`window.location.href`.

Hosted checkout keeps building its URLs from `NEXT_PUBLIC_APP_URL` whatever
the request's origin is, as it does today. A consequence that already holds
for the image detail page: a hosted purchase on a Preview returns to
prntd.org; an embedded one returns to the Preview.

The cart is still cleared only by the webhook on payment.

## `/checkout` for a cart session

- `from` is the constant `/cart`, set by the server, never taken from the
  client. `safeCheckoutReturnPath` already accepts it; the validation does not
  change and no allow-list is added. A tampered `from` in the address bar
  falls back to `/shop` as it does today.
- "← Back", the expired screen, the unavailable screen and the payment form's
  two failure notices all point at `/cart`.
- A signed-out or anonymous visitor is sent to sign-in and back to the same
  `/checkout` URL, as today. Another account opening the URL gets a 404 and
  Stripe is never called, as today.
- The review block already renders one row per order line: the cached front
  mockup for that line's front image, or the artwork on the shirt colour; the
  product name with `×N` when the quantity is above one; colour and size; a
  back-design row when the line has one. No test seeds more than one line
  today. This slice adds those tests (loader and page).
- **No price in the review block.** That rule does not change: Stripe's form
  is the only place a price appears on `/checkout`, because a promotion code
  applied inside it would make a number of ours wrong. The guard is the
  no-`$` assertion in `src/app/checkout/__tests__/page.test.tsx`; this slice
  adds the same assertion for a multi-line summary and in the nightly.
- **What is in fact single-line: the laptop layout.** From `md` up each line
  becomes a full-width square (`md:w-full md:aspect-square`), sized for one
  shirt. A cart order would stack one large square per line beside the form.
  *(ruling: when the summary has more than one line, every line keeps the
  phone's row layout, a 96px tile beside the text, at every width. A
  single-line order is unchanged. Cost if wrong: two class strings and one
  prop.)* Phones are unchanged by this.
- Found, not changed:
  - The "View larger" buttons are named by product (`View larger: Classic
    Tee`), so two lines of the same garment have the same accessible name.
    Each sits beside its own colour and size text. Making the names unique
    needs a new string, so it is an open question, not built here.
  - On a phone the review rows come before the form, so a long cart pushes
    the form down the page (roughly 130px a line, more with a back design).
    Not collapsed in this slice.
  - Lines are read `ORDER BY created_at`, and every line of a cart order
    shares one `created_at` second (one INSERT). SQLite returns such ties in
    insert order, which is cart order, and `/order/confirm` and `/orders`
    make the same assumption. The new loader test pins that order.

## `/order/confirm`

Unchanged. It already lists N lines and already reads the Stripe session for
a pending order whatever the switches say.

Its "Return to checkout" link, shown when the session is still open (the buyer
backed out of a redirect-based payment method, or opened the URL directly),
is `/checkout?session=<id>` with no `from`. For a cart session that means
Back on the resumed checkout page goes to `/shop`, not `/cart`.
*(ruling: left as it is in this slice. The image detail page has the same
gap today: its resumed checkout also backs out to the Shop. Cost if wrong: a
buyer who resumes and then taps Back lands on the Shop; their cart is intact
and one tap away in the header. The fix that serves both surfaces is to carry
`from` on `return_url` and have `/order/confirm` pass it through
`safeCheckoutReturnPath`; that adds a second place `from` is read, so it gets
its own slice.)*

## The cart page

`handleCheckout` has a `try`/`finally` with no `catch`, so when `checkoutCart`
throws (Stripe unavailable, a database error, a lost response) nothing is
shown and the button just becomes active again. After this slice a thrown
action shows `CHECKOUT_FAILED` in the notice slot the refusal already uses
(`cart-checkout-error`). The line is true in every thrown case: no session
reached the buyer, so nothing can have been charged.

*(ruling: the `catch` wraps the action call only. A structured refusal
(`{ error }`) keeps its own message even if the cart re-read that follows it
fails; a catch around the whole block would replace "A design in your cart is
no longer available…" with the generic line. Cost if wrong: a few lines.)*

Not changed: the button returns to its idle label as soon as the navigation
has been requested, so a second tap in that moment starts a second order.
That is decision 7's behaviour and goes in the follow-up issue.

## What does not change

Shipping; prices; the order and order_item rows; Shop attribution; the
webhook claim, ledger rows, cart cleanup and fulfillment; the session expiry
and `abandoned_at`; the sign-in gate; `createStripeCheckoutForOrder` and the
image detail page; `/order/confirm`; the session-per-click behaviour.

## Tests

- Unit (`src/lib/__tests__/checkout.test.ts`): the cart builder's hosted
  shape pinned key for key, and the embedded shape.
- Real-DB integration (new
  `src/app/cart/__tests__/checkout-cart-embedded.integration.test.ts`):
  embedded session parameters; hosted fallback with the switch off, the key
  missing, the key malformed and the modes mismatched; the returned URL; the
  order and every order_item row present before Stripe is called, in both
  modes; the Stripe-failure path; `Origin` handling; the sign-in gate, a stale
  line and an empty cart writing nothing; a second Checkout making a second
  order and session.
- Component (`cart-page.test.tsx`): the thrown-action notice, the relative
  URL being followed, the refusal surviving a failed re-read.
- `/checkout` (`embedded-checkout-session.integration.test.ts`,
  `page.test.tsx`, `checkout-line.test.tsx`): a three-line order through the
  loader; a two-line summary through the page; the compact rows; Back to the
  cart; no `$`.
- Nightly Stripe e2e (`e2e/stripe-money-path.spec.ts`): the cart test pays
  through the embedded iframe, asserts two review rows, Back to `/cart`, the
  submitted order, the ledger rows, the two order lines and the emptied cart.

PR CI cannot open `/checkout` in a browser: neither the switch nor a
publishable key is set in `ci.yml`, so the page 404s there. The only
automated run that pays through the cart's embedded form is the
`stripe-e2e.yml` workflow, which is dispatched on the branch before merge.

After this slice no automated test pays through Stripe's hosted page. Hosted
remains the fail-closed fallback and is covered by the parameter tests only.

## Rollout

The pull request is titled with HOLD until three gates have passed on its
final commit:

1. The `stripe-e2e.yml` workflow, dispatched on the branch, is green.
2. A dedicated adversarial review of the money path has run and each finding
   is fixed or ruled on, on the PR.
3. Nico's smoke on the PR's Preview deployment has passed. The smoke is
   written out in the plan (Task 8).

What a Preview can and cannot show:

- Vercel's Preview scope already has test-mode Stripe keys,
  `EMBEDDED_CHECKOUT_ENABLED=true` and `PRINTFUL_DRY_RUN=true`, so checkout
  needs no env change. Whether `CART_ENABLED` is set in the Preview scope is
  not recorded anywhere; the smoke needs it (plan, open question 5). After
  any Preview env change a commit must be pushed: a Preview only builds on a
  push.
- A Preview purchase gets no Stripe webhook. The order stays `pending`, the
  cart is not emptied, no email is sent, and Orders does not list it.
  `/order/confirm` still says "Order confirmed." because it reads the Stripe
  session.
- The Preview database's Shop is empty, so the tester generates designs first.

After merge: the `prod-smoke` workflow runs on its own; the first scheduled
nightly on main is the first run of the new cart test there.

### Rollback

- Narrow: revert the PR. The image detail page stays on embedded checkout;
  cart sessions already open on `/checkout` keep working because the page
  still exists.
- Broad: set `EMBEDDED_CHECKOUT_ENABLED` off in Production and redeploy (an
  env change only reaches new deployments). New checkouts from both surfaces
  go to Stripe's hosted page. An embedded session that is open at that moment
  cannot be finished: `/checkout` 404s and an embedded session has no hosted
  URL. Its order expires and is marked abandoned; the buyer still has the
  cart and can check out again.

## Slice 6a (remove the `/preview` remnants)

6a and this slice edit several of the same files:
`src/lib/embedded-checkout.ts` and `src/lib/flags.ts` (comments here, code
there), `src/app/checkout/page.tsx`, `src/lib/checkout.ts`,
`src/lib/__tests__/embedded-checkout-session.integration.test.ts`,
`src/app/checkout/__tests__/page.test.tsx`, `e2e/stripe-money-path.spec.ts`,
`docs/stripe-e2e.md`, `.github/workflows/stripe-e2e.yml` and `CLAUDE.md`.
Built at the same time they would conflict textually in most of those. They
are built one after the other; the second starts from main after the first
has merged and re-reads every line number.

This slice calls only names that 6a keeps: `embeddedCheckoutConfig`,
`embeddedCheckoutFlag`, `embeddedCheckoutPath`, `resolveReturnOrigin`,
`safeCheckoutReturnPath`. It does not call `embeddedCheckoutPageFlag` or
`embeddedCheckoutPageConfig`, which 6a folds away.

## Not in this slice

Removing `/preview` checkout code or `PREVIEW_EMBEDDED_CHECKOUT_ENABLED`
(6a); merging the two order-creation paths; expiring the earlier session when
a new one is created (follow-up issue); `from` on `/order/confirm`'s resume
link; unique names for the "View larger" buttons; collapsing a long review
block; any change to shipping, pricing or the webhook.

## Open questions

Numbered, with a recommendation each, in the plan:
`docs/superpowers/plans/2026-10-10-cart-embedded-checkout.md`, "Open questions
for Nico".
