# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Design Principle

Phone-first. When prioritizing between features, the one that improves the mobile experience wins. Desktop is secondary.

## Writing Style

- No hyperbole, no "core insight", no "the X IS the Y" declarations
- State things plainly. Present options and tradeoffs, don't evangelize
- Docs and comments should describe what something does and why, not sell it

## Project

PRNTD — AI-powered t-shirt designer. Users describe a design in the Studio, Ideogram renders it, they iterate, then buy it on a shirt fulfilled by Printful. Published designs sell to other people in the Shop. Live at prntd.org.

Session history (every dated record through 2026-09-10) lives in `docs/session-log.md`. This file holds conventions, standing rules, and current state only. Keep it that way: put new session records in the log, and update "Current state" here.

## Tech Stack

- Next.js 16 (App Router) on Vercel; functions pinned to `pdx1`, next to Turso's `aws-us-west-2`
- Turso (libSQL) + Drizzle ORM, versioned migrations in `drizzle/`
- Better-Auth (email/password, plus the anonymous plugin that mints guest users)
- Cloudflare R2 for image storage
- Ideogram (direct API): v4 `generate-transparent` with `json_prompt` for new designs; `/v1/edit` with `transparent_background` for edits and placement re-renders. Replicate is out of the generation path (only ops scripts still import `removeBackground`)
- Claude (Anthropic API, `claude-sonnet-4-6`) turns casual messages into a typed `DesignSpec` brief (`constructDesignBrief`) and chat replies
- Printful API for fulfillment and mockups
- Stripe Checkout (hosted) for payments
- Resend for email

## Commands

```bash
npm run dev          # Local dev server
npm run build        # Production build
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit (CI runs it; lint/test/build do not catch type errors)
npm test             # Vitest run (no watch)
npm run test:watch   # Vitest in watch mode
npx vitest run src/lib/__tests__/pricing.test.ts  # Run a single test file
npm run e2e          # Playwright against a local compiled build (next build && next start -p 3100)
npm run e2e:stripe   # One real Stripe test-mode checkout (needs sk_test_ key + Stripe CLI; docs/stripe-e2e.md)
npm run db:generate  # Author a new versioned migration from schema.ts changes → drizzle/000N_*.sql
npm run db:migrate   # Apply pending migrations (defaults to .env.local = prntd-dev; prod/preview via inline creds)
npm run db:push      # Dev-only fast schema sync to prntd-dev. Never prod/preview
npm run db:seed      # Seed the dev DB
npm run db:studio    # Drizzle Studio (database GUI)
```

`db:push`, `db:migrate` and `db:seed` run `scripts/db-preflight.ts` first. It refuses any target that isn't prntd-dev or a `file:`/`:memory:` DB unless `DB_TARGET_CONFIRM=<target>` is set, or `DATABASE_URL` was set in the shell (the inline-creds one-liners below).

## Tooling & CI

`.github/workflows/ci.yml` on every PR and push to main: lint → typecheck → test (+coverage) → build, plus a migration drift gate (`npm run db:generate` must print "No schema changes"). On PRs only, an `e2e` job runs Playwright against a local compiled build on an **ephemeral Turso branch** copied from `prntd-preview` (#108), migrated in CI. It does not exercise the Vercel preview deployment. Branch protection requires the `check` job and one approving review; admins can bypass. A PR with merge conflicts runs **no CI at all** (GitHub can't build its merge ref).

Other workflows: `stripe-e2e.yml` nightly at 08:23 UTC (real Stripe test checkout on its own ephemeral branch, plus a real Printful contract check that creates and deletes one draft order; opens a `stripe-e2e-nightly` issue on failure). `prod-smoke.yml` after each push to main waits for the prod deploy of that SHA and curls testid markers on prntd.org (opens a `prod-smoke` issue on failure).

Lint policy:

- `@typescript-eslint/no-explicit-any` is `error` in product code, `off` in test files (`**/__tests__/**`, `*.test.ts(x)`). Mocks are the canonical case for `any`; production code should type things.
- For `catch` clauses: use `catch (err)` (defaults to `unknown`) and narrow with `err instanceof Error ? err.message : String(err)`. Don't annotate `err: any`.
- `scripts/**` is excluded from lint (also excluded from tsconfig). One-off ops scripts. `.claude/worktrees/**` is ignored too (agent worktrees would otherwise double every lint run).

**Before tightening any lint rule, type-check, or CI gate**: run it locally against the current codebase first. If existing code already violates the new rule, decide between (a) cleaning the violations, (b) scoping the rule narrower (e.g. test-only), or (c) downgrading severity — and do that work _before_ pushing the gate. Don't push a stricter gate without that audit, or the next PR will be blocked for reasons unrelated to that PR.

Local `npm run build` needs env. Use CI's dummy block (copy it from `ci.yml`'s `check` job). Those fake `NEXT_PUBLIC_*` values get inlined into server code too, so rebuild with real values before taking local screenshots.

