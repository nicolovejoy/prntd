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

PRNTD — AI-powered t-shirt designer. Users chat to describe a design, Flux generates it, users iterate, then order via Printful. Live at prntd.org.

## Tech Stack

- Next.js 16 (App Router) on Vercel
- Turso (libSQL) + Drizzle ORM
- Better-Auth (email/password)
- Cloudflare R2 for image storage
- Ideogram v3 Turbo via Replicate for image generation
- Claude (Anthropic API) as intermediary to construct image generation prompts from casual user messages
- Printful API for fulfillment
- Stripe Checkout for payments

## Commands

```bash
npm run dev          # Local dev server
npm run build        # Production build
npm run lint         # ESLint
npm test             # Vitest run (no watch)
npm run db:push      # Push Drizzle schema to Turso
npm run db:studio    # Drizzle Studio (database GUI)
```

## Tooling & CI

GitHub Actions workflow `.github/workflows/ci.yml` runs `lint`, `test`, and `build` on every PR and push to main. Branch protection requires the `check` job to pass and one approving review before merging to main. Admins can bypass.

Lint policy:
- `@typescript-eslint/no-explicit-any` is `error` in product code, `off` in test files (`**/__tests__/**`, `*.test.ts(x)`). Mocks are the canonical case for `any`; production code should type things.
- For `catch` clauses: use `catch (err)` (defaults to `unknown`) and narrow with `err instanceof Error ? err.message : String(err)`. Don't annotate `err: any`.
- `scripts/**` is excluded from lint (also excluded from tsconfig). One-off ops scripts.

**Before tightening any lint rule, type-check, or CI gate**: run it locally against the current codebase first. If existing code already violates the new rule, decide between (a) cleaning the violations, (b) scoping the rule narrower (e.g. test-only), or (c) downgrading severity — and do that work *before* pushing the gate. Don't push a stricter gate without that audit, or the next PR will be blocked for reasons unrelated to that PR.

Vercel preview deploys on PRs require the PR author's GitHub user to be authorized in the Vercel team. Collaborator PRs from outside the team may show a Vercel build failure that's actually a team-membership issue, not a code problem.

## Architecture

### Route Structure (linear flow with breadcrumbs)

```
/                → Landing page
/design          → Chat + AI design generation (core loop)
/preview         → Design on shirt mockup, refine/approve
/order           → Size, color, quality, pricing breakdown
/order/confirm   → Stripe checkout + confirmation
```

### Core Loop (`/design` → `/preview`)

User describes design in chat → Claude interprets intent and constructs Ideogram prompt → Replicate generates image via Ideogram v3 Turbo → stored in R2 (`designs/{design_id}/{generation_number}.png`) → displayed inline in chat. User can refine (back to chat with context), try new, or approve → flows to /preview. Chat history maintained per session. Each generation increments token/cost counter.

### Data Model (Drizzle + Turso)

Six tables (all singular names to match Better-Auth defaults): `user`, `session`, `account`, `verification` (auth), `design` (tracks chat_history JSON, current_image_url, generation cost, status draft/approved/ordered), `order` (links design to Printful order, Stripe session, shipping details, status lifecycle, `classification` for financial categorization, freeform `tags` for supplementary metadata).

### Payment Flow

Stripe Checkout Session → redirect → webhook confirms payment → triggers Printful order submission. Price = Printful base + accumulated generation cost + margin.

### Key Integration Points

- **Replicate**: image generation via Ideogram v3 Turbo
- **R2**: all generated images kept so user can revisit previous generations
- **Printful**: product catalog, mockup generation, order submission, status webhooks
- **Stripe**: checkout sessions, payment webhooks

## Environment Variables

