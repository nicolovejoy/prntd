# Organizer pivot — phased TDD implementation plan

2026-06-18. The build plan for the positioning pivot (`docs/positioning-pivot.md`)
and the design system it implies (`docs/design-system.md`). Phone-first, test-first.

**Ground rules**

- **TDD.** Every phase lists its tests first. Pure helpers get unit tests; anything
  touching the DB uses the real-DB integration pattern (`src/lib/__tests__/test-db.ts`
  derives DDL from `schema.ts` via `drizzle-kit/api` — no migration files, always
  current, FKs enforced). Don't mock the DB for money or ownership logic.
- **Phone-first.** Build the phone layout first, widen for desktop. A phase isn't
  done until it's been driven on a Pixel-7 viewport (Playwright project already
  exists in `e2e/`). Touch targets ≥ 44px.
- **Flag-gated.** Each customer-facing phase ships behind an env flag (pattern:
  `GUEST_FUNNEL_ENABLED`, `CART_ENABLED`). New: `STORES_ENABLED`. Merge dark, flip
  when verified.
- **Migrations are versioned.** Schema changes go `db:generate` → review SQL in PR
  → `db:migrate` with inline prod creds. **Never `db:push` to prod** (dev-only). See
  CLAUDE.md "Migration discipline."
- **Read the framework docs first.** Per `AGENTS.md`, before writing any route /
  middleware / server-action code, read the relevant guide under
  `node_modules/next/dist/docs/`. This is Next.js 16 — don't trust memorized APIs.

The phases are ordered so value lands early and the riskiest schema work is isolated.
**Phase 0 ships standalone** — it's the mobile fix and needs none of the store work.

---

## Phase 0 — Tappable chat options (the mobile fix)

**Why first:** highest-value, persona-independent, no schema. Kills the "list that
looks like buttons but you must type a number" bug. Ships ahead of everything else.

**The bug, precisely:** `ai.ts` (CHAT_SYSTEM_PROMPT ~L27-30) tells Claude to *number*
options; `chat-panel.tsx:256` renders the reply as inert markdown via `react-markdown`;
no quick-reply component exists. User must type a digit. The composer also crams 5
controls into one non-wrapping flex row (`chat-panel.tsx:297`).

**Approach:** the chat reply is already a JSON envelope (`extractChatEnvelope`,
`chatAboutDesign` return `{message, readyToGenerate}`). Extend the envelope with an
optional `options: {label, value}[]`. The model populates it when it asks a
multiple-choice question; the UI renders tappable `QuickReply` chips; tapping one
submits `value` as the user's turn. Stop telling the model to number things in prose.

**Tests first**

- `extractChatEnvelope` parses `options` when present; tolerates absent (back-compat);
  salvages from mixed prose+JSON output (existing failure mode).
- `buildMessages` strips embedded option-blocks from assistant history (don't teach
  the model to re-emit them as text — same cascade fix already done for envelopes).
- Pure: a `quickReplyFromOptions` mapper (option → chip props), incl. empty/over-long
  label handling.
- Component test (`QuickReply`): renders ≥44px chips, tap fires `onSelect(value)`.

**Build**

1. `QuickReply` in `src/components/ui/` + index export + test.
2. Envelope type + parser changes in `ai.ts`; update CHAT_SYSTEM_PROMPT to return
   structured `options` instead of numbered prose; update READINESS_SYSTEM_PROMPT's
   "3-5 style examples" the same way.
3. `chat-panel.tsx`: render `options` as a QuickReply row under the assistant bubble;
   tapping submits the turn. Remove reliance on numbered markdown.
4. Composer relayout: one input + one primary ("Draw it" / Send merged per design
   system), Compare demoted to overflow/gallery. Phone row wraps; ≥44px targets.

**Done when:** on a Pixel-7 viewport, asking the assistant a style question yields
tappable chips; no numbered-list typing anywhere; composer doesn't overflow. Playwright
mobile spec covers the tap-to-answer path.

---

## Phase 1 — Store data model (schema only, no UI)

**Why isolated:** the one migration. Land it, prove zero-drift, before any surface
depends on it.

**Schema** (`src/lib/db/schema.ts`): new `store` table —

```
store
  id            text pk
  ownerId       text  → user.id   (the organizer; re-parented on claim like design/order)
  slug          text  unique, url-safe
  name          text
  description    text  nullable
  accentColor   text  nullable    (the one per-store brand color)
  status        enum  draft | live | hidden   default draft
  createdAt, updatedAt
```

Linking designs → store. Decision: **join table `store_listing`** (not a `storeId`
on `design`) so a design can appear in more than one store and a store can order its
listings independently of design identity:

```
store_listing
  id          text pk
  storeId     text → store.id
  designId    text → design.id
  imageId     text → design_image.id   (the exact published image to sell)
  position    int                       (manual ordering)
  createdAt
  unique(storeId, imageId)
```

**Tests first** (real-DB integration, `test-db.ts`)

- Create store; slug uniqueness enforced; FK to user enforced.
- Add/remove listings; `unique(storeId, imageId)`; cascade/cleanup on design delete.
- Re-parent: a guest's store + listings move to the real account on `onLinkAccount`
  (extend the existing claim test).
- Pure `slugify(name)` helper: collision suffixing, unicode/emoji stripping, max len.

