# Checkout attempt caps and a cart line cap (#316): implementation plan

> Built subagent-driven on 2026-10-13 while Nico was away: one Sonnet implementer for the slice in its own worktree, the controller re-runs the CI gate, one Opus whole-branch review and one Opus adversarial review (money path), a dispatched real-Stripe e2e as the smoke. The ledger with every ruling is `docs/superpowers/ledgers/2026-10-13-316-checkout-caps.md`.

**Goal:** a signed-in account can start at most a fixed number of checkouts per day, from the cart and from the image detail page together, and a cart can hold at most a fixed number of lines. Each refusal is one line the buyer sees, returned as data so Production's masking of thrown server-action errors does not hide it.

**Source of the work:** https://github.com/nicolovejoy/prntd/issues/316 (the #314 adversarial review's finding 3). The issue asks Nico three questions; none is answered. The controller ruled on all three (ledger) so the slice can ship with caps a real buyer never meets and copy that follows the existing refusal lines. Every number is an environment override away.

**The state today:** `checkoutCart` (`src/app/cart/actions.ts`) and `buyPublishedDesign` (`src/app/d/actions.ts`) make no quota call. Each call by a signed-in account writes one `order` row and its `order_item` rows, creates one Stripe Checkout session that stays payable for two hours (the newer one now expires the older, #328), and `checkoutCart` asks Printful for a shipping quote. `addToCart` has no line cap: a 150-line cart wrote 150 `order_item` rows per checkout before Stripe refused. Generation and chat already count through `consumeBuckets` in `src/lib/generation-quota.ts` (one `generation_usage` row per bucket per UTC day, an upsert that returns the new count).

**Architecture:** one new counter, `consumeCheckoutQuota`, next to `consumeChatQuota`, with buckets `checkout:user:<id>` and `checkout:ip:<ip>` and two caps. Both order-creation actions call it right after their sign-in check and before any read or write, and return `{ url: null, error }` on refusal. One constant, `CART_MAX_LINES`, enforced by `addToCart` (both entries) before its insert and re-checked by `checkoutCart`. The buy panel shows a returned `error` as its notice. No schema change: `generation_usage.bucket` is free text.

**Branch and worktree:** `claude/316-checkout-caps` at `.claude/worktrees/316-checkout-caps`, started from the head of `claude/317-resume-from` (both edit `src/app/cart/actions.ts`); it is rebased onto main once #317's PR merges.

## Review focus

- A refusal that leaves a half-written state (an `order` row with no session, a bumped bucket for an attempt that never reached Stripe when the plan says it should count).
- A path to a Stripe session that skips the counter (a direct call to either action, the `/preview` path `createCheckoutSession` in `src/app/order/actions.ts`).
- Concurrent adds at `CART_MAX_LINES - 1` landing more than one line over the cap, and what `checkoutCart` then does.
- A refusal string reaching the buyer through a throw (masked in Production) instead of as data.
- The real-Stripe nightly: its tests run two checkouts per account at most; nothing in them must change.

---

## Global Constraints

These bind every task. They come from `CLAUDE.md`, `AGENTS.md` and the controller's rulings on #316.

1. **New user-facing strings are exactly the four in Task 1**, in `src/lib/action-copy.ts`, verbatim. No other new string anywhere. If you think another is needed, stop and report.
2. **No schema change.** `npm run db:generate` must print "No schema changes" and leave `drizzle/` untouched.
3. **Tests:** TDD. Real-DB integration tests run against an in-memory libSQL built from `schema.ts` (`src/lib/__tests__/test-db.ts`, `createTestDb`), with the shared factories in `src/lib/__tests__/factories.ts`. `src/lib/**` tests run under node, not jsdom. Follow the mock shape of the neighbouring test file named in each task.
4. **Do not edit** `src/lib/__tests__/factories.ts`, `src/lib/__tests__/test-db.ts`, `CLAUDE.md`, `AGENTS.md`, or anything under `docs/`.
5. **Stay inside the file list** of each task. If the work needs a file outside it, say so in your report and explain why before (or instead of) editing it.
6. **Server Actions:** a `"use server"` file exports async functions only. Pure helpers and anything that trusts a user id passed as an argument live in `src/lib/`.
7. **Lint policy:** no `any` in product code (tests may use it). `catch (err)` and narrow with `err instanceof Error ? err.message : String(err)`.
8. **libSQL over HTTP has no interactive transactions:** use `db.batch`, conditional writes and guarded inserts. Independent reads go in one `Promise.all`.
9. **Comments and docs:** plain statements of what the code does and why. No hyperbole. Update every comment your change makes untrue, including doc comments on functions you touch and comments in other files that describe the behaviour you changed.
10. **This is Next.js 16.** If you touch anything Next-specific, read the relevant guide in `node_modules/next/dist/docs/` first.
11. **Never read `.env*` files or any secret material.** No network calls. Do not run the dev server, `npm run e2e` or `npm run e2e:stripe`.
12. **Git:** work only in your worktree, on its branch. Commit per task with a descriptive message ending with the line `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Do not push, do not open a pull request, do not touch other worktrees or branches, do not delete branches, do not rebase.
13. **Do not dispatch subagents.** Review comes from the controller after your report.

## Gate (run before reporting; all four must pass)

```
npm run lint
npm run typecheck
npm test
npm run db:generate
```

`npm test` is the full suite (about 260 files, under two minutes). Run it in the foreground and read the summary line. If a test you did not touch fails, run it again on its own before concluding anything, and report it either way. `npm run build` is not part of your gate (the worktree's `node_modules` is a symlink, which Turbopack refuses); the controller builds.

## Report (in your reply, not in a file)

Under 400 words:

- Status: `DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT` or `BLOCKED`.
- Commits: short sha and subject, in order.
- Gate: the summary line of each of the four commands.
- Files changed, one line each, with what changed.
- Every comment you updated because it had become untrue, and every comment you found that describes the old behaviour and decided to leave (say why).
- Anything you did that the plan did not say, and anything the plan said that you did not do, with the reason.
- Concerns, if any.

---

## Task 1: the counter, the caps and the copy

### Files

- `src/lib/generation-quota.ts`
- `src/lib/cart-line-edit.ts`
- `src/lib/action-copy.ts`
- `src/lib/__tests__/generation-quota.test.ts`
- `src/lib/__tests__/checkout-quota.integration.test.ts` (new)

### Caps (in `src/lib/generation-quota.ts`, next to the chat caps, same `parseDailyCap` pattern)

```ts
// Checkout attempts (#316): one unit per Checkout click or Order click that
// reaches the point of creating an order, counted per signed-in account and
// per IP on the same UTC day as the other caps. Guests never reach either
// action (both return needsAuth first), so there is no guest cap. The
// numbers are far above what a buyer does in a day; their job is to bound
// the pending orders, Stripe sessions and Printful quotes one account can
// make us create.
export const USER_CHECKOUT_DAILY_CAP = parseDailyCap(process.env.USER_CHECKOUT_DAILY_CAP, 30);
export const USER_IP_CHECKOUT_DAILY_CAP = parseDailyCap(process.env.USER_IP_CHECKOUT_DAILY_CAP, 100);
```

### Counter

```ts
/**
 * Count one checkout attempt against the daily caps (#316). Same shape as
 * consumeChatQuota: identity first (`checkout:user:<id>`), then IP
 * (`checkout:ip:<ip>`) when one is present. Never refunded: a refused or
 * failed attempt still spent a Stripe or Printful call, or was about to.
 */
export async function consumeCheckoutQuota(opts: {
  userId: string;
  ip: string | null;
  now?: Date;
  db?: AppDb;
}): Promise<QuotaResult>
```

It calls `consumeBuckets` with `identityCap: USER_CHECKOUT_DAILY_CAP`, `ipCap: USER_IP_CHECKOUT_DAILY_CAP`, `day: dayKeyUTC(opts.now ?? new Date())`. Bucket helpers `checkoutUserBucket(userId)` and `checkoutIpBucket(ip)` exported like the chat ones, if the chat ones are exported; otherwise module-private like them.

### Cart line cap (in `src/lib/cart-line-edit.ts`, next to the quantity bounds)

```ts
/** Most lines one cart holds (#316). `addToCart` refuses the next add and
 * `checkoutCart` refuses a cart over it. Soft at the boundary: two adds
 * landing together at cap - 1 can both succeed; checkout then refuses until
 * one is removed. Stripe takes up to 100 line items per session. */
export const CART_MAX_LINES = 40;
```

### Copy (in `src/lib/action-copy.ts`; follow the file's section layout and comment style)

```ts
/** consumeCheckoutQuota refused this account for the day (#316). Returned as
 * data (`{ error }`) by buyPublishedDesign and checkoutCart. Mirrors the
 * generation limit line in src/app/design/actions.ts. */
export const CHECKOUT_LIMIT_REACHED =
  "You've reached today's checkout limit. Try again later.";

/** The same refusal on the IP bucket. */
export const CHECKOUT_LIMIT_REACHED_IP =
  "This network has hit today's checkout limit. Try again later.";

/** addToCart refused: the cart already holds CART_MAX_LINES lines (#316).
 * Returned as data. */
export const CART_FULL = "Your cart is full. Remove a line to add another.";

/** checkoutCart refused: the cart holds more than CART_MAX_LINES lines
 * (only reachable through concurrent adds at the boundary). Returned as data. */
export const CART_TOO_FULL_TO_CHECKOUT =
  "Your cart has too many lines to check out. Remove some to continue.";
```

Also export a pure helper in `src/lib/action-copy.ts` or `src/lib/generation-quota.ts` (your call; say which in the report):

```ts
/** The line a checkout-cap refusal shows, by the bucket that refused. */
export function checkoutLimitMessage(reason: "identity" | "ip" | undefined): string
```

returning `CHECKOUT_LIMIT_REACHED_IP` for `"ip"` and `CHECKOUT_LIMIT_REACHED` otherwise.

### Tests

`src/lib/__tests__/generation-quota.test.ts`: the caps default to 30 and 100 when the env vars are unset, and fall back to the defaults when they are garbage, in the style of the existing chat-cap tests (`vi.stubEnv` + a fresh import, as that file does).

`src/lib/__tests__/checkout-quota.integration.test.ts` (new; model on `src/lib/__tests__/chat-quota.integration.test.ts`): the 30th call for one user is allowed and the 31st refused with `reason: "identity"`; an identity refusal does not bump `checkout:ip:`; with an IP, the IP bucket is bumped once per allowed attempt and refuses with `reason: "ip"` past 100 while another user on the same IP is still under its identity cap; `ip: null` skips the IP bucket; two users have separate identity buckets; the day key separates two days. `checkoutLimitMessage` maps `"ip"` to the network line and anything else to the account line.

---

## Task 2: the two order-creation actions count attempts

### Files

- `src/app/cart/actions.ts`
- `src/app/d/actions.ts`
- `src/app/cart/__tests__/checkout-cart-caps.integration.test.ts` (new)
- `src/app/d/__tests__/buy-checkout-cap.integration.test.ts` (new)

### `checkoutCart` (`src/app/cart/actions.ts`)

Right after the sign-in check that returns `needsAuth`, before `buildCart` (which runs the Printful quote) and before any write:

```ts
const quota = await consumeCheckoutQuota({ userId, ip: clientIp(await headers()) });
if (!quota.allowed) return { url: null, error: checkoutLimitMessage(quota.reason) };
```

`clientIp` is the one in `src/app/design/actions.ts` (leftmost `x-forwarded-for`, else null). It is module-private there; move it to `src/lib/client-ip.ts` as `export function clientIp(hdrs: Headers): string | null` with the same body and its comment, import it in `src/app/design/actions.ts`, `src/app/cart/actions.ts` and `src/app/d/actions.ts`. (This adds `src/lib/client-ip.ts` and a one-line edit to `src/app/design/actions.ts` to this task's file list.)

Then, after the existing `unavailable` refusal and before any write, the line cap re-check:

```ts
if (view.items.length > CART_MAX_LINES) {
  return { url: null, error: CART_TOO_FULL_TO_CHECKOUT };
}
```

Order of refusals, which the tests pin: sign-in → checkout quota → empty cart → unavailable line → too many lines → attribution → writes. An empty cart still spends an attempt (the cart page disables Checkout when the cart is empty, so only a direct call reaches it).

### `buyPublishedDesign` (`src/app/d/actions.ts`)

Its return type becomes `Promise<{ url: string | null; needsAuth?: boolean; error?: string }>`. Right after the sign-in check, before `resolveBuyableImage`:

```ts
const quota = await consumeCheckoutQuota({ userId: session.user.id, ip: clientIp(await headers()) });
if (!quota.allowed) return { url: null, error: checkoutLimitMessage(quota.reason) };
```

The docblock of each action gains one sentence on the cap and where the refusal goes. `src/app/order/actions.ts` (`createCheckoutSession`, the `/preview` path slice 6a removes) is **not** changed; say so in a one-line comment at its sign-in check: "Not counted against the checkout cap (#316): no UI reaches this action since one-buy-surface slice 4; slice 6a removes it."

### Tests (real DB; mock Stripe and `headers` the way `src/app/cart/__tests__/checkout-cart-embedded.integration.test.ts` and `src/app/d/__tests__/buy-published-design-embedded.integration.test.ts` do)

`checkout-cart-caps.integration.test.ts`:

- With `checkout:user:<id>` already at 30 for today: `checkoutCart` returns `{ url: null, error: CHECKOUT_LIMIT_REACHED }`, writes no `order` row, calls Stripe zero times, and the Printful quote function is not called (spy on whatever `buildCart` calls for the quote; if that is awkward, assert zero `order` rows and zero Stripe calls and say so).
- At 29: the checkout proceeds (Stripe called once, one order row) and the bucket is at 30 afterwards.
- With a request header `x-forwarded-for: 203.0.113.9, 10.0.0.1` the IP bucket `checkout:ip:203.0.113.9` is bumped by one.
- A cart with `CART_MAX_LINES + 1` valid lines: `{ url: null, error: CART_TOO_FULL_TO_CHECKOUT }`, no order row, Stripe not called, and the checkout bucket still bumped by one (the attempt counted).
- A cart with exactly `CART_MAX_LINES` lines checks out.
- Hosted and embedded modes both refuse the same way (one case each is enough for the quota refusal).

`buy-checkout-cap.integration.test.ts`:

- Bucket at 30: `buyPublishedDesign` returns `{ url: null, error: CHECKOUT_LIMIT_REACHED }`, no order row, Stripe not called, `resolveBuyableImage` never reached (a hidden image id with the bucket at cap still returns the cap error, not a throw).
- At 29: proceeds; bucket at 30 afterwards.
- IP refusal (`checkout:ip:` at 100, identity under cap) returns `CHECKOUT_LIMIT_REACHED_IP`.
- A guest (anonymous session) still gets `needsAuth` and no bucket is bumped.

---

## Task 3: `addToCart` refuses a full cart, and the buy panel shows returned errors

### Files

- `src/app/cart/actions.ts`
- `src/app/d/[imageId]/buy-panel.tsx`
- `src/app/d/[imageId]/__tests__/buy-panel.test.tsx`
- `src/app/cart/__tests__/add-to-cart-cap.integration.test.ts` (new)

### `addToCart`

Return type becomes `Promise<{ ok: boolean; count: number; error?: string }>`. On both entries (the `frontImageId` path and the `designId` path), after the validation that can throw and immediately before the `db.insert(cartItemTable)`, count the viewer's lines (one `select count(*)` on `cart_item` by `user_id`, the same shape `getCartCount` uses, or reuse `getCartCount`) and when `count >= CART_MAX_LINES` return `{ ok: false, count, error: CART_FULL }` without inserting. Soft at the boundary (two concurrent adds at 39 can both land; `checkoutCart` refuses until one is removed); the constant's comment says so.

### Buy panel (`src/app/d/[imageId]/buy-panel.tsx`)

`handleBuy`: destructure `error` too; when present, `navigatingAway.current = false; setNotice(error); setLoading(false); return;` before the `needsAuth` branch. `handleAddToCart`: capture the result; when `!result.ok && result.error`, `navigatingAway.current = false; setNotice(result.error); setAddingToCart(false); return;` instead of navigating to the cart. The notice element is the existing `InlineNotice` that shows `CHECKOUT_FAILED` and `ADD_TO_CART_FAILED` today. No new element, no new string.

### Tests

`add-to-cart-cap.integration.test.ts` (model on `src/app/cart/__tests__/add-to-cart-front-pin.integration.test.ts`): with 40 lines, the 41st add through the `frontImageId` entry returns `{ ok: false, count: 40, error: CART_FULL }` and the row count stays 40; the same through the `designId` entry; with 39 lines the add succeeds and returns `count: 40`; a guest (anonymous user row) is capped the same way.

`buy-panel.test.tsx` (jsdom; follow the file's existing mocks of the two actions): `buyPublishedDesign` resolving `{ url: null, error: "X" }` shows "X" in the notice, does not navigate, and re-enables Order; `addToCart` resolving `{ ok: false, count: 40, error: "Y" }` shows "Y", does not navigate to `/cart`, and re-enables Add to cart. Use the real constants from `@/lib/action-copy` in place of "X" and "Y".

---

## What a reviewer will attack

- `consumeCheckoutQuota` before `buildCart`: a buyer whose cart has a stale line spends an attempt on each refused click. Thirty of those in a day is still far from a real buyer; the adversarial review decides whether that is acceptable or the count should move after the `unavailable` check (then a stale cart gives free Printful quotes).
- The counter's day key is UTC (`dayKeyUTC`), as for generation and chat; the cap resets at 16:00 or 17:00 Pacific. Same as the existing caps.
- `headers()` is called twice in `checkoutCart` after this change (once for the session, once for the IP). Read it once and pass it along.
- A direct call to `addToCart` through the `designId` entry with a full cart must be refused the same as the `frontImageId` entry.
- The buy panel's `navigatingAway` ref: after a returned error the panel must not treat the next `pageshow` as a bfcache restore that resets state it did not set.
- `src/app/order/actions.ts`'s `createCheckoutSession` is uncounted on purpose; the comment must say so and name 6a.
