# Next phase plan — May 2026

Goal: move PRNTD from "1 real customer + working product" to genuine traction. Solo build (Max stepped away 2026-05-06).

## State as of May 6, 2026

Shipped recently:

- Email subject lines + order auto-naming (PR #7)
- Image-prompt style bias fix + reorder flow (PR #9)
- Branch protection, CI, contributing docs
- Issue #10 — order list thumbnails on shirt color (May 1; iPhone case "Clear" still on white as a follow-up)
- Phase 0 design loop (Ideogram native-transparent endpoint)
- Phase 1 design loop (negation rewriting in advisor system prompt)
- Data model rework Steps 0–2 (style-anchored regens, `design.primary_image_id` + dual-write + backfill, `/preview` rewritten as pure function of designId/productId)

Open issues: #2 (fork model deferred), #4 (charity infra — on hold), #5 (homepage re-org — on hold), #6 (marketplace), #11 (Printful + checkout deep-dive), #12 (image export), #15 (silent regen hang — likely resolved by data model rework).

## Active track — design loop & data model

The data model rework is the active build. Plan: `~/.claude/plans/i-want-you-to-concurrent-fountain.md`.

Remaining steps:

- **Step 3** — pre-fetch Printful mockups on accept via `after()`, all colors of default product (free Printful calls).
- **Step 4** — `/design` gallery rewrite: source images vs Product versions section; rename "Use this image" → "Make Products".
- **Step 5** — retire `currentImageUrl` writes, drop column, strip `chat_history.imageUrl`.

After that, the design-loop-rethink phases:

- **Phase 2** — text-as-layer. Plan: `docs/phase-2-text-as-layer-plan.md`. Schema + font catalog + `composeWithText` (`@vercel/og` + `sharp`) + UI panel. ~1 week of work.
- **Phase 3** — structured brief + batch-of-3. Plan: `~/.claude/plans/feedback-for-the-coding-woolly-snowflake.md`.

## On hold — public-facing readiness

Charity disbursement infra (#4) and homepage re-org (#5) are paused. The chain (DESC permission email → entity confirmation → #4 ledger work → first real disbursement → #5 mission-led copy) is still the right shape if/when this restarts; nothing to delete.

Open question for restart: keep DESC as the named beneficiary, or reframe more generally before approaching anyone for permission.

## Loop polish (parallel or after data model rework)

### Issue #8 follow-up — Style reference image library

Now that the system prompt is style-neutral, build a small curated style ref image library: sumi-e, vintage screen-print, pen-and-ink, line drawing, art-deco poster, punk zine. Map descriptors → file paths in `src/lib/style-refs.ts`, attach to Ideogram via `style_reference_images` when Claude detects intent. Needs a designer eye.

### Issue #2 remainder — Fork model

Add `parent_design_id` to `design`. New server action `forkDesign(id)` that copies `chatHistory` + primary image and creates a new draft. Read-only past view + "Make another like this" button. Required scaffolding before #6 marketplace where design lineage matters.

### Mobile flow rethink

Design → preview → order is too fragmented on phones. Consider collapsing /preview into /design, or a stepped single-page flow. Adjacent: `docs/funnel-back-nav.md` covers the back-affordance gap.

## Things explicitly NOT in this phase

- Marketplace (#6). Validate retention + reorder usage first.
- Native iOS app. PWA install + mobile flow consolidation cover most of the value.
- Multi-placement (front + back) printing. Wait for product expansion to demand it.
- Posters, canvas, stickers, hoodies. After the funnel is doing real work.
- Discount code structural fix (charging shipping separately). Single Launch Special at 50% off works for now; don't run more aggressive promos until fixed.

## Working agreements

- **Solo workflow** → no PRs. Edit on main, review in VS Code, commit + admin push. (See `feedback_pr_workflow` memory.)
- **Branch protection** stays on; admin bypass on push to main is the documented escape.
- **Each shipped feature** gets a real test-mode order to verify, per `feedback_test_orders` memory.

## Followup items still open

- 1Password secret migration (paused, low priority)
- hledger export script (low priority)
- Backfill display_name for historical orders (low priority)
