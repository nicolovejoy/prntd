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
npm run db:push      # Dev-only fast schema sync to the .env.local DB (prntd-dev branch). NOT for prod/preview — those use db:migrate (versioned migrations, see Migration discipline below)
npm run db:generate  # Author a new versioned migration from schema.ts changes → drizzle/000N_*.sql
npm run db:migrate   # Apply pending migrations (defaults to dev; prod/preview via inline creds — see Migration discipline)
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

**Organizer pivot — IN PROGRESS (branch `docs/organizer-pivot`).** Plan: `docs/organizer-pivot-plan.md`; memory `project_positioning_organizer`. Object model: store → product (design × blank × placements) → blank (renamed from `product`).
- **Phase 0 (tappable chat options) — SHIPPED on branch 2026-06-18** (`22404aa`). Chat envelope carries structured `options`; UI renders ≥44px QuickReply chips that submit `value` as the turn; composer relaid out phone-first. Kills the "type a number" bug. Live-verified desktop + Pixel-7. Prompts emit one question per turn, no numbered prose. (Send/Draw-it merge deferred to the persona call.)
- **Phase 0.5 (rename `product`→`blank`) + Phase 1 (store/product/product_offering schema) — DONE** (`2756b17`, `391466b`; migration `0001`, 26 integration tests, `onLinkAccount` re-parents store+product, `validateProduct`/`technique`/`dpi` in `blanks.ts`).
- **Phase 2 slice 1 (organizer dashboard) — SHIPPED on branch 2026-06-18** (`c39b3f6`), behind `STORES_ENABLED` (default off). `/dashboard` create-shop + Copy-link + Publish toggle; `store-service.ts` DB layer (+13 integration tests) already exposes `createProduct`/`addProductToStore`/`reorderProducts`; Dashboard nav link behind the flag.
- **Next:** Phase 2 slice 2 (product-compose UI: design × blank × placement × price, live validity warn+fix, reuse `/preview` mockups), store edit (slug/accent), Playwright spec. Then **Phase 3** = `/shop/[slug]` storefront (the Copy-link destination — currently 404s until built). Phase 4 = persona/copy with Manine. Branch not yet merged/pushed-to-prod; no prod migrate until a UI phase flips the flag.

