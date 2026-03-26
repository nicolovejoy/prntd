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
- Flux + Ideogram via Replicate for image generation (migrating to Ideogram direct API)
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

User describes design in chat → Claude interprets intent and constructs Flux prompt → Replicate generates image → stored in R2 (`designs/{design_id}/{generation_number}.png`) → displayed on shirt mockup. User can refine (back to chat with context), try new, or approve. Chat history maintained per session. Each generation increments token/cost counter.

### Data Model (Drizzle + Turso)

Six tables (all singular names to match Better-Auth defaults): `user`, `session`, `account`, `verification` (auth), `design` (tracks chat_history JSON, current_image_url, generation cost, status draft/approved/ordered), `order` (links design to Printful order, Stripe session, shipping details, status lifecycle).

### Payment Flow

Stripe Checkout Session → redirect → webhook confirms payment → triggers Printful order submission. Price = Printful base + accumulated generation cost + margin.

### Key Integration Points

- **Replicate**: image generation via Flux model
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

### Switch to Ideogram direct API + simplify design UX (priority)

Flux Schnell is terrible at text rendering. The dual-model A/B picker added complexity without solving it. Plan:
- Drop A/B test entirely — one model, one result
- Switch from Replicate/Flux to Ideogram's direct API (purpose-built for text in images)
- Redesign the design page: full-width chat with image inline (no awkward split panel)
- Keep iteration flow (already working: Claude sees previous prompt and edits surgically)

### Shipping address collection (blocks real orders)

Order page needs address form (name, street, city, state, zip). Store on order record, pass to Printful in webhook. Schema columns need adding. Plan exists in plans/flickering-swinging-anchor.md.

### Admin dashboard (minimal)

Simple /admin page listing all orders with status, user email, design thumbnail, Printful ID. Hardcoded email check for auth.

### Other TODOs

- Next.js 16 middleware deprecation warning — migrate to proxy convention
- Printful webhooks for tracking updates (no visibility after submission)
- Rate limiting / generation caps (cost protection, low priority while usage is minimal)
