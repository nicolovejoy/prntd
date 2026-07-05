# PRNTD

Chat with an AI to design a t-shirt, then buy it — the shirt is printed and shipped by a print-on-demand provider. Live at [prntd.org](https://prntd.org).

**Next.js 16 · TypeScript · Turso/Drizzle · 440 Vitest tests (incl. real-DB money-path integration) · Playwright e2e in CI against live preview deploys · in production with real paid orders**

## How it works

1. **Describe** — the user chats on `/design`. Claude (Sonnet 4.6) interprets each casual message and constructs a structured image-generation prompt, returned as a JSON envelope with a readiness flag; a fast Haiku 4.5 pre-check catches under-specified ideas before spending a generation.
2. **Generate** — Ideogram v3 Turbo (via Replicate) renders the design. Transparency comes from Ideogram's native transparent-background endpoint when generating fresh, or from BiRefNet background removal (`851-labs/background-remover` on Replicate) when iterating against an anchor image. Generators sit behind an adapter interface (`src/lib/generators/`), with Recraft v3 as an alternate for side-by-side comparison.
3. **Iterate** — every generation is stored in Cloudflare R2 and appended to the design thread; the user refines in chat with prior images as style references.
4. **Preview** — `/preview` renders the design on a real product mockup via the Printful mockup API, placement-aware (front and optional back print).
5. **Buy** — size/color selection, per-size pricing with shipping as a separate Stripe line item, then Stripe Checkout (single item or multi-item cart).
6. **Fulfill** — the Stripe webhook confirms payment and submits the order to the Printful REST API through a single shared fulfillment path; sale, Stripe-fee, and COGS entries land in an append-only ledger; confirmation emails go out via Resend with the actual product mockup.
7. **Track** — Printful webhooks drive shipping status back into the customer's order history.

Guests can use the whole design→preview→order funnel without an account (anonymous sessions with daily generation quotas per identity and per IP); the auth gate is at checkout, and guest designs/carts are re-parented to the real account on sign-in.

There is also an organizer layer: a user can open a store, compose products (design × blank garment × placements) with their own pricing, and share a public storefront at `/shop/[slug]`.

## Architecture

```
Next.js 16 (App Router, Server Actions) on Vercel
│
├─ Turso (libSQL) + Drizzle ORM — 15 tables, versioned migrations
├─ Better-Auth — email/password + anonymous guest sessions
├─ Anthropic API — Claude Sonnet 4.6 (prompt construction), Haiku 4.5 (readiness check)
├─ Replicate — ideogram-v3-turbo, recraft-v3, BiRefNet background removal
├─ Ideogram API — native transparent-background generation
├─ Cloudflare R2 — all generated images + cached mockups
├─ Printful REST API — mockups, order submission, shipping webhooks
├─ Stripe — Checkout Sessions, payment webhooks, promo codes
└─ Resend — transactional email
```

Server Actions handle all mutations; the only API routes are the Stripe and Printful webhook receivers (`src/app/api/webhooks/`). Product catalog, pricing, and promotions are config-driven TypeScript (`src/lib/blanks.ts`, `pricing.ts`, `promotion.ts`).

## Notable engineering

**Treating LLM output as a wire format.** The chat model must return a JSON envelope (message, image prompt, readiness flag, quick-reply options), but models sometimes emit prose *and* the envelope in one reply. A naive parse failure once persisted the raw blob into chat history — which then taught every later turn to imitate the broken format, cascading across the thread. The fix is layered: a salvage parser extracts the envelope from mixed output, and history is scrubbed of embedded envelopes before each resend so the model never sees its own malformed replies. Related: user negations ("no text on it") are rewritten into affirmative image prompts, because diffusion models surface whatever you mention.

- **Money-path integration tests against a real database.** Order → Stripe webhook → ledger runs against an in-memory libSQL instance whose DDL is derived from the live Drizzle schema at test time, so a schema/query mismatch fails the suite instead of hiding behind mocks.
- **End-to-end tests in CI against real deploys.** Playwright specs (guest funnel, multi-item cart, store composition) run on every PR against the Vercel preview deployment, after applying pending migrations to an isolated preview database branch. Locally they run against a compiled production build.
- **Background-removal correctness.** Transparent PNGs on colored shirts exposed soft-alpha artifacts (thin dark strokes going semi-transparent); the pipeline uses hard-threshold BiRefNet segmentation, chosen after the previous remover silently returned unprocessed images on painterly output.
- **Append-only financial ledger** (sale / stripe_fee / cogs / refund) with COGS taken from Printful's real invoice, not estimates; order classification kept separate from freeform tags.
- **Versioned schema migrations** (Drizzle) with per-environment database branches (dev / preview / prod), a baselined genesis snapshot, and a row-count smoke script that runs before and after production migrations.
- **Anonymous-to-registered account claiming** — designs, orders, carts, and stores created as a guest are re-parented atomically when the user signs up.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in values
npm run db:push              # sync schema to your dev database
npm run dev
```

```bash
npm test        # Vitest (unit + real-DB integration)
npm run e2e     # Playwright against a local production build
npm run lint
npm run db:studio
```

Required env vars (names only — see `.env.example`):

`DATABASE_URL`, `DATABASE_AUTH_TOKEN`, `ANTHROPIC_API_KEY`, `REPLICATE_API_TOKEN`, `IDEOGRAM_API_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PRINTFUL_API_KEY`, `RESEND_API_KEY`, `BETTER_AUTH_SECRET`, `ADMIN_EMAIL`, `NEXT_PUBLIC_R2_PUBLIC_URL`, `NEXT_PUBLIC_APP_URL`

Feature flags (env-based): `GUEST_FUNNEL_ENABLED`, `CART_ENABLED`, `MULTI_PLACEMENT_ENABLED`, `STORES_ENABLED`. `PRINTFUL_DRY_RUN=true` short-circuits real order submission for local testing.

## Status

In production at prntd.org with real paid orders fulfilled end-to-end (including two-sided prints and multi-item carts). Working: the full design→order funnel for guests and account holders, admin order management with ledger timeline, organizer stores with public storefronts.

Known gaps: organizer storefronts attribute sales but don't move money to organizers yet (no payout/Stripe Connect); money-path idempotency hardening and cart-lifecycle fixes are tracked in the issue backlog; visual identity/copy pass is pending.
