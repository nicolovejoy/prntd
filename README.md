# PRNTD

Describe a t-shirt design in plain words, see it rendered, refine it, then buy it on a shirt that is printed and shipped by a print-on-demand provider. Designs a user publishes appear in a public Shop. Live at [prntd.org](https://prntd.org).

Next.js 16, TypeScript, Turso/Drizzle, Vitest (including real-database money-path tests), Playwright e2e in CI. In production with paid orders.

## How it works

1. **Describe.** The user types an idea into the composer in the Studio (`/studio`). Claude (`claude-sonnet-4-6`) turns the casual message and the conversation so far into a typed `DesignSpec` brief, either a new design or an edit of an existing image.
2. **Generate.** Ideogram v4 `generate-transparent` renders a new design; `/v1/edit` with a transparent background renders an edit of the image the composer is anchored to. The request returns once a job row exists. The work continues in the background, and the Studio polls job status. Each user has a daily quota (also counted per IP) and at most three jobs in flight.
3. **Iterate.** Every result is stored in Cloudflare R2. The Studio shows one lane per conversation. Opening a result gives a focused stage: the image large on its backdrop, the composer anchored to it, the other results in a strip, and the message history collapsed below. Reference images can be attached from the device.
4. **Buy.** Each image has an image detail page (`/d/[imageId]`), public for published images and an owner view for private ones. Its buy panel takes garment, size, colour and an optional back design, with Printful mockups rendered on demand. Choices are kept in the URL. No price is shown until garment and size are picked.
5. **Pay.** Order goes to Stripe Checkout, embedded on `/checkout` with hosted Checkout as the fallback if embedded is not configured. A buyer can also add lines to a cart (`/cart`) and check out together.
6. **Fulfil.** The Stripe webhook claims the order, writes sale and Stripe-fee entries to an append-only ledger, and submits the order to Printful through one shared function. Printful's invoice supplies the cost-of-goods entry. If submission fails, a daily cron retries. Confirmation email goes out through Resend.
7. **Track.** Printful webhooks move the order through shipping states, shown on `/orders`.
8. **Publish.** A signed-in user can publish an image to the Shop (`/shop`). Published images are immutable snapshots. Admins can hide them (`/admin/published`).

Visitors can use the Studio as a guest, without an account. Guests are anonymous Better-Auth users with generation quotas per identity and per IP. Checkout and publishing need a real account, and a guest's designs and cart move to the account on sign-in or sign-up.

## Architecture

```
Next.js 16 (App Router, Server Actions) on Vercel, functions pinned to pdx1
│
├─ Turso (libSQL) + Drizzle ORM, versioned migrations in drizzle/
├─ Better-Auth: email/password + anonymous guest sessions
├─ Anthropic API: Claude Sonnet 4.6 builds the design brief and names orders and published designs
├─ Ideogram API: v4 generate-transparent and /v1/edit
├─ Cloudflare R2: generated images and cached mockups
├─ Printful API: mockups, cost estimates, order submission, status webhooks
├─ Stripe: embedded and hosted Checkout, webhooks, promo codes, admin refunds
└─ Resend: transactional email
```

Server Actions handle mutations; each page directory has a sibling `actions.ts`. API routes under `src/app/api/` are for Better-Auth, the Stripe and Printful webhooks (`api/webhooks/`), two crons (`api/cron/retry-fulfillment`, `api/cron/sweep-generations`) and a health check. The product catalog, pricing and promotions are config in TypeScript (`src/lib/blanks.ts`, `pricing.ts`, `promotion.ts`); adding a garment is a new entry in `blanks.ts`.

## Notable engineering

- **Money-path tests against a real database.** Order, Stripe webhook and ledger tests run against an in-memory libSQL built from `schema.ts` (`src/lib/__tests__/test-db.ts`), so a schema/query mismatch fails the suite instead of hiding behind mocks.
- **Append-only ledger** (`sale`, `stripe_fee`, `cogs`, `refund`, `refund_cogs_reversal`), unique per order and type, with cost of goods taken from Printful's invoice rather than estimated.
- **Conditional writes instead of transactions.** libSQL over HTTP has no interactive transactions, so claims use `UPDATE … WHERE status = …` and caps use guarded `INSERT … SELECT … WHERE count < cap`. The webhook claim and its ledger rows land in one `db.batch`.
- **Typed brief, affirmative only.** The brief schema has no negative-prompt field; Claude is told to turn a negation ("no text") into a positive description, because image models draw whatever the prompt mentions.
- **Background generation with cleanup.** Jobs carry a client-minted id so a lost response does not read as a failure. A cancelled job's result is discarded, and a sweep fails stale jobs, refunds their quota and reclaims orphaned R2 objects.
- **Checkout session hygiene.** Sessions expire after two hours, and a new checkout expires the buyer's earlier open sessions at Stripe. Checkout attempts are capped per user and per IP, and a cart holds at most 40 lines.
- **CI.** Lint, typecheck, tests and build on every PR, plus a migration drift gate (`npm run db:generate` must report no schema changes). On PRs, Playwright runs against a local compiled build and an ephemeral Turso branch copied from the preview database. A nightly job runs real Stripe test-mode checkouts and a Printful contract check; a post-deploy job checks markers on prntd.org.
- **Migration discipline.** Additive migrations are applied to production before the code merges; destructive ones follow a written runbook with a rehearsal on a copy.

## Local development

```bash
npm install
cp .env.example .env.local                # fill in values (see below)
npm run db:push                           # sync schema to the dev database
npm run dev
```

```bash
npm run lint
npm run typecheck
npm test                 # Vitest, one run
npm run test:watch
npm run build
npm run e2e              # Playwright against a local compiled build
npm run e2e:stripe       # real Stripe test-mode checkouts (see docs/stripe-e2e.md)
npm run db:generate      # new migration from schema.ts changes
npm run db:migrate
npm run db:seed
npm run db:studio
```

`.env.local` must point at the dev database, not production. With 1Password access, `.env.tpl` generates it instead; its header has the three steps (inject to a temporary file, review key names with `scripts/diff-env.ts`, move into place). `db:push`, `db:migrate` and `db:seed` refuse any other target unless confirmed.

Environment variable names (values are not in the repo):

`DATABASE_URL`, `DATABASE_AUTH_TOKEN`, `IDEOGRAM_API_KEY`, `ANTHROPIC_API_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `NEXT_PUBLIC_R2_PUBLIC_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `PRINTFUL_API_KEY`, `BETTER_AUTH_SECRET`, `RESEND_API_KEY`, `NEXT_PUBLIC_APP_URL`, `ADMIN_EMAIL`, `OWNER_EMAIL`, `CRON_SECRET`, `NEXT_PUBLIC_FEEDBACK_PROJECT_ID`

Feature flags: `GUEST_FUNNEL_ENABLED`, `CART_ENABLED`, `MULTI_PLACEMENT_ENABLED`, `EMBEDDED_CHECKOUT_ENABLED`. `PRINTFUL_DRY_RUN=true` skips real order submission, and `PRINTFUL_AUTO_CONFIRM` defaults on. Generation, upload and checkout quotas have per-user and per-IP daily cap variables (for example `USER_GEN_DAILY_CAP`, `USER_CHECKOUT_DAILY_CAP`). `REPLICATE_API_TOKEN` is used only by ops scripts in `scripts/`.

More detail is in `docs/` (`design-system.md`, `products.md`, `stripe-e2e.md`) and `CLAUDE.md`.

## Status

Live at prntd.org and taking paid orders, fulfilled through Printful, including back prints and multi-item carts. Working: the Studio for guests and account holders, the image detail page buy panel, the cart, embedded checkout, order history, the Shop, and admin pages for orders (with ledger timeline and refunds), published-image moderation, usage and captured errors.
