# #135 slice 2 — embedded checkout — SDD ledger

Plan: `docs/superpowers/plans/2026-09-25-135-embedded-checkout.md`.
Branch `claude/135-embedded-checkout`, from `origin/main` at `fe7f515`.
Baseline suite on that commit: 173 files / 1812 tests, all passing.

## Process note

This controller session had no in-process subagent tool. Implementers and
reviewers ran as separate `claude -p` processes in this worktree, with the
model the batch brief names for each role and a
restricted `--allowedTools` list: reviewers get read-only tools plus
test/lint/typecheck commands; implementers additionally get Edit/Write. No
subagent could commit, push, install packages, or write outside the
worktree. The controller ran every gate command itself.

## Rulings (controller, before Task 1)

R1. **`ui_mode: "embedded"`, not `embedded_page`.** `stripe` 20.4.1 pins API
`2026-02-25.clover`; its `SessionCreateParams.UiMode` is
`'custom' | 'embedded' | 'hosted'`. Stripe's current OpenAPI
(`2026-09-30.endive`, fetched 2026-09-25) names it `embedded_page`. We send
what our pinned version accepts.

R2. **Client packages pinned to the server's release train.** Latest
`@stripe/stripe-js` 9.x / `@stripe/react-stripe-js` 6.x load the `dahlia`
Stripe.js train (`createEmbeddedCheckoutPage`). The server is on `clover`,
so the client uses `@stripe/stripe-js@^8.11.0` (`clover`,
`initEmbeddedCheckout`) + `@stripe/react-stripe-js@^5.6.1` (its peer range
is stripe-js 8). Bump all three together when the server SDK moves.

