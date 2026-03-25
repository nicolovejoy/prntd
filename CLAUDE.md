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
- Flux via Replicate for image generation
- Claude (Anthropic API) as intermediary to construct Flux prompts from casual user messages
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

### Design iteration is broken (priority fix)

The refinement loop doesn't work well. When a user says "make the text bigger," Claude writes a brand new Flux prompt from scratch instead of editing the previous one. Root cause:

- `src/lib/ai.ts` strips `fluxPrompt` from chat history when building Claude messages, so Claude doesn't know what prompt produced the current image
- The system prompt doesn't instruct Claude to treat refinements as surgical edits to the previous prompt
- Flux is stateless (no img2img) — prompt consistency is the only way to get consistent iterations

**Fix:** Include `fluxPrompt` in the messages sent to Claude (e.g. "I generated this using the prompt: {fluxPrompt}"). Rewrite system prompt to instruct Claude to take the previous Flux prompt and modify only what the user asked to change.

### Other TODOs

- Shipping address collection (not yet in checkout flow)
- Printful variant IDs are placeholders — need to fetch from API
- Stripe webhook secret not yet configured (use `stripe listen` for local dev)
- Next.js 16 middleware deprecation warning — migrate to proxy convention
