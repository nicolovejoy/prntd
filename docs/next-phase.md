# Next phase plan — May 2026

Goal: move PRNTD from "1 real customer + working product" to genuine traction with real paying users. Two tracks running in parallel: (a) ship the public-facing pitch so cold visitors have a reason to buy; (b) keep polishing the loop so existing-customer retention is ready.

## State as of end-of-day May 1, 2026

Shipped today:
- Email subject lines + order auto-naming (PR #7)
- Image-prompt style bias fix + reorder flow (PR #9)
- Branch protection, CI, contributing docs
- Max onboarded, first PR through the new infra

Open issues: #2 (fork model deferred), #4 (charity infra), #5 (homepage re-org), #6 (marketplace), #10 (order thumbnails).

## Phase 1 — Public-facing readiness (~2 weeks)

**Goal:** make the homepage do real work for cold visitors. Mission-led, factual, with proof of charity behind the claim.

### Pre-flight (Nico, blocks #4 and #5)

- Email DESC for permission to be named on a commercial site. Wait for response.
- Confirm the legal entity making the donation claim (sole prop vs LLC). One sentence in `docs/accounting.md`.

### Issue #4 — Charity disbursement infrastructure (Nico)

Decisions to make in the PR description, not silently:
- Account mapping: `Expenses:CharityDisbursements` (recommended) vs `Equity:CharityDistributions`.
- Manual-only disbursement UI in admin. Operating costs not in scope (ledger remains revenue/fees/COGS-only; disbursement size is Nico's discretionary call).
- New ledger type: `charity_disbursement`, sign negative.
- New server function `getCharityTotal()` returning `{ totalDisbursed, lastDisbursementAt, primaryRecipient }`.
- Admin financial summary gets a new "Charity disbursed" row.

After #4 ships: log a first real disbursement, however small. That unblocks #5 copy.

### Issue #5 — Homepage re-org (Nico)

Lead with mission, demote mechanics. Mission strip names DESC factually, no personal/board language, link to https://www.desc.org. All charity copy + DESC link centralized in `src/lib/charity-copy.ts`. Featured-design IDs in `src/lib/featured-designs.ts`. Cold-visitor target: see mission + 2 real designs above the fold on mobile within one swipe.

Out of scope: live charity counter (placeholder until first disbursement is logged), creator/marketplace UI, designer profiles.

### Issue #10 — Order list thumbnails (Max)

Render order thumbnails against the actual product color rather than the page background. `src/lib/products.ts` should already expose hex per color (verify, extend if not). `getColorHex(productId, colorName)` helper, applied to `/orders`, `/admin`, `/admin/orders/[id]`. Neutral gray fallback for `/designs` and orders without a color. Light visual upgrade across every list view.

This is Max's next task after #1 / #3 land in production.

## Phase 2 — Loop polish (parallel or after Phase 1)

### Issue #8 follow-up — Style reference image library (Nico or Max)

Now that the system prompt is style-neutral, build a small curated style ref image library: sumi-e, vintage screen-print, pen-and-ink, line drawing, art-deco poster, punk zine. Map descriptors → file paths in `src/lib/style-refs.ts`, attach to Ideogram via `style_reference_images` when Claude detects intent. Bigger product upgrade than the prompt rewrite; needs a designer eye.

### Issue #2 remainder — Fork model

Add `parent_design_id` to `design`. New server action `forkDesign(id)` that copies `chatHistory` + `currentImageUrl` and creates a new draft. Read-only past view + "Make another like this" button. Required scaffolding before #6 marketplace where design lineage matters.

### Mobile flow rethink

Design → preview → order is too fragmented on phones. Consider collapsing /preview into /design, or a stepped single-page flow. Probably belongs after Phase 1 ships and we have enough mobile traffic to evaluate.

## Phase 3 — Marketing experiment (parallel, $50–$100 budget)

Pick ONE distribution channel and run a small test:

- **Reels of the design loop happening** — short, captioned, no music. Show the prompt → image → mockup → order moment. Each video links back to prntd.org.
- **Reddit** — single post in r/AIArt or r/StreetWear with a real "I made this on PRNTD" angle. Risky if it reads as spam.
- **Friend-of-friend seeding via DESC's network** — once DESC has approved being named, the mission angle turns into a warm intro.

Goal of the experiment isn't conversions, it's signal: which channel produces visits that even *get* to /design. Conversion will be revisited after Phase 1 lands.

## Things explicitly NOT in this phase

- Marketplace (#6). Validate retention + reorder usage first. Do the cheap experiment Brief 6 mentions: ask Knute or another test user "would you have shared this with friends?"
- Native iOS app. PWA install + mobile flow consolidation cover most of the value.
- Multi-placement (front + back) printing. Wait for product expansion to demand it.
- Posters, canvas, stickers, hoodies. Same — after the funnel is doing real work.
- Discount code structural fix (charging shipping separately). Single Launch Special at 50% off works for now; don't run more aggressive promos until fixed.

## Working agreements

- **Nico's solo coding** → no PRs. Edit on main, review in VS Code, commit + admin push. (See `feedback_pr_workflow` memory.)
- **Max's contributions** → keep PR + review + CI workflow. He gets next assignments via GitHub issues.
- **Branch protection** stays on for non-admins.
- **Each shipped feature** gets a real test-mode order to verify, per `feedback_test_orders` memory.

## Followup items still open

- DESC permission email (Nico, this week)
- Legal entity confirmation in `docs/accounting.md` (Nico, this week)
- 1Password secret migration (paused, resume after Phase 1)
- Vercel team seat for Max (deferred, ~$20/mo when needed)
- hledger export script (low priority)
- Backfill display_name for historical orders (low priority)