R3. **The buy action keeps its `{ url }` shape.** In embedded mode
`createStripeCheckoutForOrder` returns a same-origin relative
`/checkout?session=…&from=…` URL, so `BuyPanel` (which already does
`window.location.href = url`) needs no change, and a parallel branch
(#138 slice 3) editing `buyPublishedDesign`/`BuyPanel` merges cleanly. The
client secret never crosses a server action or the URL: `/checkout`
retrieves the session server-side on every render (refresh-safe; the plan's
sessionStorage fallback becomes unnecessary). Relative, not
`NEXT_PUBLIC_APP_URL`-absolute, so a preview deploy stays on its own origin.

R4. **Cart builder untouched.** The plan's checklist mentions a `uiMode`
branch in "the session-param builders"; cart is slice 4, so only the
single-item builder gains it here.

R5. **No money on `/checkout`'s review pane.** The plan lists shipping and a
total in the pane. Stripe's embedded form already shows line items,
shipping, promo codes and the total, and a total of ours would contradict
it the moment a promo code is applied inside the iframe. The pane shows
what is being bought (mockup, product, color/size, back design); Stripe's
form is the price surface (an allowed one under CLAUDE.md → Pricing).
Judgment call — flagged in the summary.

R6. **`/order/confirm`'s Stripe lookup is gated on the flag.** The plan calls
the open-session branch "a correctness fix for hosted too"; the batch
brief requires flag-off behaviour to be byte-for-byte today's. With the flag
off the confirm page makes no Stripe call. With it on, pending orders from
either UI get the status check.

R7. **`/checkout` 404s with the flag off.** The kill switch therefore also
strands buyers who hold an open embedded session at the moment it flips —
at most the 2 h session TTL (`CHECKOUT_SESSION_TTL_SECONDS`); nothing is
charged and the `checkout.session.expired` webhook marks the row abandoned.
Accepted: a kill switch should stop the surface, not half of it.

R8. **`client_secret` on retrieve is unverified.** It is on the Session
object in both the SDK types and the OpenAPI spec, with no
"returned on creation only" note. If it ever comes back null, `/checkout`
renders its unavailable state (fail closed). Nico's phone test with the test
key is the check.

## Tasks

### Task 1 — config, builder branch, deps (`b6306e9`)

Implementer: `embeddedCheckoutFlag()`, `src/lib/embedded-checkout.ts`
(config resolver, `safeCheckoutReturnPath`, `embeddedCheckoutPath`), `uiMode`
branch in `buildCheckoutSessionParams`, commented `.env.tpl` entries, 32 + 3
tests. Check order in the resolver: flag → missing-key → invalid-key →
mode-mismatch (an unparseable secret key is a mismatch).

Task review: CLEAN, no findings. Reviewer re-ran the task tests (53
passing), typecheck, eslint.

### Task 2 — server wiring (`29399c6`)

Implementer: `createStripeCheckoutForOrder` takes
`embedded?: { backPath }`; `buyPublishedDesign` resolves the config once,
right before its `createStripeCheckoutForOrder` call, logs the reason when
the flag is on but the config is disabled, and passes `embedded` only when
enabled. `BuyPanel` untouched. New real-DB file
`src/app/d/__tests__/buy-published-design-embedded.integration.test.ts`.

Task review: CLEAN, one Minor — the flag-off test checked a subset of
properties, not the full deep-equal the acceptance criteria ask for.
Controller ruling: fix it anyway; invariant 1 is the property that test
exists to pin. Fix `044713c`: the flag-off, missing-key and mode-mismatch
cases deep-equal `buildCheckoutSessionParams` output (no `uiMode`) for the
persisted order. Scoped re-review: RESOLVED.

### Task 4 — `/order/confirm` open-session branch (`89a4698`)

Implementer: `src/lib/checkout-session-status.ts`
(`getCheckoutSessionState`, pure `resolveConfirmView`), confirm page gated on
the raw flag + a pending order, 7 new page tests. Ran in parallel with
Task 3 (disjoint files).

Task review: CLEAN, no findings.

Controller findings on top of the clean review (fix `fbb8375`):
1. Important — the resume link was gated on the raw flag, so a flag-on /
   key-missing deploy offered "Return to checkout" to a page that can only
   say unavailable. Now `embeddedCheckoutConfig().enabled`; the outer
   "call Stripe at all" gate stays on the raw flag. Test added.
2. Minor — docblocks claimed hosted checkout never lands here pending and
   that a closed tab bounces back; both false. Rewritten.
3. Minor — the incomplete/expired states labelled their breadcrumb
   "Confirmed". Now "Checkout".
Scoped re-review: RESOLVED.

### Task 3 — `/checkout` page (`edb8b8a`)

Implementer: `src/lib/embedded-checkout-session.ts`
(`loadEmbeddedCheckout`, server-only, cheapest checks first), the server
page, the client `EmbeddedCheckoutForm` (module-cached `loadStripe`, lazy on
the client only). 12 real-DB loader tests, 14 page tests, 4 form tests.
Ruling on its one question: the sign-in `next` and "Try again" hrefs reuse
`embeddedCheckoutPath`, so a missing `from` becomes `from=%2Fshop` —
accepted.

Task review: CLEAN, no findings.

Controller findings on top of the clean review:
1. Important — `EmbeddedCheckoutProvider` swallows an
   `initEmbeddedCheckout` rejection (e.g. a publishable key from another
   Stripe account, which the server-side mode check cannot see), leaving an
   empty area. Add a non-destructive watchdog hint after 15 s with no
   iframe.
2. Important — the review block showed a 64 px thumbnail at every width;
   the page exists to show the shirt before paying. 96 px on phones, a
   full-column square from `md` up.

Fix `7a94049` (96 px / `md` full-column preview; 15 s watchdog hint under
the still-mounted form). Scoped re-review: RESOLVED.

## Whole-branch review over `origin/main...7a94049`

Verdict CLEAN; traces (a)–(e) all held:
- (a) flag off: image-detail purchases send the builder's hosted params and
  return the hosted URL; `/preview` and cart never pass `embedded`;
  `/order/confirm` gates its Stripe read on the flag and a pending order.
  Flag on + key missing/malformed/other mode → hosted + one log line.
- (b) the order + order_item batch is unchanged and precedes
  `sessions.create`; `stripeSessionId` is written after; nothing new writes
  to order, order_item or ledger.
- (c) `complete` (incl. webhook lag) → "Order confirmed."; `open` embedded →
  "Payment not completed." + "Return to checkout" (config-gated); `open`
  hosted → the session URL; `expired` → "This checkout expired."; no
  redirect loop between `/checkout` and `/order/confirm`.
- (d) webhook untouched; nothing reads `url`, `success_url`, `cancel_url` or
  `ui_mode` outside the two new modules; idempotency does not depend on the
  UI mode.
- (e) `no-preselection-price.test.ts` passes; `/checkout` renders no money.
Suite at that point: 179 files / 1906 tests.

Findings: four Minor (stale `resolveConfirmView` docblock; builder docblock
"only per-flow difference is cancelUrl"; confirm-page docblock "before the
customer is redirected to Stripe"; the stall notice never cleared when a
late iframe arrived) and two ops items (5: `return_url` from
`NEXT_PUBLIC_APP_URL` sends a preview-deploy buyer to prntd.org, where the
preview order doesn't exist; 6: wallets in Embedded Checkout need the
domain registered under Stripe → Payment method domains).

Controller finding the review missed: the controller's pre-gate
`npm run build` listed `○ /checkout` (Static). With the flag off at build
time the page called `notFound()` before any request-time API, so Next
prerendered a static 404 that no runtime env change could undo. Important.

Rulings:
- R9. `/checkout` awaits `searchParams` before the flag check (dynamic in
  every build); test pins the ordering. Verified in the gate build.
- R10. Ops item 5 is fixed, not just documented: an embedded session's
  `return_url` uses the request's `Origin` when it is a trusted PRNTD host
  (`resolveReturnOrigin`), else `NEXT_PUBLIC_APP_URL`. Without it the
  plan's own pre-flip check ("live-verify on a phone with the test key")
  cannot pass on a preview. Hosted mode keeps `NEXT_PUBLIC_APP_URL`
  byte-for-byte. Judgment call — flagged in the summary.
- R11. Ops item 6 goes into the pre-flip list for Nico, not code.
- Minors 1–4 fixed.

Fix `f563e16`, then controller findings on it: `resolveReturnOrigin`'s
docblock claimed it trusted "the same hosts auth.ts does" while accepting
any `*.vercel.app` and localhost (auth.ts trusts `prntd-*.vercel.app`,
`*.prntd.org`, localhost only in dev/e2e) — narrowed to match, localhost
dropped (same-origin covers local dev and e2e); and it threw on a malformed
`NEXT_PUBLIC_APP_URL` before the order insert — now throw-free.
Fix `446c75d`.

Scoped re-review of `7a94049..446c75d`: CLEAN. Confirmed R9–R10 and
minors 1–4 resolved; invariants 1 and 2 hold (`headers()` is read only
inside the enabled branch; hosted mode keeps `NEXT_PUBLIC_APP_URL`); no
request can steer `return_url` off PRNTD hosts (Next's server-action check
also binds Origin to Host); a missing Origin falls back to
`NEXT_PUBLIC_APP_URL`. One Minor: the throw-free claim failed for an unset
`NEXT_PUBLIC_APP_URL`. Fix `e516d4a`; scoped re-review: RESOLVED.

## Gate (controller, on `e516d4a`)

- `npm run lint`: 0 errors, 22 warnings, none in files this branch touches
  (`npx eslint` on the branch's files: clean).
- `npm run typecheck`: clean.
- `npx vitest run`: 179 files / 1926 tests passed (baseline 173 / 1812).
- `npm run build` with the CI dummy env: passes; route table lists
  `ƒ /checkout` and `ƒ /order/confirm` (dynamic).
- `npm run db:generate`: "No schema changes, nothing to migrate".

## Before the flag can be flipped (Nico)

In each Vercel scope that should get embedded checkout:
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` = the publishable key in the SAME
  mode as that scope's `STRIPE_SECRET_KEY` (`pk_test_…` with `sk_test_…`,
  `pk_live_…` with `sk_live_…`/`rk_live_…`). A mismatch fails closed to
  hosted checkout and logs `embedded checkout disabled: mode-mismatch`.
- `EMBEDDED_CHECKOUT_ENABLED` = `true`.
- Then a NEW deployment: `NEXT_PUBLIC_` values are inlined at build time.
- Stripe dashboard → Settings → Payment method domains: register the domain
  (prntd.org for live; the preview host too, in test mode, to see wallets
  there) or Apple Pay / Google Pay won't appear inside the embedded form.
- Kill switch: set the flag off and redeploy; `/checkout` then 404s, and an
  embedded session already open at that moment is left to expire (≤ 2 h,
  nothing charged, the expired webhook marks the row abandoned) — R7.

## Not done / out of scope

- `/preview` (slice 3, incl. the Stripe e2e migration to the iframe) and
  cart (slice 4) stay hosted.
- No e2e covers embedded checkout (CI does not set the flag); the phone
  check with the test key is the live verification.
- Cross-account publishable key (same mode, different Stripe account) is
  not detectable server-side; the client shows the 15 s "taking a while"
  hint.

## Independent review (main session, on `209903a`) → fix round `a5fb4ab`

The review found no Critical issues. It confirmed: flag off is unchanged on every path;
order writes precede the session; the params match hosted checkout except for
`ui_mode`/`return_url`; the client secret reaches only the order's owner; and
`return_url` can't be steered off-domain. Four findings were fixed in `a5fb4ab`:

1. Important — `/checkout` was missing from `FUNNEL_PREFIXES`
   (`src/lib/funnel-routes.ts`). The floating Feedback launcher sat over
   Stripe's form on phones and could cover Pay. Added, with a test
   (`/checkouts` stays unmatched).
2. Minor — both Stripe session reads swallowed errors and inherited the
   SDK's 80 s timeout with 2 retries. That put a slow Stripe on the receipt
   page's critical path right after payment, and a systematic failure left
   no trace. Both are now capped by `withTimeout` at
   `STRIPE_SESSION_READ_TIMEOUT_MS = 3000`. Each logs one line via
   `describeStripeError`: `type`/`code`/`statusCode` for SDK errors, the
   message otherwise, never `raw`/headers/secrets. A test plants a
   `client_secret` on the mocked error and asserts the log lacks it. The
   fail-safe results are unchanged (null → "Order confirmed."; unavailable).
   Flag off still makes no Stripe call on `/order/confirm`.
3. Minor — the embedded form's load-failed and taking-a-while notices now
   offer "← Back" (the page's safe `from` target) beside Reload. **Hosted
   fallback for a stuck embedded buyer stays a later decision.** An embedded
   session has no hosted URL, so the fallback would mean creating a second,
   hosted session for the same order, which is a money-path design question
   of its own. The task review noted that the page's own top Back link is
   then also visible, so there are two Back links in the failure states.
   Accepted: same target, and the notice's Back is the one within reach on
   a phone.
4. Minor — `resolveReturnOrigin` now trusts only this project's preview
   shapes, `^prntd-[a-z0-9-]+-nico-lovejoys-projects\.vercel\.app$` (the
   `nico-lovejoys-projects` team slug came from the main session and was not
   verifiable from this session). This is deliberately narrower than
   auth.ts's `prntd-*.vercel.app`. A non-matching preview host falls back to
   `NEXT_PUBLIC_APP_URL`, so the buyer lands on prntd.org as before R10. The
   task review checked uppercase, a trailing dot and a `…vercel.app.evil.com`
   suffix against Node's URL parser; all fail closed.

Task review: CLEAN.

Recorded, not changed (per the main session):
- The kill switch 404s a mid-checkout reload. This is R7.
- `createStripeCheckoutForOrder` is exported from a `"use server"` file
  (`src/app/order/actions.ts`), so Next may register it as an action
  endpoint that takes caller-supplied `userId`/`itemPrice`/`cancelUrl`. This
  predates the branch. The branch's new `embedded` param (`backPath`,
  `returnOrigin`) adds no reach beyond what `cancelUrl`/`itemPrice` already
  expose. It is worth its own issue.

Gate on `a5fb4ab`: lint 0 errors (22 warnings, none in branch files),
typecheck clean, vitest 179 files / 1933 tests, build with the CI dummy env
passes (`ƒ /checkout`, `ƒ /order/confirm`), `db:generate` reports no schema
changes.
