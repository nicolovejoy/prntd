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
- **Product catalog**: config-driven in `src/lib/products.ts`. Adding a product requires only a new entry in the `PRODUCTS` array with Printful variant IDs — preview, order, and checkout flows pick it up automatically. Process and discovery scripts documented in `docs/products.md`.
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

- DESC/charity work paused as of 2026-05-06. Chain (DESC permission → entity confirmation → #4 ledger infra → first disbursement → homepage re-org) still applies if/when it restarts. (Homepage re-org now tracked under #18/#17; old #5 closed as superseded 2026-05-29.)
- #10 ~~Order list thumbnails on shirt color~~ — shipped May 1. iPhone case was discontinued 2026-05-26 (soft-discontinue: `discontinued: true` on `clear-case-iphone`, picker uses `ACTIVE_PRODUCTS`; historical orders still resolve via `getProduct()`).

**Readiness gate + fast thin-check — MERGED + DEPLOYED to prod (2026-06-05, PR #21, merge `cb8b0a5`)**

`feat/readiness-gate` is live on prntd.org. Two things shipped: (1) **Generate-readiness gate** — `chatAboutDesign` returns `{message, readyToGenerate}` (JSON envelope, subject+style rubric, safe-parse fallback); Generate renders as a secondary button that pops to primary when ready, plus a style hint (always clickable, never greyed-into-broken). (2) **Fast `assessReadiness` thin-check** (`src/lib/ai.ts`, Haiku `claude-haiku-4-5-20251001`, ~1s): Generate/Compare bail to a clarifying question in ~1s instead of the ~6s Sonnet builder; **fails open** on any error (constructFluxPrompt's guard is the backstop). 238 tests/lint/build green. Kept as a SOFT nudge (not hard-gate) to protect the type-a-full-idea-and-Generate path.

**/design empty-state redesign — MERGED to main (2026-06-06, PR #22).** Shipped per plan `docs/superpowers/plans/2026-06-05-design-empty-state-redesign.md`: **Layout A centered composer** — empty `/design` shows only title "Start designing", hero "What shall we draw together?", subphrase, and input+Send (no Generations column / no Generate-Compare until there's content); `isDesignEmpty(messageCount, imageCount)` pure predicate in `src/lib/design-view.ts` drives the split. Example chips reveal after inactivity as "Need a suggestion?" (eased **4s → 8s** post-merge). Generating copy → "Drawing your design…" (rotating filler removed). Buttons relabeled **Generate → "Draw it"**, **Compare → "Compare styles"**. Visual smoke (chip reveal, phone centering) was eyeballed on the Vercel preview.

Several fixes rode along on the same PR:
- **Same-origin auth (CORS fix for previews).** `auth-client.ts` no longer hardcodes `baseURL` (resolves same-origin), and `auth.ts` adds `trustedOrigins: ["https://prntd-*.vercel.app", "https://*.prntd.org"]`. Preview deploys (and `preview.prntd.org`, now wired in Vercel for op autofill) sign in without CORS. **Caveat:** Stripe checkout redirect / password-reset URLs still build from `NEXT_PUBLIC_APP_URL` (= prod), so checkout on a preview bounces to prod — separate fix if needed (derive from request origin).
- **Delete design fixed.** `deleteDesign` (`designs/actions.ts`) failed on two counts: it used `db.transaction` (libSQL interactive transactions aren't supported over the serverless HTTP connection) and never cleared `chat_message` rows (FK to `design.id`, no cascade) — so deleting any chatted-in draft threw a masked 500. Now a single `db.batch([chat_message, design_image, design])` delete; `/designs` `handleDelete` surfaces errors instead of failing silently.

**OPEN — `/design` server actions 500 on Vercel (env, not code).** All actions in `src/app/design/actions.ts` (sendChatMessage / getDesign / getDesignChat / getDesignGallery) 500 on the preview while `designs/actions.ts` (delete) works. Ruled out: custom-domain origin check (fails on `*.vercel.app` too) and module-load throws (`new Anthropic()`/`new Replicate()` don't throw on missing keys — confirmed). Strong hypothesis: a **stale/invalid API key in the Vercel Preview env scope** (most likely `ANTHROPIC_API_KEY` — passes construction, 401s at call time; also check `REPLICATE_API_TOKEN` / `IDEOGRAM_API_KEY`). **CONFIRMED env, not code (local smoke 2026-06-06):** ran `npm run dev` with a good local `.env` — every `/design` action works and Generate/Compare produce real Ideogram + Recraft images. So the code is fine; the 500 is the Vercel **Preview** env scope only (prod unaffected — homepage live, prod keys good). **Resolution (not yet applied):** refresh `ANTHROPIC_API_KEY` / `REPLICATE_API_TOKEN` / `IDEOGRAM_API_KEY` in Vercel's Preview scope.

**Multi-generator — MERGED + DEPLOYED to prod (2026-06-05, PR #20, merge `6e23d6e`)**

The `feat/multi-generator` branch is merged to main and live on prntd.org. Compare smoke-verified (real Ideogram + Recraft renders), prod Turso has both new columns (`scripts/check-multi-generator-schema.ts`). Remaining open: **#19** — PR #23 (`fix/compare-counts-19`) lands the deterministic fixes (honest/pluralized Compare summary via pure `compareSummary`, `dedupeById` gallery guard, 10 unit tests) and concludes the "duplicates" were distinct rows from failed-Recraft retries, not a happy-path insert bug; **live clean-Compare confirmation left to a human** (cloud has no image-gen keys). White-fill is a standalone followup (luminance knockout), no longer tied to Recraft (Replicate's recraft-v3 has no vector output; Recraft is style variety).

**History (pre-merge, branch `feat/multi-generator`)**

- **Thin-prompt 500 fixed (committed `261f5d8`).** When the user hits Generate/Compare on an underspecified design, Claude returns a clarifying question with an empty `fluxPrompt`; both `generateDesign` and `compareGenerators` used to pass that empty string to the image model → Ideogram 400 → 500. Now guarded (`isClarificationOnly`/`persistClarification` in `design/actions.ts`): saves the question to chat, returns no image, no cost. `compareGenerators` now returns `{ message, images }` (was a bare array). Verified working locally (got a real Ideogram render after answering the style question).
- **Generate-readiness gate — spec'd, NOT implemented (committed `37277b2`).** Soft-nudge UI: grey out Generate + Compare until Claude judges the idea concrete (subject AND style), driven by a Claude-emitted `readyToGenerate` flag on chat replies; still clickable (override preserved). Initial ready = `images.length > 0`. Spec: `docs/superpowers/specs/2026-06-04-generate-readiness-gate-design.md`. Next step: writing-plans → implement.
- **Recraft 422 fixed + white-fill verdict settled (committed `1463e70`, 2026-06-05 smoke).** Compare was crashing Recraft with a 422: Replicate's `recraft-ai/recraft-v3` has **no `vector_illustration` style** in its enum. Switched to `digital_illustration`. Verified: Compare now returns a real Recraft image alongside Ideogram. **Verdict on the original merge gate:** since this Replicate model can't do true vector (raster + BiRefNet, same shape as Ideogram), **Recraft is style-variety, not a white-fill fix.** If interior white-fill matters, the only lever is the deferred **luminance white-knockout** (sealed in the Recraft adapter) — independent of generator. So the merge gate is no longer "eyeball a shirt"; it's a framing decision (ship Recraft as style variety + treat white-fill as its own followup).
- **Merge cleanup — #19 (PR #23 open):** Compare showed **duplicate Ideogram images** + an ungrammatical "Compared 1 generators" summary. Root cause: each repeated Compare while Recraft 422'd persisted its Ideogram render → distinct rows piling up (not a duplicate-insert bug). PR #23 fixes the summary (pure `compareSummary`, names failed styles, "styles" wording) and adds a `dedupeById` gallery guard; live clean-Compare confirmation pending a human with keys. See `compareGenerators`/`getDesignGallery` in `design/actions.ts`, `src/lib/compare.ts`.
- **Merge readiness:** lint 0-err, 227 tests pass, build not re-run since the fix. Plan was smoke → build → PR → merge; got through smoke + fix + push. Remaining to merge: fix #19, `npm run build`, open PR.

**Recently shipped — 2026-06-03**

- **Reversible un-publish (shipped to prod).** Owners can take a published image back down (`unpublishImage` clears `published_at`) and re-publish later, from `/d/[imageId]` or `/designs`. Deletion lock re-keyed off "is published" onto "is referenced by an order" (`imageReferencedByOrders` in `design-publish.ts`) so an ordered image can't be deleted after un-publish. Spec `docs/unpublish-image.md`.
- **`/designs` mobile layout fix (shipped to prod).** Card action buttons wrap onto their own row instead of overflowing on narrow phones (the ordered cards' Reorder+Archive overflowed even ~390px); responsive header.
- **Image-gen strategy resync + multi-generator feature (on branch `feat/multi-generator`, NOT merged).** Per-design pluggable image generator behind an adapter interface (`src/lib/generators/`): Ideogram (default) + Recraft-via-Replicate (official model `recraft-ai/recraft-v3`, reuses `REPLICATE_API_TOKEN` — no Recraft account). Default single-model Generate + opt-in **Compare** (runs both, tagged), **adopt** sets the design's `active_generator_id`. New nullable cols `design_image.generator` + `design.active_generator_id` (pushed). Per-adapter cost tracking. Spec/plan/checklist: `docs/image-gen-multi-generator*.md`. **Open question that gates merge:** does Recraft's vector output actually fix the white-fill-on-colored-shirt bug, or does it need the deferred luminance white-knockout? Needs local smoke test. **Blocker for local testing: stale local `IDEOGRAM_API_KEY` (401)** — refresh from ideogram.ai (prod's is 30d, presumed fine). Also stale this session: Anthropic + Replicate (fixed local+prod). See `docs/multi-generator-test-checklist.md`.

**Recently shipped — 2026-05-30/31**

- **Per-design storefront backdrop color + publish modal (#16, closed)**. Published designs (transparent PNGs) can now carry a backdrop drawn from the Printful palette: new nullable `design_image.background_color` (stores a Classic Tee color name; null = checkerboard), `BACKGROUND_PALETTE` + `publishedBackdrop()` in `products.ts`, applied on `/d/[id]` and every `PublishedGrid` card. Set two ways: (1) **publish modal** — Publish (from `/design` lightbox or `/designs`) opens a modal for name/description/backdrop, then publishes + routes to `/d/[id]`; `publishImage(imageId, opts)` takes optional overrides and only auto-generates blank fields. (2) **on-page picker** — `PublishedImageView` shows an always-visible owner swatch row under the image (live optimistic update). `updatePublishedNaming` is now a partial update. Buy panel pre-selects the pinned color. Commits `9166cae`, `58d33e2`. **Schema pushed to prod.** Followup: optionally pre-fill Claude's name/description suggestion in the modal (currently blank-with-placeholder to avoid an API call per open).
- **Hierarchical breadcrumb + Escape-to-go-up nav (resolves `docs/funnel-back-nav.md`)**. One source of truth — pure `breadcrumbTrail()`/`upTarget()` in `src/lib/nav.ts` (12 tests) — drives `<Breadcrumbs>`: mobile single `← Parent` back chip, desktop full trail. Escape now navigates UP one level (deterministic `router.push`), replacing the removed history-based global `EscBack`. Overlays (modal/lightbox/drawer) `preventDefault` on Escape so close-overlay wins. Wired across funnel + detail + admin detail; `/d` parent from `?from`; confirm → `/orders`; top-level hubs rely on `SiteHeader`. Commit `9166cae`.

**Recently shipped — 2026-05-29/30**

- **Promo banner liveness (#13, closed)**. Homepage promo banner is now config-driven from `src/lib/promotion.ts`: `ACTIVE_PROMO` single-source (set to `null` → no banner, the live MothersDay banner is removed for now), `checkPromoLive()` looks up the Stripe promotion code and fails closed, `getActivePromo()` caches the result 5 min. Banner renders only when the advertised code is still redeemable, preventing a repeat of the May 4 dead-code incident. 6 tests in `promotion.test.ts`. Relaunch a campaign by setting `ACTIVE_PROMO = { code, blurb }`. Commit `bc44a1e`.
- **Replicate timeout (#15, closed)**. `replicate.run` polls until a prediction settles and could hang forever; added a 120s `withTimeout` around both Replicate calls in `src/lib/replicate.ts`, and `/preview` now actually displays the render-error state (it was set but never rendered) with a Try-again retry. Commit `bc44a1e`.
- **#2 confirmed fixed (closed)**. Clicking an ordered design loads its `/design` thread — no `/orders` bounce remains anywhere. Resolved earlier by the data-model rework; verified and closed 2026-05-29.
- **Drive-by contributor on #13**. A non-collaborator (`MrBlue-1996`) commented a patch plan matching the issue; implemented directly, replied, closed. No external PR taken (payments-adjacent surface).

**Recently shipped — 2026-05-28 (evening)**

- **Two-flow UX direction + feedback widget**. Wrote `docs/ux-two-flow-model.md` — the artifact for the homepage/mobile rework with Manine (product designer). Core split: buy-existing (open, no account) vs design-your-own (account-gated); published designs are the storefront and should lead. Embedded the ibuild4you feedback widget globally (`src/components/feedback-{widget,launcher}.tsx` + `src/lib/feedback/payload.ts`), rendered from `layout.tsx`, posting to the `prntd-mobile-flow-rethink` slug (override via `NEXT_PUBLIC_FEEDBACK_PROJECT_ID`). Filed #16 (publish modal: name/description/bg-color, replacing auto-publish), #17 (in-product marketing + social proof, for Manine), #18 (landing rework: lead with published designs, drop How-it-works for returning users).

**Recently shipped — 2026-05-28 (morning)**

- **Publish-flow polish**. Dark designs were lost against `bg-surface` on the discover grid, `/d/[imageId]`, and `/admin/published` — all three now use `bg-checkerboard`. Added owner-only inline title/description editor on `/d/[imageId]` (`EditableNaming` client component) using `updatePublishedNaming`, which now revalidates `/` and `/d/[imageId]` so the edit shows up immediately.

**Recently shipped — 2026-05-27 (evening)**

- **Phase 4 admin moderation + full attribution chain**. `/admin/published` grid (last 100) with `setImageHidden` toggle that revalidates `/`, `/d/[imageId]`, and `/admin/published`. `PublishedImage.forkChain` replaces single-hop `forkedFrom` — `buildForkChain` walks `forked_from_image_id` upward, stops at first invisible link, breaks on cycles, capped at depth 10. Pure helper with 8 unit tests.
- **Publish + Fork buttons on `/designs` cards**. Both delegate to existing `publishImage` / `forkImage` actions. Fork is the Phase 5 self-fork affordance (canFork's owner shortcut handles it).
- **Orders page tab counts**. Active and All now show counts alongside Canceled.
- **CI build fix**. Homepage `getDiscoverFeed` was being prerendered against an empty CI sqlite → `export const dynamic = "force-dynamic"`.
- **Disaster recovery**. `design` + `design_image` tables were wiped at some point before today's session (cause unknown — possibly a destructive `db:push`). 51 orders survived along with R2. `scripts/recover-designs-from-r2.ts` rebuilt 27 design rows + their `design_image` rows by listing R2 keys; lossy (no prompts, no chat history, no publish state, aspect ratio defaults to 1:1). Recovered designs show up in `/designs` and `/orders` again. Consider enabling Turso PITR or branches to avoid relying on R2 next time.

**Recently shipped — 2026-05-27 (morning)**

- **Image-level publish + fork model** (Phases 0–3). `design_image` owns `published_at` (one-way lock, undeletable once published), `is_hidden` (admin moderation), `title`, `description` (AI-generated via `generatePublishedNaming`, owner-editable via `updatePublishedNaming`). Landing-page "Recent designs" grid pulls from `getDiscoverFeed`. Public `/d/[imageId]` page shows image + title + description + designer + "Forked from …" attribution. `forkImage()` copies the seed R2 object into a new design under the forker (each design owns its own R2 keys), records `forked_from_image_id` + denormalized `original_designer_id`. `canFork` helper unit-tested (self-fork bypasses hidden; non-owners need published + not hidden). Sign-in honors `?next=`.

**Recently shipped — 2026-05-05/06**

- **Data model rework Steps 0–5b**: `design.primary_image_id` is now the source of truth, `currentImageUrl` column dropped from Turso. `/preview` is a pure function of (designId, productId), placement renders live in `design_image` rows with provenance, mockup cache resolves via primary. Plan: `~/.claude/plans/i-want-you-to-concurrent-fountain.md`.
- **Chat history → append-only `chat_message` table**: `design.chat_history` JSON column dropped. Writers append rows; chat panel + AI context source from `chat_message` + `design_image`. `imageUrl` duplication eliminated. Migration backfilled 408 messages across 46 designs. Doc: `docs/chat-message-log.md`.
- **Design loop rethink Phases 0/1/4** shipped (Ideogram native-transparent, advisor negation rewriting, doc updates). Phase 2 (text-as-layer) and Phase 3 (structured brief + batch-of-3) still queued.
- **Bulk Printful prefetch** on accept and on `/preview` revisit. **deleteDesign** + **deleteDesignImage** order-pin protection. **bella-canvas-3001** expanded 13 → 25 colors. Product catalog process documented in `docs/products.md`.

**Pricing + checkout — backlog**

- **Per-size pricing accuracy** — entries use flat `baseCost: { "*": 12.95 }`. Real Printful pricing is per-size: $11.69 S–XL, $13.69 2XL, $15.69 3XL, $17.69 4XL, $19.69 5XL on 3001. Acceptable today; revisit if margins tighten or 3XL+ sizes get exposed.
- **Multi-item shipping savings** — Printful charges less for the 2nd+ tee in one shipment. Single-item orders only today. Shapes pricing logic, not just UI. Part of #11 scope.
- **Tax** — Printful collects fulfillment sales tax; nothing baked into Stripe checkout. Part of #11 scope.
- **#11 Printful + checkout deep-dive** (multi-placement, tax, shipping, team orders, safe-area UX) — umbrella ticket; blocks Phase 4 multi-placement UI.

**Image-gen style versatility (followup to #8)**

- Default-color rule (auto-pick colors that read on light + dark shirts) — **rejected by Nico 2026-05-28, do not pursue.**
- Still open: build the style-reference image library (#8 follow-up).

**Buy-existing path (#6) — core shipped, account-gated**

The buy-direct half of the two-flow model: a logged-in user buys a published design from `/d/[imageId]` without designing one. **Decision: account-gated, not guest checkout** — orders tie to an account (trackable in `/orders`). Auth check / `userId` resolution is isolated in `buyPublishedDesign` so a future guest swap is a few lines.

- Phases 0–3 ✅ shipped (2026-05-30, commits `3f97308`, `682e182`, `1f877a1`):
  - Phase 0: webhook prints `order.placements.front` (the pinned image) over the design display image; survives post-purchase regeneration. Optional `resolveImageUrlById` dep in `handleStripeCheckoutCompleted`.
  - Phase 1: `buyPublishedDesign({imageId,productId,size,color})` in `src/app/d/actions.ts` — auth-gated, `canBuyPublishedImage` guard (published && !hidden, no owner shortcut), order `designId` = image's source design, `placements.front = imageId`, `userId` = buyer, price `computePrice(0,…)`. Shared `createStripeCheckoutForOrder` + pure `buildCheckoutSessionParams` (`src/lib/checkout.ts`) extracted so both purchase flows share one choke point.
  - Phase 2: `BuyPanel` (`src/app/d/[imageId]/buy-panel.tsx`) — product/size/color, client-side price, "Buy this design" primary CTA, signed-out → "Sign in to buy" `?next=`; fork demoted to secondary. Shared `SizePicker`/`ColorPicker` in `src/components/product-options.tsx` (order page reuses them).
  - Phase 3: reuses `/order/confirm` (session-keyed) + `/orders` (buyer-scoped). No code needed.
- Also shipped: `resolveOrderVariant` validates product/size/color → variant at the checkout choke point (rejects unfulfillable orders before charging); "Designed by X" attribution on `/orders` + admin detail via pure `designerAttribution` (shows only when designer != buyer).
- **E2E verified ✅ (2026-05-30, local + Stripe test mode).** Cross-owner buy ran whole: buy → correct Stripe session (Black/L/$19.43) → webhook 200 → dry-run Printful variant 4018 → status `pending→submitted` → lands in buyer's `/orders` with "Designed by Nicholas Lovejoy". `generateOrderName` 401'd (stale local key) but the handler degraded gracefully. Checklist: `docs/buy-existing-e2e-checklist.md`.
- **Remaining:**
  - **Cross-owner edge — confirmed in effect:** the test buy flipped the *seller's* `design.status` to `ordered` (webhook updates `order.designId`, which on a buy is the seller's design). Decide whether to scope the flip to self-designed orders.
  - Followups (need product decision): designer royalty/credit, guest checkout, multi-placement.
- **Test cleanup left in prod data:** throwaway buyer `buyer-test-0530@example.com` + one `test`-classified order; design `b7315b39…` shows `ordered` from the test buy (revert if desired).
- **Test-orders + accounting hardening — proposal in `docs/test-orders-and-accounting.md`** (set 2026-05-30): auto-classify Stripe test-mode orders as `test` (add `livemode` to the webhook payload), skip ledger writes for test orders, default-exclude `test` from `getFinancialSummary` (today it includes everything unless filtered), badge test orders in `/orders` + `/admin`. Plus a one-off cleanup of order `2ade8478`'s `sale`/`cogs` ledger rows.

**Design fork model — followups**

- Phase 4 admin moderation + multi-hop attribution chain — shipped 2026-05-27 evening (see Recently shipped).
- Phase 5 self-fork on `/designs` — shipped same day via the Fork button on each card.
- Open: nothing concrete. Possible nice-to-haves: bulk-hide selection on `/admin/published`; "Show hidden in chain" admin toggle for debugging.

**Discount codes (remaining)**

- Show discount info on admin order detail and /orders.
- Charge shipping as a separate Stripe line so percentage promos don't eat margin to zero (currently shipping is baked into COGS; 50% off launches at structural loss).

**Print targets — see `docs/print-targets.md` + `docs/print-targets-plan.md`**

- Phase 3 (placement-aware regeneration, removal of `currentImageUrl`) effectively folded into the data model rework above. Phase 4 (multi-placement UI) blocked on #11.
- #12 Image export facility — independent, slot anywhere.

**Design loop rethink — remaining phases**

- Phase 2 (text-as-layer) — heaviest phase, ~1 week. Plan: `docs/phase-2-text-as-layer-plan.md`. Schema + font catalog + `composeWithText` (`@vercel/og` + `sharp`) + UI panel.
- Phase 3 (structured brief + batch-of-3) — after Phase 2. Plan: `~/.claude/plans/feedback-for-the-coding-woolly-snowflake.md`.

**Mobile flow rethink** — Design→preview→order too fragmented on phones. Now in motion: ibuild4you brief sent to Manine (product designer), framed by `docs/ux-two-flow-model.md`; homepage rework tracked in #18. Adjacent: `docs/funnel-back-nav.md`.

**Homepage + nav rework (#18) — SHIPPED 2026-05-30** (plan was `docs/homepage-nav-rework.md`; commits `bb4a194`, `f5e635d`, `d4f3c35`):
- **Part A:** homepage reads session server-side, leads with the community feed, hides "How it works" when logged in; own-designs grid removed from `HomeHero`.
- **Part B:** storefront named **"Fresh Prints"** (see memory `project_two_flow_nav.md`). New global nav `Fresh Prints | New Design | My Designs | Orders | Sign out` (hamburger on mobile, phone-first). New `/prints` page. Homepage feed → 12-card teaser via shared `PublishedGrid` + "See all" link. `getDiscoverFeed` deduped to one card per design (pure `dedupeFeedByDesign`, 5 tests); `PublishedImage.isOwn` → "by you". **Fork removed entirely** (UI + `forkImage` action + `canFork`); `buildForkChain` kept for historical "Forked from" attribution. Duplicate inner header on `/d/[imageId]` removed.
- **Remaining followups (small):** `copyDesignImageByUrl` in `r2.ts` is now dead (left as reusable helper — delete if you want). Part B doc's deeper IA open questions (long-term home for own-published; storefront depth) mostly resolved; doc could be updated to reflect shipped state.

**1Password secret migration (paused 2026-04-14)** — see memory `project_anthropic_key_rotation.md`

### Ongoing / low priority

- hledger export script (docs/accounting.md has the architecture)
- Drag-and-drop image upload not working on some browsers — file picker works
- Rate limiting / generation caps
- Next.js 16 middleware → proxy migration
- Backfill `display_name` for historical orders