```
DATABASE_URL            # Turso connection string
DATABASE_AUTH_TOKEN     # Turso auth token
REPLICATE_API_TOKEN     # Replicate (Flux)
ANTHROPIC_API_KEY       # Claude for prompt construction
R2_ACCOUNT_ID           # Cloudflare R2
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET_NAME
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
PRINTFUL_API_KEY
BETTER_AUTH_SECRET
NEXT_PUBLIC_R2_PUBLIC_URL # R2 public bucket URL (pub-xxx.r2.dev)
NEXT_PUBLIC_APP_URL     # e.g. https://prntd.org
ADMIN_EMAIL             # email of the admin user (gates /admin)
PRINTFUL_DRY_RUN        # "true" to short-circuit Printful order submission (local testing)
```

## Known Issues / Next Steps

### Done

- ~~Mobile layout for design page~~ — gallery collapses into slide-in drawer on mobile, floating toggle button
- ~~Sign out accessible from all pages~~ — SiteHeader is now auth-aware on every page
- ~~Migrate existing pages to design system components~~ — all pages use Button, Badge, Card, Input from `src/components/ui/`
- ~~Order tracking infrastructure~~ — updatedAt, stripePaymentIntentId, trackingNumber/URL on order table
- ~~Printful webhook handler~~ — /api/webhooks/printful handles package_shipped and order_failed
- ~~User-facing /orders page~~ — order history with status badges and tracking links
- ~~Admin retry for stuck orders~~ — retry button on paid-status orders in admin table
- ~~Fix nav and confirm page~~ — Orders link in header, confirm page links to /orders instead of promising emails
- ~~Extract testable business logic~~ — pricing, order state machine, webhook handlers in src/lib/ with 28 tests
- ~~Transactional emails via Resend~~ — order confirmation + shipping notification, fire-and-forget from webhooks
- ~~Password reset flow~~ — Better-Auth sendResetPassword + Resend, /forgot-password and /reset-password pages
- ~~Email domain~~ — switched to orders@prntd.org via Resend Pro with Cloudflare DNS
- ~~Printful webhook registered~~ — via API (`POST /webhooks`) for package_shipped and order_failed
- ~~Image upload in design chat~~ — drag-and-drop + file picker, stored in R2, visible to Claude in gallery context
- ~~Printful webhook: order_canceled~~ — auto-updates status, zeroes cost
- ~~Order archiving~~ — soft-delete, blocks archiving shipped/Printful orders
- ~~Printful cost tracking~~ — stores actual fulfillment cost from API, backfilled via sync script
- ~~Accounting foundation~~ — append-only ledger_entry table, order tags, admin financial summary (revenue/fees/COGS/profit)
- ~~Order reconciliation~~ — all orders matched against Printful billing, 4 ghost orders identified and canceled
- ~~Order classification system~~ — single-select classification (customer/sample/test/owner-use) separate from freeform tags, financial summary filtering by classification, admin reference section. Ledger starts April 1, 2026 (no backfill of pre-ledger orders).
- ~~Composable admin filter/sort~~ — useReducer-driven FilterState, client-side summary computation with ledger+fallback, multi-select classification, sortable columns, 26 tests in admin-filters.test.ts
- ~~Order detail page~~ — `/admin/orders/[id]` with full order info, ledger timeline, classification/tag management
- ~~Customer order filters~~ — Active/Canceled/All status filter on /orders page, canceled Badge variant
- ~~Build fix~~ — excluded scripts/ from tsconfig to prevent type collisions
- ~~Stripe fee backfill~~ — all orders have complete ledger entries (sale + stripe_fee + cogs), fallback logic removed
- ~~Multi-product plumbing~~ — productId wired through preview/order/checkout, colors/sizes/labels from product config, SHIRT_COLORS deleted
- ~~Product catalog~~ — 3 products: Classic Tee (13 colors), Box Tee (5 colors), Clear iPhone Case (13 models)
- ~~Product selector UI~~ — product picker cards on /preview, background preloads all mockups (throttled 3 concurrent), rotating loading messages, instant switching when cached
- ~~Discount code plumbing~~ — allow_promotion_codes on checkout, webhook captures discountCode/discountAmount, ledger uses actual amount paid. "Launch Special" coupon (50% off) created in Stripe with nico-codes and atlas codes.
- ~~Preview page overhaul~~ — deferred mockup rendering (no eager preload), image scale slider, product silhouettes with print area overlay, color picker moved above preview, iPhone case mockup fix
- ~~Test coverage expansion~~ — 84 → 121 tests: ledger, chat-utils, products, AI prompt parsing, discount webhook path
- ~~Remove quality selector~~ — stripped standard/premium from pricing, order page, checkout, webhooks, email, admin, tests. Schema field kept nullable for historical orders.
- ~~Admin Recover action for stuck pending orders~~ — replays Stripe webhook flow via shared `handleStripeCheckoutCompleted`; extracted `sendPostOrderEmails` helper; structured `{ok, reason}` response so admin alerts show actual failure reason (e.g., "Stripe session is not paid"). 14 new TDD tests.
- ~~Drop generation cost from customer-facing price~~ — baseCost × 1.5 only; generationCost still tracked on design row for internal use. Fixes order page breakdown where line items didn't sum to total.
- ~~Admin list shows time to the minute~~ — easier Stripe cross-reference.
- ~~Claude model swap~~ — `claude-sonnet-4-20250514` → `claude-sonnet-4-6` with Sonnet 4.6 compatibility fixes (no assistant prefill, useEffect loop)
- ~~Women's Relaxed Tee~~ — Bella+Canvas 6400, 22 colors, S–3XL, Printful product ID 360, variant fetch script at `scripts/fetch-variants-6400.ts`
- ~~Product catalog~~ — now 4 products: Classic Tee, Box Tee, Women's Relaxed Tee, Clear iPhone Case

