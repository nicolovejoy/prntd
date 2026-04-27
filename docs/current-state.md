# Current state — strategic snapshot

Date: 2026-04-27. Purpose: ground-truth doc for a strategy walkthrough framing PRNTD as three surfaces (group store hosting, designer marketplace, cause-routing). Code-cited; not aspirational.

## TL;DR

PRNTD today is a **single-tenant, single-creator, single-recipient** t-shirt designer. All three strategic surfaces — group stores, designer marketplace, cause-routing — are absent in code. Cause-routing is the most consequential of the three because every order's money flow currently terminates in one Stripe account and one ledger party; routing is not a layer that can be added without schema changes to `ledgerEntry` and to how Stripe payouts are configured.

The good news: most items on the current "What's next" list are tactical. Only two carry architectural lock-in (shipping line-item, multi-placement). The `order.designId` hard FK is a real constraint for both multi-placement and any future store-scoped catalog.

---

## Surface 1 — Group store hosting (bands, teams, clubs)

**Existing primitives: none.** No tenant/store/organization concept anywhere.

- `design` table (`src/lib/db/schema.ts:48`) has `userId` only — no `storeId`, no `ownerType`.
- `order` table (`src/lib/db/schema.ts:62`) has `userId` and a hard FK `designId` — orders attach to one user and one design.
- Better-Auth setup (`src/lib/auth.ts`) is plain user/session/account; no organization plugin, no membership table.
- Routes are flat and per-user: `/design`, `/preview`, `/order`, `/orders`, `/designs`. There is no `/s/[slug]` or `/store/[id]` shape.
- `/designs` (`src/app/designs/page.tsx`) lists the signed-in user's own drafts; not a public catalog.
- All admin actions are gated by `session.user.email === ADMIN_EMAIL` (`src/app/admin/actions.ts:23` and 10 more call sites). Single-admin model.

**Partial:** the `product` catalog (`src/lib/products.ts`) is config-driven and could be reused as a per-store catalog later, but it is global today.

**Absent:** store entity, membership/role model, store-scoped browse page, store-scoped checkout, store-scoped admin, per-store branding/theme, per-store domain or slug, per-store payout destination.

**Concrete near-term user (Seattle band):** to host their store today, every design and order would land under a personal user account; there is no way to expose a band-branded URL, accept submissions from band members, or split proceeds. They would experience this as "Nico's account with the band's name in copy" — i.e., the platform cannot serve them yet.

## Surface 2 — Designer marketplace (XP, badges, leaderboards, challenges)

**Existing primitives: none beyond auth.**

- `user` table (`src/lib/db/schema.ts:3`) is auth-only: id, email, name, image. No profile fields, no XP, no level, no badges, no streaks.
- No `designer_profile`, `badge`, `challenge`, `vote`, or `leaderboard` table.
- No public designer pages, no `/u/[handle]`, no discovery routes.
- `design` has no `isPublic`, no `votes`, no `tags` for discovery.

**Partial:** `design.chatHistory` and `design.currentImageUrl` are persisted, so the artifacts that would populate a public profile already exist; they're just not exposed.

**Absent:** everything else. Marketplace is a greenfield surface — which is good news strategically (no legacy to unwind) but means it requires a deliberate model rather than an extension.

## Surface 3 — Cause-routing (creator / cause / platform / print split)

**Existing primitives: none. The ledger is single-party.**

- `ledgerEntry` (`src/lib/db/schema.ts:93`) has `orderId`, `type`, `amount`, `description`, `metadata`. No `recipient`, `recipientType`, `splitPct`, or destination field. Today's `type` enum in practice: `sale`, `stripe_fee`, `cogs`, `refund`, `refund_cogs_reversal`.
- Pricing (`src/lib/pricing.ts`): `baseCost × 1.5`. One margin number; no allocation across recipients.
- Stripe is one account (`src/lib/stripe.ts`, single `STRIPE_SECRET_KEY`); no Stripe Connect, no transfers, no destination charges.
- Printful is one account (`src/lib/printful.ts`, single `PRINTFUL_API_KEY`).
- "All profits to DESC" appears **nowhere in the codebase** — not in copy, not in comments, not in the ledger, not in `docs/accounting.md`. It is currently a stated intent only. (Verified: grep for `DESC`, `donate`, `donation`, `nonprofit`, `charity`, `cause` returns zero relevant hits in `src/` and `docs/`.)