## Architecture

### Routes

```
/                       → Landing: composer-first hero + Shop feed below
/studio                 → Studio bench: composer on top, one lane per conversation (guests with a session allowed while GUEST_FUNNEL_ENABLED; #248)
/designs                → My Designs (top nav): every owned image, Active/All filter (guests too; #258)
/checkout?session=      → Stripe Embedded Checkout for image-detail-page buys and, behind PREVIEW_EMBEDDED_CHECKOUT_ENABLED, /preview buys; 404 unless either switch is on (#250, #135)
/design?id=             → One conversation thread (older make surface; still reachable)
/preview?id=            → Design on a shirt: product, size, color, front + back, buy or add to cart
/d/[imageId]            → Image detail page: public for published images, owner view for private ones; buy, add to cart, start a new design from it
/shop                   → Shop feed of published designs
/cart                   → Multi-item cart
/order/confirm          → Post-Stripe confirmation
/orders                 → Customer order history (hides pending and abandoned checkouts)
/admin                  → Admin order list, filters, financial summary
/admin/orders/[id]      → Admin order detail, ledger timeline, refund/retry
/admin/published        → Admin moderation of published images
/admin/errors           → Last 50 captured server errors (app_error)
/(auth)/sign-in, /sign-up, /forgot-password, /reset-password
/api/webhooks/stripe, /api/webhooks/printful, /api/cron/retry-fulfillment, /api/cron/sweep-generations, /api/health
```

Redirect-only: `/studio/library` → `/designs`, `/studio/archive` → `/designs`, `/prints` → `/shop` (308s), `/order` → `/preview`. Retired but still in the tree until composition slice 5 merges: `/dashboard/**`, `/shop/[slug]/**` (organizer storefronts; `STORES_ENABLED` removed from Vercel, so they 404).

Say "image detail page", not "/d", when talking to Nico.