**Build:** schema edit → `db:generate` (review the `000N_*.sql` in the PR) → migrate
dev. **No prod migrate until a UI phase is ready to flip.** Extend `onLinkAccount`
(`auth.ts`) to re-parent `store` + `store_listing`.

**Done when:** integration tests green; migration SQL reviewed; dev DB has the tables;
claim re-parents stores.

---

## Phase 2 — Organizer setup flow (`STORES_ENABLED`, default off)

**Why:** the primary entry point. Create a named shop, add designs, get a link.

**Surfaces**

- `/dashboard` — organizer back office. Shop card with **Copy link** (the load-bearing
  control), sales summary, designs-in-shop manager, **Create a shop** primary.
- Store create/edit — name, slug (auto from name, editable), accent color (from the
  shirt palette), add listings from the user's designs.
- `actions.ts`: `createStore`, `updateStore`, `addListing`, `removeListing`,
  `reorderListings`, `getMyStores`, `getStore`.

**Tests first**

- Pure: `slugify` (from Phase 1), share-link builder (`storeShareUrl(slug)` off
  request origin, not hardcoded `NEXT_PUBLIC_APP_URL` — the preview-checkout-bounces-
  to-prod lesson), `canManageStore(user, store)` ownership guard.
- Integration: createStore writes a draft + unique slug; addListing rejects an image
  the user doesn't own; reorder persists position.
- Playwright (mobile + desktop): create shop → add two designs → copy link → link
  resolves. Anonymous organizer can build a shop and it claims on sign-up.

**Build:** read `node_modules/next/dist/docs/` for App-Router route + server-action
specifics first. Phone layout first. Anonymous-plugin lets an organizer build before
signing up; checkout/sign-up triggers claim. Nav gains **Dashboard** for organizers
(IA in the design system).

**Done when:** an organizer on a phone makes a named shop, adds designs, copies a
working link; anon→account claim verified; flag still off in prod.

---

## Phase 3 — Buyer storefront (`STORES_ENABLED`)

**Why:** the shared link's destination. Generalizes `/prints` + `/d/[imageId]` to one
organizer's shop.

**Surfaces**

- `/shop/[slug]` — shop header (name, accent, one line), listing grid, per-listing
  buy (size/color/price), one **Buy** primary. Account demanded only at checkout
  (anonymous plugin). No studio chrome.
- Reuse `BuyPanel`, `SizePicker`, `ColorPicker`, `computeOrderTotal`, the existing
  checkout choke point (`createStripeCheckoutForOrder` / `buildCheckoutSessionParams`)
  — the buy path is solved; this scopes it to a store and tags the order with `storeId`.

**Tests first**

- Pure: `getShopListings(slug)` view assembly; sold-out / hidden / draft store
  visibility rules (`canViewStore`); price unchanged from `computeOrderTotal`.
- Integration (real-DB money path, extend `money-path.integration.test.ts`): buy a
  listing from a store → order carries `storeId` → webhook → ledger sale/fee/cogs,
  one shipping line. Attribution: order records buyer + organizer + original designer.
- Playwright: open `/shop/[slug]` cold (signed out) → pick size → checkout gate →
  sign in → order lands in buyer's `/orders`.

**Build:** add nullable `order.storeId` (additive migration, same discipline). Buyer
sees only the shop. Confirm bundled-shipping invariant holds (one shipping line per
order, not per item) — the #26 contract test already locks this.

**Done when:** a buyer purchases from a shared shop link end-to-end on a phone; order
attributes to the organizer; money path integration-tested; flag flippable.

---

## Phase 4 — Brand / persona polish

**Why last:** needs the flows to exist before copy and the homepage can be concrete —
which was Manine's whole point.

- Homepage three-state branch (unrecognized → "set up a shop" + real example;
  recognized organizer → dashboard; buyer → design/browse). Tested branch, not ad hoc.
- Newman's-Own voice pass on shop-setup + storefront copy (Manine reviews concretely
  against live shops, not an abstract doc).
- Badge palette 11 hues → 4 semantic tokens; per-store accent token.
- Nav IA finalized: Dashboard-first for organizers.

**Tests:** homepage-state selection is a pure function of (session, role, has-store) →
unit-tested. Visual/copy is Manine's review loop, not an automated gate.

---

## Sequencing & risk

- **Ship order:** 0 → 1 → 2 → 3 → 4. Phase 0 is independent and ships immediately.
- **Riskiest:** Phase 1 migration (isolated on purpose) and Phase 3 money path
  (covered by the real-DB integration pattern, the one place we never mock).
- **Reuses, doesn't rebuild:** anonymous-plugin claim, checkout choke point, pricing,
  bundled shipping, ledger, BuyPanel, product options — all already shipped. The pivot
  is mostly a new *grouping* (the store) and a new *entry point*, not new commerce.
- **Prod migrate discipline:** back up (`turso db create prntd-backup-<date> --from-db
  prntd`), `migration-smoke.ts before|after`, then inline-cred `db:migrate`. Manual,
  not fire-on-merge.

## Open product questions (don't block Phase 0)

1. Does "Fresh Prints" (the global feed) survive as a curated house store, or retire
   in favor of per-organizer shops?
2. Can a design live in multiple shops (join table says yes) — surface it or keep it
   one-to-one in the UI for now?
3. Proceeds / pro-social mechanic (Newman's Own): does the organizer set a markup, a
   donation split, or is it flat? Pricing already supports a per-line markup; the
   policy is a Nico+Manine decision, not a code blocker.
