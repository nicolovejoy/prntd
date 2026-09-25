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
/studio                 → Studio bench: composer on top, one lane per conversation (sign-in gated today; #241 opens it to guests)
/studio/library         → My Designs: every owned image, Active/All filter
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

Redirect-only: `/designs` → `/studio/library`, `/studio/archive` → `/studio/library`, `/prints` → `/shop` (308s), `/order` → `/preview`. Retired but still in the tree until composition slice 5 merges: `/dashboard/**`, `/shop/[slug]/**` (organizer storefronts; `STORES_ENABLED` removed from Vercel, so they 404).

Say "image detail page", not "/d", when talking to Nico.

Auth: `src/middleware.ts` checks the session cookie; `requireRealUser` guards server-rendered personal pages; anonymous guests are real `user` rows (Better-Auth anonymous plugin) that `onLinkAccount` re-parents on sign-in/up via `reparentUserData` (every user-owned table must be listed there — its integration test seeds one row per table and is the checklist). `/admin` is gated by `isAdminUser()`: `ADMIN_EMAIL` is Nico's gmail; his me.com account is a regular user.

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
- **Printful:** product catalog in `src/lib/products.ts`; mockups; order submission; status webhooks (redeliveries at the target status return 200 `ignored`). `PRINTFUL_AUTO_CONFIRM` defaults ON. Printful's field constraints are invisible to mocks; the nightly contract check is the only test that sees them.
- **Stripe:** hosted checkout, webhooks, admin refunds. Radar goes to $0.05/transaction after 2027-01-22 — switch to Radar Lite or decide by January.

### Conventions

- **Server Actions**: every page directory has a sibling `actions.ts` containing `"use server"` functions (async exports only; pure helpers that need tests go in `src/lib/`). API routes under `src/app/api/` are for webhooks, crons and health only.
- **Path alias**: `@` maps to `src/` (configured in `tsconfig.json` and `vitest.config.ts`).
- **Claude API**: messages must end with a user turn — no assistant prefill. The API rejects requests where the last message role is `assistant`. See `src/lib/ai.ts:buildMessages` for the workaround.
- **Product catalog**: config-driven in `src/lib/products.ts`. Adding a product requires only a new entry in the `PRODUCTS` array with Printful variant IDs — preview, order, and checkout flows pick it up automatically. Process and discovery scripts documented in `docs/products.md`.
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
USER_GEN_DAILY_CAP, GUEST_GEN_DAILY_CAP, IP_GEN_DAILY_CAP     # generation quota overrides
NEXT_PUBLIC_FEEDBACK_PROJECT_ID            # feedback widget target
REPLICATE_API_TOKEN                        # ops scripts only
```

Vercel env changes apply only to new deployments. A flag a Playwright spec needs must be set in CI's e2e env, and in Vercel's Preview scope to test on a preview deploy.

## Current state (2026-09-25)

- **Prod** is at `fe7f515` (2026-09-10). Nightly Stripe e2e and prod-smoke are green.
- **In flight:** the 2026-09-25 batch — plan of record `docs/superpowers/plans/2026-09-25-batch.md`, roadmap page https://claude.ai/artifact/WzPgkzJUzMYdAX156Z4Nfr. Branches: `/studio` hydration mismatch (React #418), #241 guests in Studio, #138 slice 3 (front/back swap on the image detail page), composition slice 5 rebuilt as migration 0014 (HELD — replaces PR #201), then #135 slice 2 (embedded checkout, flag off).
- **Open issues:** #241 (guests can't reach their designs), #188 (Paper look — slice 4 focused stage needs Nico's call; slice 8 leftovers), #135 (slices 2–4), #138 (slice 3), #235 (app icon + link-preview mark), #139 (light/dark shirt filter), #127 (phone speed check), #14 (full Printful colors), #12 (zip export), #4 (charity, paused).
- **Unrun smoke:** #242 + #243 in one pass — signed in, generate one image in a new conversation at https://prntd.org/studio, open it, Delete; PASS = the sheet names the conversation, confirming lands on /studio, and the lane is gone.
- **Backups:** `prntd-backup-20260908` (safe to delete).
- **Watch items:** anonymous back-mockup renders append to the seller's `design.mockup_urls` (~230 KB/design; revisit at 10× the Shop); the admin Refund button has never run on a real Printful cancel; fulfillment recovery can persist `submitted` with no COGS when Printful omits `costs.total` (loud log, book it by hand); leftmost `x-forwarded-for` feeds the IP quota.
- **Deferred:** `middleware.ts` → `proxy.ts` (Next 16 deprecation; after #241 merges); the prompt-quality eval harness (`docs/async-generation-and-edit-plan.md` slice 4).

## Standing rules

### Migration discipline

- Flow: edit `schema.ts` → `npm run db:generate` → review the SQL in the PR → apply → merge. `db:push` is dev-only.
- **Apply the migration to prod BEFORE the PR merges.** Main auto-deploys; merging a schema PR first took prod down twice (0006 on 2026-07-25, 0013 on 2026-09-08). Mark schema PRs HOLD in the title and keep them held.
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

## Shared conventions

<!-- These are Nico's cross-repo output rules. They're materialized into each repo's
CLAUDE.md so every agent (local, cloud, third-party) sees them as plain text. Source
of truth: prompt-lab/workflow/claude-md-shared.md — edit there and re-sync, never here. -->

- **Clickable URLs.** When pointing at any web destination (dashboard, repo, PR, deploy, settings, docs, localhost), print the full bare URL — `https://example.com` or `http://localhost:8080` — on its own, never just the page's name and never a markdown `[label](url)` link. Nico's terminal auto-linkifies raw `https://` text, so a bare URL is one-click and stays copyable.

- **Number your questions.** Any time you ask Nico more than one question, present them as a numbered list (1., 2., 3.) so he can answer by number with no ambiguity. A single standalone question needs no number.

- **Self-contained smoke-test instructions.** When you ask Nico to manually test or verify an app or website, assume zero carried-over context — he should never scroll back or recall a URL/path/credential from earlier. Always include: the exact URL (full `https://…` or `http://localhost:…`, restated even if mentioned above), the precise steps in order, and what a pass vs. fail looks like. Repetition here is a feature, not clutter.

- **UTC at rest, Pacific on display.** Timestamps are stored in UTC, always. A *calendar day* shown to a human is `America/Los_Angeles` — Nico's day, and the clock the work actually happened on. The two rules that follow are the ones that get broken: never form a date bucket with `new Date(…).toISOString().slice(0,10)` (that is UTC, so every chart axis and "today" silently rolls over at 5pm Pacific — it put a phantom tomorrow bar on the Prompt Lab dashboard), and never bucket UTC-stamped rows with a bare `date(col)` in SQL. Use `Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' })` in JS and an explicit zone in SQL/Python. Storage in local time is also wrong — it can't be migrated across a DST boundary without loss.

- **No marker before a copy-paste command block.** Nico's terminal renders markdown bullets (`-`, `*`, `•`) as `●`, which breaks paste into zsh. The line directly above a fenced command block must be a plain-text label ending in a colon — never a bullet, dash, asterisk, or number. For loud copy targets, lead the label with `📋` + bold `COPY THE BELOW`, then a colon, then the block.
<!-- SHARED-CONVENTIONS:END -->

## Cross-repo handoff with prompt-lab

This repo coordinates with **prompt-lab** (whose agent surveyed all of Nico's repos for CI/CD + DB patterns) through an append-only log in the private repo `nicolovejoy/handoff`, cloned to `~/src/.handoff`. The matching file is `prntd-prompt-lab.md`. prompt-lab's SessionStart hook auto-injects its `## Active` section; here, read it manually at session start. To reply, append an entry to the top of `## Active` (`### YYYY-MM-DD prntd → prompt-lab: <subject>`) and `cd ~/src/.handoff && git pull --rebase && git commit -am … && git push` (or use prompt-lab's `~/.claude/bin/handoff.sh append`/`sync` if installed). Move acted-on entries to `## Archived` with a one-line outcome.