Auth: `src/proxy.ts` (Next 16's renamed middleware, Node runtime) checks the session cookie; `requireRealUser` guards server-rendered personal pages; anonymous guests are real `user` rows (Better-Auth anonymous plugin) that `onLinkAccount` re-parents on sign-in/up via `reparentUserData` (every user-owned table must be listed there — its integration test seeds one row per table and is the checklist). `/admin` is gated by `isAdminUser()`: `ADMIN_EMAIL` is Nico's gmail; his me.com account is a regular user.

### Core loop

Studio composer → `generateDesign` (`src/app/design/actions.ts`) → quota (per identity + per IP, daily) and capacity (3 in flight per user, enforced by a guarded `INSERT … SELECT … WHERE count < 3`) → `image_generation` job row → work continues in `after()`: Claude builds a `DesignSpec` (`generate` or `edit`; a `clarify` brief still renders, from the user's own words via `fallbackSpec`, with the question attached) → Ideogram v4 generate, or `/v1/edit` on the anchored image → R2 `images/{imageId}.png` → `image` + `conversation_image` rows → the Studio polls job status. Cancel sets `cancelled_at`; a cancelled job's result is discarded. Every Generate renders; there is no readiness gate. A lazy sweep on reads plus a daily cron fail stale jobs, refund their quota, and reclaim orphaned R2 objects.

### Data model (Drizzle + Turso)

Tables use singular names (Better-Auth defaults).

- **Conversation:** `design` (a chat thread; `primary_image_id` is its hero, `closed_at` closes it; idle conversations auto-archive after 3 days) and `chat_message` (append-only turns).
- **Image:** `image` (an artifact owned by a user; `operation` generate/edit/upload and `design_spec_json` record provenance) and `conversation_image` (links an image to a conversation as `output` or `seed`; reuse is a link, never a copy). Published images are immutable snapshots.
- **Publishing and Shop:** `listing` holds image visibility only (`published_at`, `is_hidden`); composition slice 5 renames it `image_publication`. `product` is a Shop composition: placements JSON of image ids plus title, backdrop, feed rank, status. The Shop sells compositions (shirts), not bare images.
- **Commerce:** `order` (header; `abandoned_at` for expired checkouts) + `order_item` (authoritative lines; `placements` pins image ids per side), `cart_item`, `ledger_entry` (append-only money log: `sale`, `stripe_fee`, `cogs`, `refund`, `refund_cogs_reversal`; unique on `(order_id, type)`; starts 2026-04-01).
- **Machinery:** `image_generation` (job rows), `generation_usage` (quota counters), `placement_render` (cached per-placement renders), `app_error` (captured server errors).
- **Auth:** `user`, `session`, `account`, `verification`.
- **Retired, dropped by composition slice 5 (held PR):** `store`, `product_offering`, `order.store_id`, `product.store_id`, `product.design_id`.

Plans behind this: `docs/model-b-migration-plan.md` (done), `docs/composition-first-class-plan.md` (slices 1–4 live, 5 held).

### Payment flow

Stripe Checkout session → webhook claims the order conditionally (`UPDATE … WHERE status='pending'`) and books `sale` + `stripe_fee` in the same `db.batch` → `submitOrderFulfillment()` (`src/lib/order-fulfillment.ts`, the ONLY Printful submission path; `external_id` = order id with dashes stripped, Printful caps it at 32 chars) books `cogs`. If submission fails after the claim, a daily cron (`/api/cron/retry-fulfillment`) retries paid-but-unsubmitted orders from 10 minutes to 24 hours old; a Printful duplicate rejection adopts the existing Printful order. Checkout sessions expire after 2 hours; `checkout.session.expired` marks the order `abandoned_at`. Refunds are an admin-clicked button on canceled orders, never automatic.

Price = `baseCost × 1.5` per size, plus a separate flat shipping line (`FLAT_SHIPPING_USD` $4.69, so % promos skip it), plus `BACK_PLACEMENT_UPCHARGE` $8 when a back design is added. COGS always comes from Printful's invoice, never from `baseCost`.

### Key integration points

- **Ideogram:** $0.03 per generate, $0.20 per edit (`costFor()`; the edit price is secondhand, check it against a bill). No transparency support in v4's text endpoints; only `generate-transparent` and `/v1/edit` have it.
- **R2:** every generated image is kept (`images/{imageId}.png`; legacy `designs/{designId}/{n}.png` keys stay). Mockup keys come from `src/lib/mockup-cache.ts`, the single builder for both the R2 key and the DB cache key.
- **Printful:** product catalog in `src/lib/blanks.ts`; mockups; order submission; status webhooks (redeliveries at the target status return 200 `ignored`). `PRINTFUL_AUTO_CONFIRM` defaults ON. Printful's field constraints are invisible to mocks; the nightly contract check is the only test that sees them.
- **Stripe:** hosted checkout, webhooks, admin refunds. Embedded checkout (`ui_mode: "embedded"`, `/checkout`) has one switch per buy surface: `EMBEDDED_CHECKOUT_ENABLED` (image detail page, #250) and `PREVIEW_EMBEDDED_CHECKOUT_ENABLED` (`/preview`, #135 slice 3); both need `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` in the secret key's mode or fail closed to hosted. The cart stays hosted. Radar goes to $0.05/transaction after 2027-01-22 — switch to Radar Lite or decide by January.

### Conventions

- **Server Actions**: every page directory has a sibling `actions.ts` containing `"use server"` functions (async exports only; pure helpers that need tests go in `src/lib/`). API routes under `src/app/api/` are for webhooks, crons and health only.
- **Path alias**: `@` maps to `src/` (configured in `tsconfig.json` and `vitest.config.ts`).
- **Claude API**: messages must end with a user turn — no assistant prefill. The API rejects requests where the last message role is `assistant`. See `src/lib/ai.ts:buildMessages` for the workaround.
- **Product catalog**: config-driven in `src/lib/blanks.ts`. Adding a product requires only a new entry in the `BLANKS` array with Printful variant IDs — preview, order, and checkout flows pick it up automatically. Process and discovery scripts documented in `docs/products.md`.
- **Pricing**: `total = baseCost × 1.5`. Generation cost is tracked for internal accounting but is not included in the customer-facing price. **No price is shown before the buyer has picked garment and size** (Nico, 2026-09-08) — the item floor ($19.43) excludes the $4.69 shipping line and was re-added and deleted four times (#131, #214, #215, and the 2026-09-08 removal from Shop cards + the image-detail PRICE row). Price surfaces are the expanded buy panel total, cart, Stripe, receipts. Guard: `src/lib/__tests__/no-preselection-price.test.ts` (fails on any `From $` string or catalog-floor helper in product code). Do not write a price into a brief or a plan.
- **Ledger**: append-only financial log (`ledger_entry`). Money-path changes get real-DB tests and a dedicated adversarial review.
- **`order.quality`**: deprecated column kept nullable for historical orders. Do not use in new code.
- **Copy**: persona C, "The Clean Label" (`docs/design-system.md` Part 1): neutral, nearly invisible copy, zero whimsy. The landing hero ("PRiNT your brAIn" / "Type it — See it — Wear it") is Nico's deliberate exception; don't sweep it.
- **Look**: Paper (light only). Tokens in `src/app/globals.css`; ink borders, no shadows, mono uppercase labels; rose is the only accent and appears on exactly the wordmark and the Generate button. No checkerboard. Every text/background pair meets AA.
- **Publishing** requires a real account (`isAnonymousUser` gate in `publishImage`).
- **Tests**: real-DB integration tests run against an in-memory libSQL built from `schema.ts` (`src/lib/__tests__/test-db.ts`); shared seed factories in `src/lib/__tests__/factories.ts`; `src/lib/**` tests run under node, not jsdom.

## Environment Variables

`.env.local` is injected from 1Password via the committed `.env.tpl` and must point at **prntd-dev**. Compare it against the vault with `npx tsx scripts/diff-env.ts` (prints key names only; a raw `diff` prints every secret). `vercel env pull` re-materializes prod values into it — that has pointed local dev at prod twice.

```
DATABASE_URL, DATABASE_AUTH_TOKEN          # Turso (local: prntd-dev)
IDEOGRAM_API_KEY                           # image generation
ANTHROPIC_API_KEY                          # briefs + chat
R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME (= prntd)
NEXT_PUBLIC_R2_PUBLIC_URL                  # pub-xxx.r2.dev
STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
PRINTFUL_API_KEY
PRINTFUL_DRY_RUN                           # "true" short-circuits order submission (local e2e sets it)
PRINTFUL_AUTO_CONFIRM                      # defaults ON
BETTER_AUTH_SECRET
RESEND_API_KEY
NEXT_PUBLIC_APP_URL                        # https://prntd.org (Stripe return + reset URLs build from it)
ADMIN_EMAIL                                # gates /admin; matched with ===
OWNER_EMAIL                                # new-order alert recipient (defaults to nico@prntd.org)
CRON_SECRET                                # Bearer token for /api/cron/* (Production scope)
GUEST_FUNNEL_ENABLED, CART_ENABLED, MULTI_PLACEMENT_ENABLED   # all ON in prod
USER_GEN_DAILY_CAP, GUEST_GEN_DAILY_CAP, IP_GEN_DAILY_CAP, USER_IP_GEN_DAILY_CAP   # generation quota overrides
GUEST_CHAT_DAILY_CAP, USER_CHAT_DAILY_CAP, IP_CHAT_DAILY_CAP, USER_IP_CHAT_DAILY_CAP   # chat quota overrides (#260; 0 refuses every call)
EMBEDDED_CHECKOUT_ENABLED, PREVIEW_EMBEDDED_CHECKOUT_ENABLED  # embedded checkout per buy surface (image detail page, /preview); image detail page's ON in prod, /preview's off
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY         # pk_ matching STRIPE_SECRET_KEY's mode; without it either switch fails closed to hosted
NEXT_PUBLIC_FEEDBACK_PROJECT_ID            # feedback widget target
REPLICATE_API_TOKEN                        # ops scripts only
```

Vercel env changes apply only to new deployments. A flag a Playwright spec needs must be set in CI's e2e env, and in Vercel's Preview scope to test on a preview deploy.

## Current state (2026-10-01)

- **Batch 3** (`docs/superpowers/plans/2026-09-28-batch-3.md`; Nico agreed to all eleven recommendations 2026-09-28). Merged: **#260** (#253 chat caps), **#261** (#12 zip export; smoke passed with a 62 MB part, so Vercel's 4.5 MB response cap does not apply to the streamed zip; zip readers on phones unverified), **#265** (#263: `USER_IP_GEN_DAILY_CAP` default 100 for signed-in users, guests stay at `IP_GEN_DAILY_CAP` 20; identity refusals don't bump the IP bucket; the generation quota no longer depends on `GUEST_FUNNEL_ENABLED`; generation and chat count through one `consumeBuckets` helper), **#267** (#135 slice 3, see below), **#268** (#235 app icon, see below). **Open, built 2026-10-01:** **#274** (slice 2, #14 colours: Classic Tee 25 → 83, sorted light to dark in `blanks.ts`; `BACKGROUND_PALETTE` pinned to its 25; the mockup prefetch stays at the Classic Tee's original 25 via `Blank.prefetchColors`, the rest render on demand; Women's Relaxed Tee hexes replaced with Printful's; `scripts/check-blank-variants.ts` checks variant ids against Printful's public catalogue, no key). Nico's calls on #274 before merge: 83 swatches put Size about 750px below Colour on `/preview` at 390px; on-demand renders raise the `mockup_urls` ceiling to 83 per product. Not yet built: slice 4 (rose swap; needs the mock round), slice 7 (#139 spike).
- **App icon (#235, #268, merged 2026-09-30):** Nico picked "P R i / N T D" (six ink tiles on Paper; the i-block is a rose square dot over a Paper stem). `src/app/icon.svg` (outlined paths, no font), `favicon.ico` 16/32/48, `apple-icon.png` 180, `public/icons/` 192/512/maskable-512, `manifest.ts` (`display: "standalone"`, which matches how Nico's existing home-screen install already behaves). Regenerate every file with `npx tsx scripts/generate-icons.ts` (downloads Geist 900, pinned by SHA-256). The OG card still carries the rose wordmark. Mock canvas: https://claude.ai/artifact/CyukHDtCkGQc5JhpzLVAhW
- **Embedded checkout passed its phone test on a Preview deployment (Nico, 2026-09-28):** a published design bought from its image detail page stayed on the preview's `/checkout`, paid with a test card, and landed on `/order/confirm`. So `checkout.sessions.retrieve` does return `client_secret` for an open embedded session. Vercel Preview now has its own test-mode `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `EMBEDDED_CHECKOUT_ENABLED=true` and `PRINTFUL_DRY_RUN=true`; `PRINTFUL_API_KEY`, `STRIPE_WEBHOOK_SECRET`, the AI keys and the R2 bucket are still shared with Production. The preview database's Shop is empty, and an unpublished design's Order goes to `/preview` (hosted), so a preview test needs a design generated and published first. **On in Production since 2026-09-29** for purchases from the image detail page (`pk_live` + `EMBEDDED_CHECKOUT_ENABLED=true` in Production scope, redeployed; `prntd.org` registered under Stripe's payment method domains). Nico's real purchase on prntd.org passed end to end the same day, including a front/back swap. **`/preview` on embedded checkout (#267, merged 2026-09-30)** behind its own switch `PREVIEW_EMBEDDED_CHECKOUT_ENABLED`: ON in Preview (smoke passed on the PR preview 2026-09-29), OFF in Production, so prod `/preview` is still hosted. #267 also fixed #264 (primary change clears `mockup_urls`) and made `/order/confirm` read the Stripe session for any pending order regardless of switches. The nightly Stripe e2e drives the embedded iframe for `/preview`. Its first runs failed (2026-09-30 and 10-01, #270) because Stripe renders "Pay with card" as a hidden overlay; #271 opens the Card accordion by its row, and a dispatched run on main at `841fbe0` passed 2026-10-01. Turning the switch on in Production waits for a green scheduled nightly (the first one with the fix runs 2026-10-02). The cart stays hosted. Hosted checkout from a Preview deployment always returns to prntd.org (`NEXT_PUBLIC_APP_URL`), so a hosted preview purchase ends on "Order not found." there; only embedded returns to the preview host. Whether Apple Pay or Google Pay shows in the embedded form is not recorded.
- **Prod** is main at `841fbe0` (#262; #271 before it). Batch 2 merged 2026-09-27: #254 (security bump: Next.js 16.3.6, Better Auth 1.6, Drizzle 0.45.3; adds `reparent-user-schema-coverage.test.ts`, which fails when a table with a user FK is missing from `reparentUserData`), #255 (`middleware.ts` → `src/proxy.ts`, runs on Node), #256 (sign-in open-redirect fix; admin pages print Pacific dates; guest publish points to sign-up; sign-up honours `next`; running-jobs badge counts guests), #257 (#251: `createStripeCheckoutForOrder` → `src/lib/order-checkout.ts`, `prefetchProductMockups` → `src/lib/mockup-prefetch.ts`; `server-action-exports.test.ts` pins the exports of four "use server" files and bans those helpers from every one; owner check in `addToCart`). Shared-conventions block committed to `AGENTS.md`.
- **Also merged 2026-09-27:** #258 (My Designs in the top nav at `/designs`; `/studio/library` and `/studio/archive` 308 there; the proxy's sign-in redirect carries `?next=`), #259 (#245: client-minted job id, so a lost Generate response no longer reads as failed). Whenever main moves, Claude merges main into the still-open PRs, `npm ci`, re-gates, pushes.
- **HELD: #249** — composition slice 5, migration `0014_thin_pride.sql` (drops `store`, `product_offering`, `order.store_id`, `product.store_id`, `product.design_id`; `listing` → `image_publication`). Nico runs the migrate-first runbook in the PR body (pre-check → rehearse on `prntd-0014-rehearsal` → backup → migrate prod → verify = merge gate → merge → preview after → dev); correction comment on the PR: a guest whose sign-up failed in the window signs IN. Main is kept merged in; the 2026-09-27 PR comment lists what those merges changed (store dropped from the reparent coverage list, `storeId` removal ported to `order-checkout.ts`, `shop/actions.ts` pin removed). Migration SQL unchanged.
- **Smokes owed by Nico, one per message:** still signed in when PRNTD is opened from the new home-screen install (#268); #265 (a signed-in Generate still works); #260 (chat reply still works); from batch 2, #254, #255, #256, #257; older, #246 (#418 on Slow 4G reloads) and the #242/#243 delete smoke. Passed: prod `/preview` still opens hosted checkout after #267 and the new home-screen icon after #268 (both 2026-09-30), #267 (embedded on its PR preview, 2026-09-29), #261 (62 MB zip, 2026-09-29), #258, #259 (good enough), #247 (swap, during the 2026-09-29 purchase). #250's flag-off smoke is superseded by the Production switch-on.
- **Batch lesson:** subagents launched with the Agent tool can't launch their own agents. Controllers should run implementers/reviewers as `claude -p` subprocesses, and the main session runs an independent Opus whole-branch review of every branch before its PR — every batch-1 review found real defects. Build the combined tree of all open branches + main locally before merges; it catches semantic conflicts `git merge-tree` can't. Batch 2 showed the same thing after merge: new guard tests from one PR (#254's reparent coverage, #257's export pins, #254's `guest-claim` e2e) failed on other open branches (#249, #258) with no textual conflict. Batch 3 added: a Vercel env change only reaches builds created after it, and the branch preview URL keeps pointing at the latest push build (a dashboard redeploy didn't move it), so push a commit after changing Preview env before a smoke (#267's first smoke ran on a build 4 seconds older than the switch). Also: give every controller its own scratch directory (two controllers sharing one overwrote each other's files and a review read the wrong slice's output), and address worktrees with `git -C <path>` rather than `cd` when Bash calls run in parallel (a merge meant for a check tree landed on a feature branch's local copy). 2026-10-01, for small slices: the main session dispatched one Sonnet implementer per slice directly with the Agent tool (own worktree, no controller layer), re-ran the gate itself, ran one Opus whole-branch review per branch, and sent fix rounds back to the same implementer; about 100–155k subagent tokens per implementer and 90–135k per review. A slice's fence should name the consumers of the data it grows: #14's implementer found the mockup prefetch looping over every colour only because the brief asked it to list consumers.
- **Open, built 2026-10-01: #273** (#266): the Stripe webhook claims on `checkout.session.completed` only when `payment_status` is `paid` or `no_payment_required`; `async_payment_succeeded` runs the same claim, `async_payment_failed` abandons a pending order. No migration. Owed by Nico in the Stripe dashboard: subscribe both async events on the Production webhook endpoint (not a merge gate while no delayed method is enabled in live; required, with #272, before enabling one).
- **Open, built 2026-10-01: #276** (Studio anchor): an accepted Generate clears the anchor it was sent with, so the next idea starts a new lane (Nico's decision, reversing the studio plan's sticky anchor); a Generate that did not run hands back its words with the anchor state it was sent with. Several edits from one image now need "Edit this one" each time. **#277** (base costs): every `baseCost` set to Printful's list price as read 2026-10-01; item price computed in integer cents by `priceFromCost` (the float expression added a cent at some costs). Raises the Box Tee and Women's Relaxed Tee item prices; the Classic Tee's `retailPrice` holds. Waiting on Nico: whether to lower `MARGIN_MULTIPLIER` and whether the Classic Tee keeps its fixed price; either change lands on #277 before merge. #274 and #277 both edit `src/lib/blanks.ts`; the combined tree of main + #273 + #274 + #276 + #277 + #249 merges clean and passes typecheck, lint and tests (2026-10-01).
- **Open issues:** #272 (`/order/confirm` and the embedded return path say confirmed for a completed session whose payment is unpaid or failed; needs copy), #269 (Studio → order takes one tap too many; path traced on the issue 2026-10-01: lane image → lightbox → "Open" → image detail page → Order → `/preview`; needs Nico's call on the buy entry surface), #266 (fixed by #273), #188 (Paper look — slice 4 focused stage needs Nico's call; slice 8 leftovers), #135 (slice 4), #139 (light/dark shirt filter), #127 (phone speed check), #14 (fixed by #274), #4 (charity, paused). Closed 2026-09-27 to 10-01: #251, #245, #253, #12, #263, #264, #235, #270. Nico's 2026-09-29 report of a new image landing in the previous Studio lane was the anchor left set after "Edit this one" (he confirmed 2026-10-01); fixed by #276.
- **Backups:** `prntd-backup-20260908` (safe to delete).
- **Watch items:** anonymous mockup renders (front and back) append to the seller's `design.mockup_urls` (~230 KB/design; revisit at 10× the Shop); the admin Refund button has never run on a real Printful cancel; fulfillment recovery can persist `submitted` with no COGS when Printful omits `costs.total` (loud log, book it by hand); leftmost `x-forwarded-for` feeds the IP quota.
- **Deferred:** the prompt-quality eval harness (`docs/async-generation-and-edit-plan.md` slice 4); hosted-checkout fallback when Stripe.js is blocked (#250 ledger).

## Standing rules

### Migration discipline

- Flow: edit `schema.ts` → `npm run db:generate` → review the SQL in the PR → apply → merge. `db:push` is dev-only.
- **Additive migrations (new tables/columns): apply to prod BEFORE the PR merges.** Old code ignores what it doesn't select, so this order has no window. Main auto-deploys; merging first took prod down twice (0006 on 2026-07-25, 0013 on 2026-09-08). Mark schema PRs HOLD in the title and keep them held.
- **Destructive migrations (drops, renames): neither order is free.** Old code on the new schema fails on dropped columns; new code on the old schema fails on renamed ones. The PR must trace both windows (Stripe webhook, fulfillment, emails, crons) and its runbook names the order. Follow the runbook. Usually migrate-first wins: old code on the new schema tends to fail before anything commits (webhooks 400 and Stripe redelivers), the window is only the merge + build, and a failed migration means simply not merging. Rehearse first on a throwaway branch of prod (`turso db create prntd-<N>-rehearsal --from-db prntd`), since tests only cover the sqlite path, not Turso's hrana path on prod's real schema history. `drizzle-kit migrate` can exit 1 with no error text, so read the exit code.
- Back up first: `turso db create prntd-backup-<YYYYMMDD> --from-db prntd`.
- Prod: `DATABASE_URL=libsql://prntd-nicolovejoy.aws-us-west-2.turso.io DATABASE_AUTH_TOKEN=$(turso db tokens create prntd) npm run db:migrate`. Preview: same with `prntd-preview`. Run from a checkout synced to current main — a stale `drizzle/` folder "succeeds" as a no-op.
- CI migrates only its ephemeral copy. Apply every migration to `prntd-preview` and `prntd-dev` by hand too.
- Verify DB state after every migration with a read-back script; don't trust a clean exit. `scripts/migration-smoke.ts` exits 1 on any dropped table, so it is wrong for drop migrations — use a purpose-built parity check.
- drizzle-kit traps: a table recreate's `INSERT … SELECT` turns unknown double-quoted column names into string literals (hand-patch with `ALTER TABLE … ADD COLUMN` first); `DROP COLUMN` fails on libSQL for a table-level-FK column (recreate the table); expression indexes get mangled (use a generated column); rename prompts are interactive; when resolving a journal merge conflict, restore main's snapshot before `db:generate`.
- Schema history: `drizzle/0000_baseline.sql` onward; `docs/migration-adoption-plan.md`.

### PRs, agents, and review

- Nico merges into main. Claude opens and edits PRs on its own `claude/*` branches.
- Run `npm run typecheck` as well as lint/test/build; agents have skipped it and CI caught it.
- A PR whose CI went green against an older main hasn't validated the combined tree. Merge main into the branch and re-run the gate before calling it ready.
- A stacked PR goes DIRTY once its base squash-merges; fix with `git rebase --onto origin/main <old-base>` (before review) or merge main (after).
- The whole-branch review finds what per-task reviews structurally can't: stale comments a few lines from a change, invariants other modules rely on, a second caller. Always run one before a PR. Re-run tests yourself instead of trusting an implementer's report.
- Never tell a reviewer what not to flag.
- Copy SDD ledgers into `docs/superpowers/ledgers/` before removing a worktree.

### Runtime gotchas

- libSQL over HTTP has no interactive transactions: use `db.batch`, conditional `UPDATE … WHERE status=…`, and guarded `INSERT … SELECT … WHERE`. `isUniqueViolation` walks `.cause` (a bare drizzle insert wraps the libSQL error).
- Prod masks server-action errors. Look in `/admin/errors` or tail `vercel logs prntd.org --json` while reproducing.
- Next.js: route segment config (`revalidate` etc.) can't be re-exported; a `router.replace` right before a server-action call gets cancelled (use `history.replaceState`); sign-in/up hard-navigate with `window.location.href` because a concurrent header action can swallow `router.push`; a random or clock-derived value in a client component's render is a hydration mismatch.
- satori/resvg OG rasters can't render under vitest; verify OG cards against a real `next start`.
- Tailwind v4: unlayered CSS in `globals.css` beats every utility (guard test `src/app/__tests__/globals-css.test.ts`); bare `border-b`/`divide-y` paint `currentColor`.

### Cloud sessions

- prntd.org and `*.vercel.app` are blocked by the egress proxy, and prod DB tokens can't be minted inline. Live smokes, prod reads, and prod migrations go to Nico.
- Playwright here: `chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })`; never `playwright install`.

### Smoke tests

- One smoke per message. Self-contained: full URL, numbered steps, what PASS and FAIL look like.
- Use distinctive strings (not "test") so the result is findable in prod data.

<!-- SHARED-CONVENTIONS:BEGIN v=28022362f01b — auto-managed, do not edit here; source: prompt-lab/workflow/claude-md-shared.md (edit + re-sync) -->
## Shared conventions

<!-- These are Nico's cross-repo output rules. They're materialized into each repo's
CLAUDE.md and AGENTS.md so every agent (local, cloud, third-party) sees them as plain
text. Source of truth: prompt-lab/workflow/claude-md-shared.md — edit there and
re-sync, never here. -->

- **Clickable URLs.** When pointing at any web destination (dashboard, repo, PR, deploy, settings, docs, localhost), print the full bare URL — `https://example.com` or `http://localhost:8080` — on its own, never just the page's name and never a markdown `[label](url)` link. Nico's terminal auto-linkifies raw `https://` text, so a bare URL is one-click and stays copyable.

- **Number your questions.** Any time you ask Nico more than one question, present them as a numbered list (1., 2., 3.) so he can answer by number with no ambiguity. A single standalone question needs no number.

- **Self-contained smoke-test instructions.** When you ask Nico to manually test or verify an app or website, assume zero carried-over context — he should never scroll back or recall a URL/path/credential from earlier. Always include: the exact URL (full `https://…` or `http://localhost:…`, restated even if mentioned above), the precise steps in order, and what a pass vs. fail looks like. Repetition here is a feature, not clutter.

- **UTC at rest, Pacific on display.** Timestamps are stored in UTC, always. A *calendar day* shown to a human is `America/Los_Angeles` — Nico's day, and the clock the work actually happened on. The two rules that follow are the ones that get broken: never form a date bucket with `new Date(…).toISOString().slice(0,10)` (that is UTC, so every chart axis and "today" silently rolls over at 5pm Pacific — it put a phantom tomorrow bar on the Prompt Lab dashboard), and never bucket UTC-stamped rows with a bare `date(col)` in SQL. Use `Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' })` in JS and an explicit zone in SQL/Python. Storage in local time is also wrong — it can't be migrated across a DST boundary without loss.

- **No marker before a copy-paste command block.** Nico's terminal renders markdown bullets (`-`, `*`, `•`) as `●`, which breaks paste into zsh. The line directly above a fenced command block must be a plain-text label ending in a colon — never a bullet, dash, asterisk, or number. For loud copy targets, lead the label with `📋` + bold `COPY THE BELOW`, then a colon, then the block. Bracket anything Nico will paste elsewhere (a prompt for another agent, a multi-line command) with a ruler line of `================` above the label and below the closing fence. Rulers go outside the fence so they aren't copied, each with a blank line before it (a `===` line directly under text renders as a heading).

- **No bare backslash in a copy-paste command block.** A `\` is load-bearing shell syntax that renders invisibly and gets silently dropped somewhere between the markdown render, the clipboard, and zsh. `find … -exec test -e {} \; -delete` arrived in the terminal as `… {} ; -delete`, which zsh split into two commands and reported as `find: -exec: no terminating ";"` plus `command not found: -delete` (2026-09-20). Quote it instead — `';'` is exactly equivalent to `\;` and survives any copy path. For the same reason never break a command across lines with a trailing `\`: write one long line, however wide it wraps.

- **Codex branches are named `codex/<description>`.** When working in this repo via Codex CLI, always create a working branch under the `codex/` prefix (e.g. `codex/fix-flaky-test`) rather than working directly on `main` or an unprefixed branch. Claude Code has no visibility into other tools' running sessions (`ListAgents` only sees Claude sessions), so this prefix is the one signal a Claude session can check for — a local or remote `codex/*` branch means Codex has touched or is touching this repo, even though its session itself is invisible. Claude branches keep whatever naming they already use; only Codex adopts this new prefix.

- **Codex: run commands in a form a rule can match.** Codex approval rules match a command's leading tokens, so a wrapped command never matches an existing allow and every variant prompts again, then leaves a dead one-off "don't ask again" rule behind (36 of them in five days, 2026-09-23). The program is the first token: call helpers and tools directly, never through `/bin/zsh -lc "…"`, never with a `PATH=…` or other `VAR=…` prefix, never with `$(…)` in the arguments. Work only inside your clone (one long-lived `~/src/<repo>-codex`, no worktrees, no scratch clones — everything outside it escalates, except the cross-repo handoff log at `~/src/.handoff`, which is granted). Redirect output only to files inside the workspace, and keep temp files in a gitignored `tmp/` there, never `/private/tmp`. If a tool is missing from `PATH`, report it: the fix belongs in `~/.zprofile` (Nico's edit), not in an inline `PATH=` prefix.

- **A review another agent must act on goes on the PR.** A review that another agent must act on, or that must outlive the session, is posted as a PR comment (`gh pr comment`), where the next session or agent finds it. Live, in-session reviews between Nico and the agent stay in chat. There is no devlog.md: the history DB is the one session record.
<!-- SHARED-CONVENTIONS:END -->

## Cross-repo handoff with prompt-lab

This repo coordinates with **prompt-lab** (whose agent surveyed all of Nico's repos for CI/CD + DB patterns) through an append-only log in the private repo `nicolovejoy/handoff`, cloned to `~/src/.handoff`. The matching file is `prntd-prompt-lab.md`. prompt-lab's SessionStart hook auto-injects its `## Active` section; here, read it manually at session start. To reply, append an entry to the top of `## Active` (`### YYYY-MM-DD prntd → prompt-lab: <subject>`) and `cd ~/src/.handoff && git pull --rebase && git commit -am … && git push` (or use prompt-lab's `~/.claude/bin/handoff.sh append`/`sync` if installed). Move acted-on entries to `## Archived` with a one-line outcome.