**Migration discipline — DONE 2026-06-13.** prntd now uses versioned Drizzle migrations. `drizzle/0000_baseline.sql` is the genesis snapshot (12 tables, generated from `schema.ts`). All three Turso branches (`prntd`, `prntd-preview`, `prntd-dev`) were proven zero-drift vs `schema.ts` (`drizzle-kit push --verbose --strict` → "No changes detected") and marked `0000` already-applied via a single `__drizzle_migrations` ledger row (hash `229592c2…`, created_at `1781399528066` = the journal `when`; the libSQL migrator's skip test compares `created_at` ≥ that `when`, not the hash). `migrate` verified no-op on all three. No DDL ran on any real table. Backup branch `prntd-backup-20260613` retained as rollback.

  **Schema-change flow now:** edit `schema.ts` → `npm run db:generate` (writes `drizzle/000N_*.sql`) → review the SQL in PR → merge → run `db:migrate` against the target. `db:migrate` (= `drizzle-kit migrate`) defaults to the `.env.local` (dev) branch. Prod/preview are targeted by injecting creds inline (no `.env` toggle, no 1P item needed — turso CLI mints the token):
  - **prod:** `DATABASE_URL=libsql://prntd-nicolovejoy.aws-us-west-2.turso.io DATABASE_AUTH_TOKEN=$(turso db tokens create prntd) npm run db:migrate`
  - **preview:** same with `prntd-preview`.
  Before any real prod migrate: `turso db create prntd-backup-<date> --from-db prntd` (rollback). Prod migrate stays manual (byside parity, not fire-on-merge). Dev keeps `db:push` for fast iteration (B2) — but `db:generate` before merge so the migration chain stays current. Plan/rationale: `docs/migration-adoption-plan.md`, `docs/cicd-roadmap.md` §"Migration discipline".

  **Smoke test:** `scripts/migration-smoke.ts before|after` snapshots row counts around a migration and fails on dropped tables / lost rows (read-only, safe on any target incl. prod). **CI preview auto-apply (Option C) — done:** the e2e job runs `db:migrate` against `prntd-preview` (existing `PREVIEW_DATABASE_*` secrets) before Playwright, so schema-changing PRs keep the shared preview DB current (additive-only until per-PR branches, #31). **Deferred:** the `DB_TARGET` op-resolver + ops-script refactor (the inline-token one-liner made it unnecessary for migrate).

**Design system + UX rethink — IN REVIEW (PR #34, branch `docs/design-system`). Manine reviewed 2026-06-14.**

First draft of `docs/design-system.md` proposes ink/paper design language, shared vocabulary (Studio/Storefront/Stage/Rail/Sheet), per-page component inventory, and 8 named gaps.

**Manine's review (9 inline comments, 2026-06-14):** her central point — *the product has no persona*; she can't review tone/copy until "who is Fresh Prints" is decided. She framed it by analogy (hip 30-yr-old maker / curated boutique / "Sharper Image of 2-D"). Also: (a) homepage should do different things for recognized vs unrecognized users in different states; (b) the clarify-style-after-text flow frustrates her as a real user — she wants style options shown **up front**, ideally all at once, so the question never gets asked; (c) doc is too abstract/text-only to map to UX.

**Correction:** Manine is **NOT a designer** (Nico, 2026-06-14) — she brings product/brand wisdom in words/analogies; the visual/reference/moodboard half is Claude's job. See memory `reference-manine`.

**Persona plan (agreed 2026-06-14):** persona is upstream of the doc → resolve it first, then rewrite the doc concretely, then Manine re-reviews. Engagement designed to be *good for her*: a ~30-min phone look-together at the live site (her own suggestion), reaction/analogy prompts not a blank brief, Claude captures + translates so she does zero homework. Nico emailed her to schedule. **Blocked until that call** — don't pick rethink targets that depend on identity/copy.

**Mechanical design-system fixes — DONE 2026-06-14 (commit `cbedcbe`, on main).** Persona-independent, so shipped ahead of the call: (1) Geist font restored (globals.css body hard-coded Arial, defeating the loaded font → now `var(--font-geist-sans)`); (2) 40 raw `gray-*` classes swept to semantic tokens across 12 files (the auth-page `gray-600` helper text was a real dark-bg contrast bug; left `bg-gray-900` — intentional dark preview backdrop); (3) 4 undefined tokens rendering as no-ops fixed (`text-text-primary`/`text-text-base`→`foreground`, `border-border-default`→`border`, `bg-surface-base`→`surface`). Still open in the doc's gap list: 11-hue badge palette, composer's three equal-weight buttons, near-invisible selected-image state (these touch identity/UX → after the call).

**Phase 1 — public-facing readiness (on hold)**

- DESC/charity work paused as of 2026-05-06. Chain (DESC permission → entity confirmation → #4 ledger infra → first disbursement → homepage re-org) still applies if/when it restarts. (Homepage re-org now tracked under #18/#17; old #5 closed as superseded 2026-05-29.)
- #10 ~~Order list thumbnails on shirt color~~ — shipped May 1. iPhone case was discontinued 2026-05-26 (soft-discontinue: `discontinued: true` on `clear-case-iphone`, picker uses `ACTIVE_PRODUCTS`; historical orders still resolve via `getProduct()`).

**Readiness gate + fast thin-check — MERGED + DEPLOYED to prod (2026-06-05, PR #21, merge `cb8b0a5`)**

`feat/readiness-gate` is live on prntd.org. Two things shipped: (1) **Generate-readiness gate** — `chatAboutDesign` returns `{message, readyToGenerate}` (JSON envelope, subject+style rubric, safe-parse fallback); Generate renders as a secondary button that pops to primary when ready, plus a style hint (always clickable, never greyed-into-broken). (2) **Fast `assessReadiness` thin-check** (`src/lib/ai.ts`, Haiku `claude-haiku-4-5-20251001`, ~1s): Generate/Compare bail to a clarifying question in ~1s instead of the ~6s Sonnet builder; **fails open** on any error (constructFluxPrompt's guard is the backstop). 238 tests/lint/build green. Kept as a SOFT nudge (not hard-gate) to protect the type-a-full-idea-and-Generate path.

**/design empty-state redesign — MERGED + DEPLOYED to prod (2026-06-05, PR #22, merge `68c0382`)**

Spec `docs/superpowers/specs/2026-06-05-design-empty-state-redesign.md`. **Layout A centered composer** shipped: empty state shows only the hero composer (no Generations column / no Generate/Compare until there's content), `isDesignEmpty(messageCount, imageCount)` in `src/lib/design-view.ts` drives the split, example chips revealed after **8s of inactivity** (eased up from the spec's 4s), submit = Send (chat-first), first message → two-column working view, generating copy "Drawing your design…". Buttons relabeled **"Draw it" / "Compare styles"**. Also landed on the branch:

- **Delete-design serverless fix.** `deleteDesign` (`designs/actions.ts`) failed on two counts: `db.transaction` (libSQL interactive tx unsupported over serverless HTTP) and never clearing `chat_message` rows (FK to `design.id`, no cascade) → masked 500 on any chatted-in draft. Now one `db.batch([chat_message, design_image, design])`; `/designs` surfaces the error instead of failing silently.
- **Same-origin auth (CORS fix for previews).** `auth-client.ts` no longer hardcodes `baseURL`; `auth.ts` adds `trustedOrigins` for `*.vercel.app` / `*.prntd.org`, so preview deploys sign in without CORS. **Caveat:** Stripe checkout redirect + password-reset URLs still build from `NEXT_PUBLIC_APP_URL` (= prod), so checkout on a *preview* bounces to prod — separate fix if needed (derive from request origin).

**OPEN followup — `/design` actions 500 on Vercel Preview (env, not code).** All `src/app/design/actions.ts` actions 500 on the preview while `designs/actions.ts` (delete) works. Confirmed env-not-code via local smoke 2026-06-06 (`npm run dev` with good `.env` → every action works, real Ideogram + Recraft renders; prod unaffected). Resolution (not yet applied): refresh `ANTHROPIC_API_KEY` / `REPLICATE_API_TOKEN` / `IDEOGRAM_API_KEY` in Vercel's **Preview** env scope. (Notes were PR #24, since closed — content folded here.)

**Multi-generator — MERGED + DEPLOYED to prod (2026-06-05, PR #20, merge `6e23d6e`)**

The `feat/multi-generator` branch is merged to main and live on prntd.org. Compare smoke-verified (real Ideogram + Recraft renders), prod Turso has both new columns (`scripts/check-multi-generator-schema.ts`). Remaining open: **#19** (Compare can add duplicate Ideogram images — opt-in, non-destructive, fast-follow). White-fill is a standalone followup (luminance knockout), no longer tied to Recraft (Replicate's recraft-v3 has no vector output; Recraft is style variety).

**History (pre-merge, branch `feat/multi-generator`)**

- **Thin-prompt 500 fixed (committed `261f5d8`).** When the user hits Generate/Compare on an underspecified design, Claude returns a clarifying question with an empty `fluxPrompt`; both `generateDesign` and `compareGenerators` used to pass that empty string to the image model → Ideogram 400 → 500. Now guarded (`isClarificationOnly`/`persistClarification` in `design/actions.ts`): saves the question to chat, returns no image, no cost. `compareGenerators` now returns `{ message, images }` (was a bare array). Verified working locally (got a real Ideogram render after answering the style question).
- **Generate-readiness gate — spec'd, NOT implemented (committed `37277b2`).** Soft-nudge UI: grey out Generate + Compare until Claude judges the idea concrete (subject AND style), driven by a Claude-emitted `readyToGenerate` flag on chat replies; still clickable (override preserved). Initial ready = `images.length > 0`. Spec: `docs/superpowers/specs/2026-06-04-generate-readiness-gate-design.md`. Next step: writing-plans → implement.
- **Recraft 422 fixed + white-fill verdict settled (committed `1463e70`, 2026-06-05 smoke).** Compare was crashing Recraft with a 422: Replicate's `recraft-ai/recraft-v3` has **no `vector_illustration` style** in its enum. Switched to `digital_illustration`. Verified: Compare now returns a real Recraft image alongside Ideogram. **Verdict on the original merge gate:** since this Replicate model can't do true vector (raster + BiRefNet, same shape as Ideogram), **Recraft is style-variety, not a white-fill fix.** If interior white-fill matters, the only lever is the deferred **luminance white-knockout** (sealed in the Recraft adapter) — independent of generator. So the merge gate is no longer "eyeball a shirt"; it's a framing decision (ship Recraft as style variety + treat white-fill as its own followup).
- **Merge cleanup blocker — #19:** Compare adds **duplicate Ideogram images** to the gallery (saw 4 copies of one render). Suspected artifact of the failed-Recraft retries persisting the Ideogram image each time; confirm on a clean Compare. See `compareGenerators`/`getDesignGallery` in `design/actions.ts`. Worth fixing before merge.
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

**Pricing + checkout — phased plan (2026-06-06)**

Three sequenced phases, full plans in `docs/`. Build order **#11 → #25 → #26**, each reusing the prior's shape. Decisions locked with Nico 2026-06-06.

- **Phase 1 — checkout & pricing foundation (#11).** Plan: `docs/phase-1-checkout-pricing-plan.md`. Key reframe: **COGS already comes from Printful's real invoice (`printfulOrder.costs.total`), never from `baseCost`** — so per-size pricing is purely a revenue question.
  - **1A per-size pricing — SHIPPED 2026-06-06.** 3001 `baseCost` → true per-size cost; optional `Product.retailPrice` override. Flat floor + 2XL upcharge: S–XL $19.43, 2XL $21.43. Open knob: 2XL is cost-delta passthrough (+$2.00); marked-up alt = $22.43.
  - **Schema price-split columns — SHIPPED to prod Turso 2026-06-06.** Additive nullable `order.itemPrice`/`shippingPrice`/`taxCollected`, no backfill. Verify: `scripts/check-price-split-schema.ts`.
  - **1B shipping split — SHIPPED + smoke-verified 2026-06-06** (commit `526de03`). Decision refined: hosted Stripe Checkout can't recompute shipping after address entry, so a live per-destination quote isn't possible in this flow. Split the concerns: **(a) margin fix** = shipping is a separate Stripe `shipping_options` line (% promos skip it) — done; **(b) amount** = flat `FLAT_SHIPPING_USD=4.69` via `estimateShipping(itemCount)` (N-item-ready), **live Printful `/orders/estimate-costs` deferred to #26**. `computeOrderTotal()` is the shared breakdown for `/order` + buy-panel + checkout choke point; webhook reconciles `itemPrice`/`shippingPrice` from Stripe `amount_subtotal`/`amount_shipping`. (Smoke test left two `test`-classified orders in prod: `ed6163ef`, `b034fa79`.)
  - **1C tax — DONE 2026-06-07.** No customer tax; Stripe `automatic_tax` stays off; Printful tax stays in COGS; `taxCollected` reserved (null). Pure `summarizeLedger` (`ledger.ts`) keeps any non sale/refund/stripe_fee/cogs type (e.g. a future `tax`) out of `grossProfit`, test-locked. Policy: `docs/tax-policy.md`.
  - **1D multi-item — DONE 2026-06-07 (model-only).** Pricing already N-item-shaped; test locks "shipping once per order, not per item" (#26 contract); single-item submission spots flagged in `checkout.ts`/`printful.ts`. Full cart = **#26**, where the live Printful shipping quote also lands.
  - **#11 CLOSED 2026-06-07** (1A/1B/1C/1D shipped).
  - **Verify live once (optional):** promo-skips-shipping on the real Stripe page (a % code should discount only the $19.43 product, not the $4.69 shipping). Covered by unit test + Stripe's contract; eyes-on not yet done.
- **Phase 2 — back-of-shirt printing / multi-placement (#25) — SHIPPED + LIVE 2026-06-08.** Whole flow built, verified live (Playwright UI smoke + dry-run order: `placements.back`, $27.43/$4.69 split, webhook 200, sale/fee ledger), and `MULTI_PLACEMENT_ENABLED` flipped **on** in prod (2.5 done). Customers can add a back design (+$8) end-to-end; prod fulfills for real (no dry-run). Plan: `docs/phase-2-back-printing-plan.md`. `order.placements` already `Record<string,string>` → **zero DB migration**; runtime plumbing only. **Locked 2026-06-07:** not COGS-blocked on #11 (COGS comes from Printful's invoice; back upcharge is purely a pricing decision); back image **reused from the same design thread**; **opt-in** "Add a back design" on `/preview` (front stays required); upcharge rides the **product (discountable) Stripe line**, `BACK_PLACEMENT_COST` set from Printful's additional-placement fee (deferred to 2.3); mockups lazy/back-on-demand. Build behind `MULTI_PLACEMENT_ENABLED` (default off).
  - **2.0 SHIPPED 2026-06-07.** `back` placement on all three shirts (3001/6400/mc1087, geometry verified per-product via Printful `available_placements`), helpers `getPlacement`/`getOptionalPlacements`/`productSupportsPlacement` + `multiPlacementEnabled()` kill-switch. Live-validated: `scripts/test-back-mockup.ts`.
  - **2.1 SHIPPED 2026-06-07** (`035422f`). `getOrCreatePlacementRender(designId, productId, placementId="front", sourceImageId?)` + `generateMockup(...,placementId="front")` are placement-aware; mockup cache key + R2 mockup key gained placement (front keeps legacy keys; non-front suffixed). prefetch stays front-only.
  - **2.2 SHIPPED 2026-06-07** (`ce5a839`). `createOrder` takes `files: {placement,url}[]` (`designImageUrl` kept as front alias); placement→order-file `type` map front→`"default"`, back→`"back"` (**verified against the live Orders API — order files key on `type`, not the mockup API's `placement`**). Webhook resolves every key in `order.placements`: front prefers pin + falls back to display image; non-front best-effort (missing back logged + dropped, never fails the order).
  - **2.3 SHIPPED 2026-06-07** (`a1101f7`). `computePrice(...,{back})` adds `BACK_PLACEMENT_UPCHARGE=$8` to the discountable product line. Back COGS measured **$5.95 flat across all three shirts** via `scripts/estimate-back-cost.ts` (`/orders/estimate-costs` front vs front+back subtotal delta; total delta $6.38 folds in variable tax).
  - **2.4a SHIPPED 2026-06-07** (`166a36f`). Server plumbing behind the flag: `isMultiPlacementEnabled()` action; `createCheckoutSession` takes optional `back` source-id, honored only when flag on (builds `placements{front,back}`, prices `{back:true}`, carries `back` in cancel URL); `createStripeCheckoutForOrder.placements` widened to `Record<string,string>`. Inert in prod.
  - **2.4b + 2.5 SHIPPED 2026-06-08** (`3efb31a`). `/preview` Front/Back toggle on the hero + back-source picker (`getDesignGallery().sources`), placement-aware state (`mockups{front,back}`, `activePlacement`, `backImageId`); `/order` reads `?back=`, gates on `isMultiPlacementEnabled()`, shows `Back design +$8.00`; front+back integration test in `money-path.integration.test.ts` (two files + +$8 sale). Verified live via Playwright (dry-run order `ec857fa2`); flag flipped on in prod. Same machinery later delivers #17 (`label_inside`).
  - **Verify on prod (open):** eyeball the `/preview` Front/Back toggle on prntd.org logged-in to confirm the flag took on the live deploy. First real prod two-sided order = a real shirt (prod is not dry-run).
**Email rebrand + product mockups — SHIPPED 2026-06-08** (`db39199`). Shared `emailLayout` (dark PRNTD header / white card / footer) replaces the four hand-rolled templates. All three product emails (order confirmation, owner alert, shipping) lead with the shirt **mockup** — cached Printful render from /preview, falling back to design-artwork-on-shirt-color (`getColorHex`). **Front+back iff ordered both**: pure `resolveOrderEmailImages` (`src/lib/email-images.ts`, 9 tests, scale-agnostic cache match) + shared `resolveHeroImages` (`order-emails.ts`, lazy-imports design-images to stay DB-free for tests) feeds both the confirmation/owner path and the Printful shipping webhook. Preview tool: `RESEND_API_KEY=re_dummy npx tsx scripts/preview-email.ts` → `/tmp/email-preview.html`.

- **Phase 3 — multi-item cart + guest funnel (#26) — SHIPPED + LIVE on prod 2026-06-09 (PR #30 merged; `GUEST_FUNNEL_ENABLED` + `CART_ENABLED` on in Production; #26 closed).** Two stages, both env-flag gated. Plan: `docs/guest-funnel-and-cart-plan.md`; memory `project_guest_funnel`.
  - **Stage A — ungate the funnel (`GUEST_FUNNEL_ENABLED`).** Decision (2026-06-08): the whole design→preview→order surface is open to signed-out visitors; auth gate moved to **checkout**. Better-Auth `anonymous` plugin mints a guest user; `onLinkAccount` (auth.ts) re-parents design/order/cart to the real account on sign-in/up, then deletes the anon user. Daily generation caps (per-identity + per-IP, `generation_usage` table, `consumeGenerationQuota`) guard ungated generation. Nav + `/designs`/`/orders` treat anon as signed-out. Live-verified via Playwright (claim re-parenting, purchase gate).
  - **Stage B — multi-item cart (`CART_ENABLED`).** `order_item` + `cart_item` tables (cart re-parents on claim); live Printful `/orders/estimate-costs` bundled-shipping quote (flat fallback); `/cart` page; nav Cart count; "Add to cart" on **/order** (NOT /preview — no size there); checkout fan-out (N Stripe lines + one bundled shipping line; webhook `submitCartOrder` submits N Printful items, one order-level COGS, marks every design ordered). Real-DB integration test for the 2-item money path. Live-verified end-to-end (bundled shipping held flat across 2 items, claim, real Stripe session).
  - **Launch gotcha (resolved):** prod Turso lacked the #26 schema because `db:push` targets the dev branch (#27); flipping the flag 500'd guest sign-in. Fixed by applying additive DDL to prod via `turso db shell prntd < scripts/migrate-26-prod.sql` (NOT `db:push`). **Lesson:** verify prod DB has the migration BEFORE flipping a schema-dependent flag.
  - **Open:** (1) eyeball the first real prod guest/cart order (prod is not dry-run); (2) `addToCart` has no design ownership/published check — fine for design-your-own, revisit only if the cart accepts others' published designs.

- **#25 back-printing — CLOSED 2026-06-08** (verified shipped + live; flag on in prod).

- **Preview env parity — DONE 2026-06-09.** ANTHROPIC/REPLICATE now Production+Preview scope (was Production-only → the `/design` Preview 500); Preview + Development DB now point at an isolated `prntd-preview` Turso branch (only Production touches prod DB; token at `op://dev-secrets/prntd-preview-turso-token/credential`). Deployment Protection bypass token minted 2026-06-09 (GitHub secret `VERCEL_AUTOMATION_BYPASS_SECRET`); `GUEST_FUNNEL_ENABLED`/`CART_ENABLED` added to Preview scope.

- **CI/CD roadmap — `docs/cicd-roadmap.md`. Phase 3 SHIPPED 2026-06-09 (PR #32, verified green against a live preview).** Playwright E2E in `e2e/` (guest funnel: anon session/open funnel/gated personal routes; cart: two items, bundled-shipping-flat invariant, checkout sign-in gate), mobile (Pixel 7) + desktop projects, `npm run e2e` locally (boots `next dev -p 3100`, flags on, dev DB). CI `e2e` job waits for the Vercel preview via the GitHub deployments API and polls it with the bypass header (off-the-shelf wait actions 401 against Deployment Protection), runs Playwright against the preview + `prntd-preview` DB. **PR-only — a direct push to main never triggers it.** Specs seed designs owned by the browser's anon user via `e2e/helpers/db.ts` (never-prod guard) and self-clean. Not a required check yet (Phase 4). Next: per-PR ephemeral Turso branch (#31); Phase 4 gates once stable; branch protection still blocked on GitHub Pro.

- **Chat JSON-envelope leak — FIXED 2026-06-09 (PR #33, deployed).** Prod /design replies rendered prose + the raw `{"message",...}` envelope: the model sometimes emits both, JSON.parse failed, the fallback showed (and persisted) the whole blob, and polluted history taught later turns to imitate it. `extractChatEnvelope` (`src/lib/ai.ts`) salvages the envelope from mixed output; `buildMessages` strips embedded envelopes from assistant history before resending (stops the cascade). **Prod cleanup DONE 2026-06-13** (`scripts/clean-chat-envelopes.ts --apply` via inline prod token — 21 rows rewritten, idempotent re-run clean; old threads no longer display blobs).

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

- **#27 dev-DB isolation — DONE 2026-06-07.** Was: local dev + `db:push` both read `.env.local` → **prod Turso**, so any local experiment (and smoke tests) could hit prod data — likely cause of the past `design`/`design_image` wipe. Fixed: created `prntd-dev` (`turso db create prntd-dev --from-db prntd --group default`, seeded copy: 36 designs / 54 orders), repointed `.env.local` `DATABASE_URL`/`DATABASE_AUTH_TOKEN` at `libsql://prntd-dev-nicolovejoy.aws-us-west-2.turso.io`; prod lines kept commented in `.env.local` for flip-back. Verify with `npx tsx scripts/check-db-isolation.ts` (prints host, expects `prntd-dev-`). **Workflow consequence:** `db:push` and the dev server target **dev**, not prod. **Prod schema changes no longer use `db:push` or the `.env.local` comment-toggle** — they go through versioned migrations (`db:generate` → `db:migrate` with inline prod creds; see "Migration discipline — DONE 2026-06-13" above). The `.env.local` is now permanently dev-only. The dev branch is a one-time snapshot (not live-replicating prod) — reseed with a fresh `--from-db prntd` if it drifts.
- **#28 money-path integration tests — DONE 2026-06-07.** Was: all order/webhook/ledger tests mock `db`, so a Drizzle column/SQL mismatch passed. Added real-DB integration tests (`src/lib/__tests__/money-path.integration.test.ts`, 6 tests) running order → Stripe webhook → ledger against an in-memory libSQL built from the live schema (helper `src/lib/__tests__/test-db.ts` derives DDL from `schema.ts` via `drizzle-kit/api` — no migration files, always current; FKs enforced). Covers: paid→submitted + sale/fee/cogs ledger, the Phase 1B **% promo discounts item but shipping stays $4.69** invariant, idempotent redelivery (no double-ledger), Printful-failure (paid, no COGS), and package_shipped / order_canceled lifecycle. Only Printful/order-naming/image-resolution are mocked; the DB is real. (CI: lint → **typecheck** → test+**coverage** → build; coverage baseline 24.6% stmts / 85.3% branches, no gate yet.)
- **Dev-testing improvements (raised 2026-06-07):** (1) ✅ self-drive via **Playwright MCP** — used for the #26 guest-funnel + cart live smoke; (2) keep extending the #28 real-DB integration pattern (a cart money-path test landed); (3) ✅ **dev-DB seed script** shipped — `npm run db:seed` (`scripts/seed-dev-db.ts`). Standing constraint: the secrets hook blocks Claude from any `--env-file=.env.local` run, so live Printful/Stripe/Replicate calls still hand off to Nico (one bare command, Claude reads the output file — see memory `feedback_delegated_commands`).
- **#29 password-reset emails landing in junk — FIXED + VERIFIED 2026-06-13.** Root cause: **no DMARC record** on `_dmarc.prntd.org` (DKIM at `resend._domainkey.prntd.org` already aligned `d=prntd.org`; SPF soft-fails on root but Resend's Return-Path uses `send.prntd.org`, so DKIM carries DMARC). Fix: enabled Cloudflare DMARC Management (publishes `v=DMARC1; p=none; rua=…@dmarc-reports.cloudflare.net`) — DNS only, no code. Verified end-to-end: drove the live prod forgot-password flow to a mail-tester.com address (Playwright) → **10/10, "properly authenticated"** (SPF+DKIM+DMARC green). Throwaway test user cleaned from prod. Future: once Cloudflare reports look clean (~weeks), can tighten `p=none` → `p=quarantine`.
- **AI-scraper robots.txt — DONE 2026-06-22.** `src/app/robots.ts` keeps `User-agent: *` allowed (we live on SEO) but `Disallow: /` for 13 LLM crawlers (GPTBot, ClaudeBot, CCBot, Google-Extended, PerplexityBot, etc.). Host is Vercel-direct (Cloudflare DNS-only, not edge-proxied), so robots.txt is the operative control — Cloudflare's "Block AI bots" toggle wouldn't fire. Honor-system only; hard enforcement would need the zone behind Cloudflare's proxy + WAF. Verified live at `prntd.org/robots.txt`.
- hledger export script (docs/accounting.md has the architecture)
- Drag-and-drop image upload not working on some browsers — file picker works
- Rate limiting / generation caps
- Next.js 16 middleware → proxy migration
- Backfill `display_name` for historical orders

<!-- SHARED-CONVENTIONS:BEGIN v=d5e16e653242 — auto-managed, do not edit here; source: prompt-lab/workflow/claude-md-shared.md (edit + re-sync) -->
## Shared conventions

<!-- These are Nico's cross-repo output rules. They're materialized into each repo's
CLAUDE.md so every agent (local, cloud, third-party) sees them as plain text. Source
of truth: prompt-lab/workflow/claude-md-shared.md — edit there and re-sync, never here. -->

- **Clickable URLs.** When pointing at any web destination (dashboard, repo, PR, deploy, settings, docs, localhost), print the full bare URL — `https://example.com` or `http://localhost:8080` — on its own, never just the page's name and never a markdown `[label](url)` link. Nico's terminal auto-linkifies raw `https://` text, so a bare URL is one-click and stays copyable.

- **Number your questions.** Any time you ask Nico more than one question, present them as a numbered list (1., 2., 3.) so he can answer by number with no ambiguity. A single standalone question needs no number.

- **Self-contained smoke-test instructions.** When you ask Nico to manually test or verify an app or website, assume zero carried-over context — he should never scroll back or recall a URL/path/credential from earlier. Always include: the exact URL (full `https://…` or `http://localhost:…`, restated even if mentioned above), the precise steps in order, and what a pass vs. fail looks like. Repetition here is a feature, not clutter.

- **No marker before a copy-paste command block.** Nico's terminal renders markdown bullets (`-`, `*`, `•`) as `●`, which breaks paste into zsh. The line directly above a fenced command block must be a plain-text label ending in a colon — never a bullet, dash, asterisk, or number. For loud copy targets, lead the label with `📋` + bold `COPY THE BELOW`, then a colon, then the block.
<!-- SHARED-CONVENTIONS:END -->
