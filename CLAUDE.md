# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

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
npm run db:push      # Push Drizzle schema to Turso
npm run db:studio    # Drizzle Studio (database GUI)
```

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

### Next Steps

- hledger export script (docs/accounting.md has the architecture)
- Drag-and-drop image upload not working on some browsers — file picker works
- Rate limiting / generation caps
- Next.js 16 middleware → proxy migration