**Implication:** cause-routing is not "hardcoded to DESC and needs to be generalized." It is unimplemented. That is structurally easier (no migration of existing semantics) but means every money-touching path needs to learn about recipients: ledger entries, Stripe payout/transfer, accounting export (`docs/accounting.md`), admin financial summary.

The places that would need to change to introduce recipient routing:

1. `ledgerEntry` schema — add `recipientId` + `recipientType`, or split entries per recipient.
2. Stripe webhook handler (`src/app/api/webhooks/stripe/route.ts`) — write multiple ledger rows per sale.
3. Pricing module (`src/lib/pricing.ts`) — compute the split alongside the total.
4. Admin financial summary — group/filter by recipient.
5. Payout mechanism — currently implicit (everything sits in Nico's Stripe). Real routing needs Stripe Connect or scheduled manual transfers.
6. Customer-facing copy on order/confirm/email — to actually tell the buyer where their money went.

---

## The `order.designId` FK concern

`order.designId` is `text().notNull().references(() => design.id)` — a hard, non-null FK to a single design row (`src/lib/db/schema.ts:64`). Concrete impact:

- **Multi-placement (front + back, art + sleeve):** today an order is exactly one design → one image → one Printful submission (`src/lib/printful.ts`). Multi-placement requires either (a) an `order_item` join table with N (placement, designId) rows per order, or (b) a `placement` JSON column on order. Either way, the `designId` column on `order` becomes wrong — it represents a slot that no longer exists. This is the single biggest schema change blocking the product roadmap.
- **Second tenant (band store):** less of a direct constraint — a band's order would still point to one design at a time. The constraint there is the absence of `storeId` on either `design` or `order`, not the design FK.
- **Reorders / variants:** no flow exists. Reordering "the same shirt in a different size" today would create a new order pointing at the same designId, which works. But if designs become store-scoped, "the same design" needs to mean "the same logical design across reissues," which a single-row FK conflates with "this exact draft snapshot."

Recommendation for the meeting (not for implementation): treat the `order ↔ design` relationship as an `order_item` from the start of any multi-placement or marketplace work. It's the same change either path forces.

---

## Single-tenant / single-creator assumptions to surface in the meeting

Verified hard-coded singletons:

- Admin gate: `ADMIN_EMAIL = "nicholas.lovejoy@gmail.com"` (`src/app/admin/actions.ts:23`), checked at 11 call sites. No role table.
- Owner alert recipient: `process.env.OWNER_EMAIL ?? "nico@prntd.org"` (`src/lib/email.ts`).
- Email FROM: `PRNTD <orders@prntd.org>` baked into `src/lib/email.ts`.
- Brand string "PRNTD" in `src/app/layout.tsx`, `src/app/page.tsx`, `src/components/site-header.tsx`, AI system prompts in `src/lib/ai.ts`.
- One Stripe account, one Printful account, one R2 bucket — all single env vars.
- R2 image keys: `designs/{designId}/{n}.png` — no tenant prefix.
- `auth` session carries `user.id` only; no tenant context propagated.

None of these are hard to change individually. The point is that there is no abstraction yet — each is its own line of code.

---

## "What's next" — tactical vs. architectural

Tactical (ship without locking strategy):

- Discount code UI on `/orders` and admin order detail.
- 1Password secret migration.
- `PRINTFUL_DRY_RUN` flag.
- Design conversation persistence after ordering (UX, no schema change).
- Mobile flow rethink (route/layout only).
- Product expansion (posters/hoodies) — same `PRODUCTS` config pattern.
- hledger export.
- Drag-and-drop upload bug.
- Rate limiting / generation caps.
- Next.js 16 middleware → proxy migration.

Architectural (defer until direction is set):

- **Shipping as a separate line item.** Decides whether shipping lives in COGS (current) or as its own ledger row. Affects discount math and any future recipient split (a percent-off code on a bundled total eats COGS first; on an itemized total it eats margin only). Worth deciding *before* introducing recipient splits, because recipient logic should run on margin, not on shipping.
- **Multi-placement.** Forces `order ↔ design` to become `order_item`. Does double duty as the schema shape needed for store catalogs and marketplace listings, so it's worth doing once with that future in mind.

Discount-code end-to-end testing itself is tactical — the plumbing is already in (`order.discountCode`, `order.discountAmount`, ledger uses actual paid amount). Resuming that work after this snapshot is fine.

---

## What this doc is not

Not a plan, not a recommendation of which surface to build first, not an estimate. It's a map of where ground truth and the strategic frame disagree, so the conversation can start from the same place.