**Discount codes + promo (remaining)**
- Test end-to-end checkout with a promo code on local dev + Stripe test mode (see validation checklist in memory)
- Show discount info on admin order detail page and /orders
- Decide whether to charge shipping as a separate line so percentage promo codes don't eat margin to zero (currently `shipping_options` not set, shipping is baked into COGS; 50% off launches at structural loss)

**1Password secret migration (paused 2026-04-14)**
- `.env.tpl` drafted locally with `op://dev-secrets/prntd-*` refs — NOT committed
- TODO: create 9 items in 1Password `dev-secrets` vault, `op inject` to regenerate `.env.local`, update Vercel prod env for Anthropic key, revoke old global key
- See memory `project_anthropic_key_rotation.md` for full checklist

**Local dev testing setup**
- ~~`PRINTFUL_DRY_RUN` env flag~~ — shipped, validated end-to-end on 2026-04-27
- ~~Document local dev + Stripe test mode workflow~~ — `docs/e2e-testing.md`

**Email + order naming clarity**
- Owner alert and customer confirmation subject lines lack at-a-glance context — `docs/current-state.md`-style audit captured in the GitHub issue (Max's first PR)
- Auto-name each order from the dominant text in its design image (e.g. "Artificial Idiot" instead of `3cd9d356`). Use it in admin list, /orders, email subjects, owner alerts. Need a way to extract the text — Claude vision call at order time, or pull from the chat history that produced the design.

**Design conversation persistence**
- Design threads must stay accessible after ordering (not hidden/locked)
- Navigation between past purchases ↔ design conversations
- Iteration UX within a thread needs improvement

**Mobile flow rethink**
- Design→preview→order feels fragmented on phones — too many page jumps
- Consider collapsing preview into design page, or a stepped flow

**Product expansion**
- Posters, canvas prints, stickers, hoodies (future)
- Multi-placement support (front/back printing) — see docs/products.md

### Ongoing
- hledger export script (docs/accounting.md has the architecture)
- Drag-and-drop image upload not working on some browsers — file picker works
- Rate limiting / generation caps
- Next.js 16 middleware → proxy migration
