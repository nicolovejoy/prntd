# #135 slice 2 — embedded checkout on the image detail page (flagged)

Branch `claude/135-embedded-checkout`. Source of truth for the design:
`docs/d-buy-checkout-plan.md` ("Stripe Embedded Checkout — verified against
current docs", Part 2, Build checklist slice 2, Answers: all six
recommendations accepted). Slice 1 (mockup on the image detail page, #159)
is live.

Scope: purchases started on the image detail page (`buyPublishedDesign`)
open Stripe Embedded Checkout on our own `/checkout` page instead of the
hosted Stripe page, behind `EMBEDDED_CHECKOUT_ENABLED` (default off).
`/preview` (`createCheckoutSession`) and cart stay hosted (slices 3–4).

## Invariants (every task must preserve these)

1. **Flag off = today, byte for byte.** With `EMBEDDED_CHECKOUT_ENABLED`
   unset/anything but `"true"`: `buyPublishedDesign` sends Stripe exactly the
   params it sends today and returns the hosted URL; `/checkout` 404s;
   `/order/confirm` makes no Stripe call and renders exactly what it renders
   today.
2. **Order rows before the session.** The `order` + `order_item` batch insert
   happens exactly as today, before `stripe.checkout.sessions.create`, and
   `stripeSessionId` is persisted after it, in both modes.
3. **Webhook untouched.** No change under `src/app/api/webhooks/**`,
   `src/lib/stripe-session.ts`, fulfillment or ledger code.
4. **Fail closed.** Flag on but the publishable key missing, malformed, or in
   a different mode (test/live) from the secret key → hosted checkout, plus
   one structured `console.error` line naming the reason (never the key).
   `/checkout` never mounts the Stripe iframe without a usable key and a
   client secret; it renders a plain message with a way back instead.
5. **No price before garment + size are picked** (CLAUDE.md Conventions →
   Pricing). `src/lib/__tests__/no-preselection-price.test.ts` must pass.
6. `/preview` and cart never go embedded in this slice, flag or not.

## SDK facts (verified in this worktree, 2026-09-25)

- `stripe` 20.4.1 pins API version `2026-02-25.clover`. Its
  `Checkout.SessionCreateParams.UiMode` is `'custom' | 'embedded' | 'hosted'`.
  The plan doc's `embedded_page` is the name in later API versions
  (Stripe's current OpenAPI, `2026-09-30.endive`); on our pinned version the
  value is **`"embedded"`**. `return_url` is required for embedded;
  `success_url` and `cancel_url` are not allowed.
- Client packages pinned to the same release train as the server:
  `@stripe/stripe-js@^8.11.0` (loads `js.stripe.com/clover/stripe.js`,
  `initEmbeddedCheckout`) and `@stripe/react-stripe-js@^5.6.1`
  (`EmbeddedCheckoutProvider` + `EmbeddedCheckout`). The v9/v6 lines load the
  `dahlia` train; not used.
- `Checkout.Session.client_secret: string | null` is on the session object,
  so `sessions.retrieve` returns it for an open embedded session. Not
  verifiable without a key; if it comes back null, `/checkout` renders its
  "unavailable" state (fail closed) — Nico's phone test covers it.

## Task 1 — config, builder branch, deps

Files: `package.json`/`package-lock.json` (deps already installed by the
controller), `src/lib/flags.ts`, new `src/lib/embedded-checkout.ts`,
`src/lib/checkout.ts`, `.env.tpl`, tests.

- `flags.ts`: `embeddedCheckoutFlag()` → `process.env.EMBEDDED_CHECKOUT_ENABLED === "true"`.
  Docblock: the raw flag; callers that create or mount an embedded session
  use `embeddedCheckoutConfig()`, which also requires a usable key.
- `embedded-checkout.ts` (pure, no db/network):
  - `resolveEmbeddedCheckoutConfig({ flag, publishableKey, secretKey })` →
    `{ enabled: true; publishableKey } | { enabled: false; reason }` with
    reasons `"flag-off" | "missing-key" | "invalid-key" | "mode-mismatch"`.
    `flag` is the raw env string (`=== "true"` only). Key trimmed; missing =
    undefined/empty. Valid = `/^pk_(test|live)_[A-Za-z0-9]+$/`. Mode of the
    secret key from `sk_`/`rk_` + `test`/`live`; an unparseable secret key
    counts as a mismatch.
  - `embeddedCheckoutConfig()` reads `EMBEDDED_CHECKOUT_ENABLED`,
    `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY` and delegates.
  - `safeCheckoutReturnPath(from: unknown): string` — returns `from` only when
    it is a string starting with `/`, not `//`, containing no `\` and no
    control chars; otherwise `"/shop"`.
  - `embeddedCheckoutPath(sessionId, backPath)` →
    `/checkout?session=<encoded id>&from=<encoded safe backPath>`.
- `checkout.ts` `buildCheckoutSessionParams`: optional `uiMode?: "hosted" | "embedded"`
  (default `"hosted"`). Hosted output unchanged (same keys, same values).
  Embedded: `ui_mode: "embedded"`, `return_url` = the literal current
  success URL (`{appUrl}/order/confirm?session_id={CHECKOUT_SESSION_ID}`), no
  `success_url`, no `cancel_url`; every other field identical. Docblock says
  `cancelUrl` is ignored in embedded mode (the back link lives on
  `/checkout`). `buildCartCheckoutSessionParams` is NOT changed (slice 4).
- `.env.tpl`: a commented block under Payments / Feature flags:
  `# NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...` and
  `# EMBEDDED_CHECKOUT_ENABLED=true`, with one line each on what they do. No
  vault reference (a bare reference prefix in a comment breaks `op inject`).

Acceptance / tests:
- `src/lib/__tests__/embedded-checkout.test.ts`: every config branch (flag
  unset/"false"/"TRUE" → flag-off; key missing/empty/whitespace →
  missing-key; `sk_test_x`-shaped/garbage key → invalid-key; pk_test+sk_live,
  pk_live+sk_test, pk_test+garbage secret → mode-mismatch; pk_test+sk_test,
  pk_test+rk_test, pk_live+sk_live → enabled with the trimmed key);
  `safeCheckoutReturnPath` (accepts `/d/abc`, rejects `//evil.com`,
  `https://evil.com`, `/\\evil.com`, `javascript:`, non-strings, empty);
  `embeddedCheckoutPath` encodes both params and falls back to `/shop`.
- `src/lib/__tests__/checkout.test.ts`: hosted params with no `uiMode` and
  with `uiMode: "hosted"` deep-equal a literal expected object (pins today's
  shape); embedded params have `ui_mode: "embedded"` + `return_url`, lack
  `success_url`/`cancel_url`, and otherwise deep-equal the hosted object.

## Task 2 — server wiring

Files: `src/app/order/actions.ts` (`createStripeCheckoutForOrder`),
`src/app/d/actions.ts` (`buyPublishedDesign`), tests.

- `createStripeCheckoutForOrder` gains optional `embedded?: { backPath: string }`.
  Absent → byte-identical to today. Present → builder gets
  `uiMode: "embedded"`; after persisting `stripeSessionId` (unchanged order of
  operations) it returns `{ url: embeddedCheckoutPath(session.id, backPath) }`
  — a same-origin relative path, so the unchanged client
  (`window.location.href = url`) lands on `/checkout` and a preview deploy
  stays on its own origin. Return type stays `{ url: string | null }`.
- `buyPublishedDesign`: resolve `embeddedCheckoutConfig()` once; when the raw
  flag is on but the config is disabled, `console.error` one line
  (`embedded checkout disabled: <reason> — using hosted checkout`); pass
  `embedded: { backPath: \`/d/${params.imageId}\` }` only when enabled. Keep
  the edit to a few lines near the `createStripeCheckoutForOrder` call — a
  parallel branch (#138 slice 3) edits this function's params/guards.
- `BuyPanel` needs no change (it already navigates to whatever `url` comes
  back). Do not edit it.
- `createCheckoutSession` (`/preview`) and `checkoutCart` are not touched.

Acceptance / tests — new real-DB file
`src/app/d/__tests__/buy-published-design-embedded.integration.test.ts`
(same harness as `buy-published-design.integration.test.ts`: real in-memory
libSQL, mocked `@/lib/db` getter, auth, `next/headers`, `@/lib/stripe`):
- flag off: `sessions.create` called once with params deep-equal to
  `buildCheckoutSessionParams({... hosted ...})` (compare with
  `expires_at: expect.any(Number)` or fake timers); no `ui_mode`; returns the
  hosted `url`.
- flag on + `pk_test_` key + `sk_test_` secret: create params have
  `ui_mode: "embedded"`, `return_url` ending
  `/order/confirm?session_id={CHECKOUT_SESSION_ID}`, no `cancel_url`/`success_url`;
  returns `/checkout?session=<id>&from=%2Fd%2F<imageId>`.
- In both modes, inside the create mock, the `order` and `order_item` rows
  already exist (query the db from the mock); after the call the order row's
  `stripeSessionId` equals the mocked id; order/order_item columns are the
  same in both modes.
- flag on + key missing → hosted params + url, and `console.error` called with
  a message containing `missing-key` (spy); flag on + `pk_live_` key with
  `sk_test_` secret → hosted.
- `createCheckoutSession` with the flag on and a valid key still creates a
  hosted session (extend `src/app/order/__tests__/front-pin.integration.test.ts`
  or add a focused case in the new file — whichever harness already seeds a
  design the caller owns).

## Task 3 — the `/checkout` page

Files: new `src/lib/embedded-checkout-session.ts` (server-only data loader —
NOT a `"use server"` action, so the client secret is never reachable through
an action endpoint), new `src/app/checkout/page.tsx` (server component), new
`src/app/checkout/embedded-checkout-form.tsx` (client), tests. Read
`node_modules/next/dist/docs/` for `redirect`/`notFound`/`searchParams` in
Next 16 first.

Loader `loadEmbeddedCheckout({ sessionId, viewerId })` → one of:
- `{ kind: "not-found" }` — no order with that `stripeSessionId`, or the order
  is not the viewer's.
- `{ kind: "paid" }` — order status is not `pending`, or Stripe says
  `complete`. (Page redirects to `/order/confirm?session_id=<id>`.)
- `{ kind: "expired" }` — `order.abandonedAt` set, or Stripe says `expired`.
- `{ kind: "hosted", url }` — an open session whose `ui_mode` is not
  `embedded` and that has a `url` (page redirects there).
- `{ kind: "unavailable" }` — `embeddedCheckoutConfig()` disabled for a key
  reason, Stripe retrieve threw, or the open embedded session has no
  `client_secret`.
- `{ kind: "ready", clientSecret, publishableKey, summary }`.
Order of checks: order lookup + ownership → status/abandoned (no Stripe call
for those) → key config → `stripe.checkout.sessions.retrieve` → status/ui_mode.
`summary` = one entry per `order_item` (via `resolveOrderLines` +
`resolveOrderLineIdentities`, as `getOrderBySession` does): product name
(`getBlank(blankId)?.name`), color, size, quantity, front image URL, back
image URL (or null), shirt color hex (`getColorHex`), and the cached front
mockup URL read from the line's design `mockupUrls` under
`mockupCacheKey({ productId: blankId, placementId: "front", sourceImageId:
<front image id>, colorName, scaleKey: 100 })` — the key `getListingMockup`
writes — or null. Read-only: never triggers a render. **No money in the
summary**: Stripe's embedded form shows line items, shipping, promo codes and
the total, and a total of ours would go stale the moment a promo code is
applied inside the iframe.

Page `/checkout?session=<id>&from=<path>`:
1. `embeddedCheckoutFlag()` off → `notFound()`.
2. `session` param not a string matching `/^cs_(test|live)_[A-Za-z0-9]+$/` →
   `notFound()`.
3. No auth session, or an anonymous one → `redirect` to
   `/sign-in?next=<encoded /checkout?session=…&from=…>`.
4. Loader result → `notFound()` / `redirect(confirm)` / `redirect(hosted url)`
   / message states / ready.
5. Ready layout, phone-first single column (two columns from `md`): a
   compact review block (mockup when cached, else artwork centered on the
   shirt-color square — never an empty box; mockup uses
   `mix-blend-multiply` over `mockupBackdrop(colorHex)` like `SideMockup`),
   product name, `Color / Size`, "Back design" row with thumbnail when there
   is one; then the embedded form; a `← Back` link (min 44px tap target) to
   `safeCheckoutReturnPath(from)` above the review block. Paper tokens only
   (`border-border`, `text-text-muted`, mono labels) — copy per persona C
   (plain, short).
6. Expired: "This checkout expired." / "Nothing was charged." + back link.
   Unavailable: "Checkout isn't available right now." / "Try again in a
   moment." + a "Try again" link to the same `/checkout` URL + back link. It
   must NOT say nothing was charged: a Stripe error means we don't know the
   session's state (it may have completed with the webhook still in flight).
7. `export const metadata = { title: "Checkout", robots: { index: false } }`.

Client `EmbeddedCheckoutForm({ publishableKey, clientSecret })`:
- one `loadStripe` promise per key, cached at module level; created on the
  client only (lazy `useState` initializer guarded by `typeof window`), so
  SSR renders the same empty container;
- `<EmbeddedCheckoutProvider stripe={promise} options={{ clientSecret }}>` +
  `<EmbeddedCheckout />`;
- if the promise rejects or resolves null → replace the form with "The
  payment form didn't load." + a "Try again" button (`location.reload()`);
- `data-testid="embedded-checkout"` on the container.

Acceptance / tests:
- `src/lib/__tests__/embedded-checkout-session.integration.test.ts` (real DB,
  mocked `@/lib/db`, `@/lib/stripe` retrieve, env stubs): each result kind,
  including another user's order → not-found, a paid order → paid with no
  Stripe call, `abandonedAt` → expired with no Stripe call, missing key →
  unavailable with no Stripe call, retrieve throws → unavailable, open +
  embedded + secret → ready with the secret and a summary whose mockup URL is
  the cached entry (and null when the cache lacks the key), open + hosted →
  hosted, complete → paid, expired → expired, null client_secret →
  unavailable.
- `src/app/checkout/__tests__/page.test.tsx` (call the async page like
  `confirm-page.test.tsx` does; mock the loader, auth, flag env,
  `next/navigation`): flag off → notFound; bad session param → notFound;
  anonymous → redirect to sign-in with an encoded `next`; paid → redirect to
  confirm; ready → renders the form component (mocked) with the secret and
  key, the review block, and a back link to the safe `from`; `from=//evil.com`
  → back link `/shop`; expired/unavailable copy; no `$` anywhere in the ready
  render.
- `src/app/checkout/__tests__/embedded-checkout-form.test.tsx`: mock
  `@stripe/stripe-js` and `@stripe/react-stripe-js`; success passes the secret
  through; `loadStripe` rejecting → error copy + Try again.

## Task 4 — `/order/confirm` open-session branch

Files: new `src/lib/checkout-session-status.ts` (server-only lib, not an
action), `src/app/order/confirm/page.tsx`, tests.

- `getCheckoutSessionState(sessionId)` → `{ status: "open" | "complete" |
  "expired" | null; uiMode: string | null; url: string | null } | null` —
  `null` when the Stripe call throws.
- Pure `resolveConfirmView({ orderStatus, stripe, embeddedEnabled, sessionId })`
  → `{ kind: "confirmed" } | { kind: "incomplete"; resumeHref: string | null }
  | { kind: "expired" }`: non-pending → confirmed; Stripe null (error) →
  confirmed (today's behaviour); complete → confirmed; open → incomplete with
  `resumeHref` = `/checkout?session=<id>` when `uiMode === "embedded"` and
  embedded is enabled, the session `url` for a hosted session that has one,
  else null; expired → expired.
- Page: only when `embeddedCheckoutFlag()` is on AND the order was found AND
  its status is `pending` does it call `getCheckoutSessionState`. Otherwise
  the render is exactly today's. Incomplete: heading "Payment not
  completed." / "Nothing was charged." / primary "Return to checkout" (when a
  resume href exists) / link "Back to Shop". Expired: "This checkout
  expired." / "Nothing was charged." / "Back to Shop". Same Paper layout as
  the existing states; the docblock at the top of the page is updated to say
  why the page may now call Stripe (it currently asserts a plain DB read).

Acceptance / tests — extend `src/app/order/confirm/__tests__/confirm-page.test.tsx`
(mock `@/lib/checkout-session-status`) and add a unit test for
`resolveConfirmView`:
- flag off + pending order → the state helper is never called and "Order
  confirmed." renders (pins invariant 1);
- flag on + paid order → never called;
- flag on + pending + open embedded → "Payment not completed." and a
  "Return to checkout" link to `/checkout?session=cs_1`;
- flag on + pending + open hosted with url → link to that url;
- flag on + pending + complete → "Order confirmed.";
- flag on + pending + expired → expired copy;
- flag on + pending + helper returns null → "Order confirmed.".

## After the tasks

- Whole-branch review over `git diff origin/main...HEAD` and the files
  around it, specifically tracing invariants 1–5 and the webhook path's
  idempotency for an embedded session.
- `docs/d-buy-checkout-plan.md`: a short "Slice 2 status" section (what
  shipped, the `embedded` vs `embedded_page` finding, the no-money review
  pane, what Nico sets before flipping).
- Gate: lint, typecheck, full vitest, build with the CI dummy env,
  `db:generate` → "No schema changes".
