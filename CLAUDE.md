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
npm test             # Run all tests (Vitest)
npm run test:watch   # Vitest in watch mode
npx vitest run src/lib/__tests__/pricing.test.ts  # Run a single test file
```

## Tooling & CI

GitHub Actions workflow `.github/workflows/ci.yml` runs `lint`, `test`, and `build` on every PR and push to main. Branch protection requires the `check` job to pass and one approving review before merging to main. Admins can bypass.

Lint policy:

- `@typescript-eslint/no-explicit-any` is `error` in product code, `off` in test files (`**/__tests__/**`, `*.test.ts(x)`). Mocks are the canonical case for `any`; production code should type things.
- For `catch` clauses: use `catch (err)` (defaults to `unknown`) and narrow with `err instanceof Error ? err.message : String(err)`. Don't annotate `err: any`.
- `scripts/**` is excluded from lint (also excluded from tsconfig). One-off ops scripts.

**Before tightening any lint rule, type-check, or CI gate**: run it locally against the current codebase first. If existing code already violates the new rule, decide between (a) cleaning the violations, (b) scoping the rule narrower (e.g. test-only), or (c) downgrading severity — and do that work _before_ pushing the gate. Don't push a stricter gate without that audit, or the next PR will be blocked for reasons unrelated to that PR.

Vercel preview deploys on PRs require the PR author's GitHub user to be authorized in the Vercel team. Collaborator PRs from outside the team may show a Vercel build failure that's actually a team-membership issue, not a code problem.

## Architecture

### Route Structure (linear flow with breadcrumbs)

```
/                       → Landing page
/design                 → Chat + AI design generation (core loop)
/designs                → Past design threads (auth-protected)
/preview                → Design on shirt mockup, refine/approve
/order                  → Size, color, pricing breakdown
/order/confirm          → Stripe checkout + confirmation
/orders                 → Customer order history with status/tracking
/admin                  → Admin order list with filters, financial summary
/admin/orders/[id]      → Admin order detail, ledger timeline, classification
/(auth)/sign-in         → Sign in
/(auth)/sign-up         → Sign up
/(auth)/forgot-password → Initiate password reset
/(auth)/reset-password  → Complete password reset
```

Auth is checked in `src/middleware.ts` via session cookie. `/admin` is additionally gated by `ADMIN_EMAIL` env var (checked server-side in the page/actions).

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

### Conventions

- **Server Actions**: every page directory has a sibling `actions.ts` containing `"use server"` functions. API routes under `src/app/api/` are for webhooks only.
- **Path alias**: `@` maps to `src/` (configured in `tsconfig.json` and `vitest.config.ts`).
- **Claude API (Sonnet 4.6)**: messages must end with a user turn — no assistant prefill. The API rejects requests where the last message role is `assistant`. See `src/lib/ai.ts:buildMessages` for the workaround.
- **Product catalog**: config-driven in `src/lib/products.ts`. Adding a product requires only a new entry in the `PRODUCTS` array with Printful variant IDs — preview, order, and checkout flows pick it up automatically. Variant discovery scripts live in `scripts/`.
- **Pricing**: `total = baseCost × 1.5`. Generation cost is tracked on the `design` row for internal accounting but is not included in the customer-facing price.
- **Ledger**: append-only financial log (`ledger_entry` table). Entry types: `sale`, `stripe_fee`, `cogs`, `refund`, `refund_cogs_reversal`. Ledger starts April 1, 2026 — no backfill for earlier orders.
- **`order.quality`**: deprecated column kept nullable for historical orders. Do not use in new code.

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

See `docs/next-phase.md` for the full Phase 1/2/3 plan. Top items:

**Phase 1 — public-facing readiness (on hold)**

- DESC/charity work paused as of 2026-05-06. Chain (DESC permission → entity confirmation → #4 ledger infra → first disbursement → #5 homepage re-org) still applies if/when it restarts.
- #10 ~~Order list thumbnails on shirt color~~ — shipped May 1; iPhone case "Clear" still renders on white, follow-up to special-case `type === "phone-case"`. discuss this with user

**Print targets (parallel track) — see `docs/print-targets.md` + `docs/print-targets-plan.md`**

- Phase 1 (aspect-correct generation) shipped 2026-05-02. Phase 2 (`design_image` table + backfill + dual-read) shipped 2026-05-03 — 40 designs and 40 orders backfilled.
- Phase 3 (placement-aware regeneration with provenance, removal of `design.currentImageUrl`) is the next implementation step.
- #11 Printful + checkout deep-dive (multi-placement, tax, shipping, team orders, safe-area UX) — blocks Phase 4 multi-placement UI.
- #12 Image export facility — independent, slot anywhere after Phase 3.

**Design loop rethink — phased build (active)**

- Phase 0 (Ideogram native-transparent swap) shipped 2026-05-04, commit `cf5f93f`. Transparency confirmed in prod.
- Phase 1 (negation rewriting in chat advisor system prompt) shipped 2026-05-05, commit `9647622`. Partial improvement; stubborn defaults like "tongue out on happy cartoon dog" still leak through. Refinement deferred.
- Phase 4 (doc updates to `docs/design-loop-rethink.md`) shipped 2026-05-05, commit `26f2b88`.
- Phase 2 (text-as-layer) — heaviest phase, ~1 week. Plan in `docs/phase-2-text-as-layer-plan.md`. Schema + font catalog + `composeWithText` (`@vercel/og` + `sharp`) + UI panel. Sequenced after the data model rework.
- Phase 3 (structured brief + batch-of-3) — after Phase 2. Plan in `~/.claude/plans/feedback-for-the-coding-woolly-snowflake.md`.
- #15 (silent regen hang on product switch) — structurally resolved by data model rework Step 2 (5d6cd9f handoff to b9e72e9). Verify in prod after deploy.

**Design data model rework (active) — plan: `~/.claude/plans/i-want-you-to-concurrent-fountain.md`**

- Step 0 (style-anchored regens + duplicate-call hardening) shipped 2026-05-05, commits `9421606` + `b052457`.
- Step 1 (`design.primary_image_id` column + dual-write + backfill) shipped 2026-05-05, commit `5d6cd9f`. 57 designs migrated, 4 left null (no images).
- Step 2 (`/preview` rewritten as pure function of designId/productId; `getOrCreatePlacementRender`; `generateMockup` resolves placement URL; `deleteDesign` FK cascade) shipped 2026-05-05, commit `b9e72e9`.
- Step 3 (pre-fetch Printful mockups on accept via `after()`, bulk Printful task in one call) shipped 2026-05-06, commits `2829111` + `8b878db`.
- Step 4 (`/design` gallery rewrite: source images vs Product versions section; rename "Use this image" → "Make Products") shipped 2026-05-06, commit `48691e9`.
- Step 5a (switch all reads off `design.currentImageUrl` via `getDesignDisplayImageUrl`/`resolveDesignDisplayImageUrls`; delete dead `regenerateForPlacement`; webhook gains `resolveDesignImageUrl` dep) shipped 2026-05-06, commit `dd6ffb5`. Validated end-to-end with a real test order.
- Step 5b code (drop `currentImageUrl` writes + remove from Drizzle schema; `deleteDesignImageRow` shape simplified) shipped 2026-05-06, commit `536fb8f`. Pending: `npm run db:push` to drop the column from Turso.
- Step 5c (strip `chat_history.imageUrl` from new writes, switch chat-panel inline bubble images and AI context to read from `design_image`) — deferred; chat panel currently still reads `chat_history.imageUrl` for inline rendering, and `extractImagesFromHistory` uses it to pass prior images into Claude for refinement. Non-trivial UI change.

**Followups surfaced during data model rework verification (2026-05-06)**

- **`deleteDesignImage` ignores order pinning** — the lightbox Delete on `/design` deletes a `design_image` row even if an `order.placements.front` still references its id, leaving the order with a broken thumbnail. Mirror the deleteDesign auto-archive logic at the per-image level: refuse (or skip) deletion when an order pins the row. Backstory: Nico hit this on 2026-05-06 — order shows in `/orders` and `/admin` with no thumbnail.
- **No prefetch on /preview revisit** — Step 3 prefetches all default-product colors only on `approveDesign` (fresh accept). Existing/already-approved designs revisited via `/preview` get on-demand mockups, so first color render is slow. Fix candidate: trigger `prefetchProductMockups` from `/preview` page load via `after()` when the cache is empty.
- **Bella+Canvas 3001 color spectrum** — `products.ts` lists 13 colors; Printful catalog has ~30+. Run the variant discovery script and expand the catalog entry.

**Image-gen style versatility (followup to #8)**

- Designs should default to colors that read on both light and dark shirts unless the user explicitly asks for "black lettering" / "white text". System prompt update queued; not yet shipped. After that, build the style-reference image library (#8 follow-up).

**Design fork model (#2 remainder)**

- `parent_design_id` schema + `forkDesign()` action + read-only past-thread view + "Make another like this" button. Required scaffolding before #6 marketplace.

**Discount codes (remaining)**

- Show discount info on admin order detail and /orders
- Charge shipping as a separate Stripe line so percentage promos don't eat margin to zero (currently shipping is baked into COGS; 50% off launches at structural loss)

**Mobile flow rethink** — Phase 2. Design→preview→order too fragmented on phones.

**1Password secret migration (paused 2026-04-14)** — see memory `project_anthropic_key_rotation.md`

### Ongoing / low priority

- hledger export script (docs/accounting.md has the architecture)
- Drag-and-drop image upload not working on some browsers — file picker works
- Rate limiting / generation caps
- Next.js 16 middleware → proxy migration
- Backfill `display_name` for historical orders
