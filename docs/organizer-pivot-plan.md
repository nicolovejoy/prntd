# Organizer pivot — phased TDD implementation plan

2026-06-18. Build plan for the positioning pivot (`docs/positioning-pivot.md`) and
the object model in `docs/design-system.md`. Phone-first, test-first.

## Object model (settled 2026-06-18)

Top (PRNTD catalog) to bottom (organizer's shop). Printful's nouns adopted where
they have them — research in the PR thread; sources: developers.printful.com v1 +
v2-beta, Printful Help Center.

**Catalog — PRNTD-owned**

- **Product offering** *(our noun)* — a category of blanks with an **availability
  window** (new / seasonal / expiring). Maps to Printful's **category**
  (`catalog-categories`, nestable via `parent_id`); the dated window is ours
  (Printful categories have none). Generalizes today's `discontinued` flag.
- **Blank** = Printful **catalog product** (`catalog-products/{id}`). The rename of
  today's `Product` type in `products.ts`. Keeps `printfulProductId` as the join
  key (Printful's own term for a blank is "product", so that field name stays).
  - **Variant** — color × size SKU (`catalog-variants`). Already modeled.
  - **Placement** — adopt Printful's exact keys: `front_large` (⚠️ not today's
    stale `"front"`), `back`, `sleeve_left`, `sleeve_right`, `label_inside`,
    `label_outside`. Each carries **technique** (`dtg` default; also `embroidery`,
    `sublimation`, `cut-sew`, `uv`, `digital`, `dtfilm`), print-area inches,
    printfile pixels, and **DPI**.

**Organizer-owned**

- **Design** — artwork: the PNG + real pixel dims + transparency flag + aspect.
  (Today's `design` / `design_image`; pixel-res and alpha flag are new metadata.)
- **Product** — Design × Blank × Placement(s) + price. The new *persisted*
  sellable; today this config is assembled at `/preview → /order` and thrown away.
  One design → many products.
- **Collection** *(backlog, no build)* — a grouping of products for any reason
  (girls/boys team, last-year's-vs-this-year's), discount optional, **no URL**.
- **Store** — the shareable shop with a public URL. **Many per organizer,
  optimized for one** (model supports N; UX defaults hard to one).

### The validity rule

A **Product is valid** iff, for its chosen placement on its blank:

1. the placement exists on the blank (`productSupportsPlacement`);
2. the design's technique-suitability matches the placement's **technique**;
3. `design pixels ÷ print-area inches ≥ placement DPI` (resolution check — new;
   today DPI is implicit and never validated);
4. aspect within tolerance (existing `needsAspectRegeneration`, 1.5× threshold);
5. if `dtg` on a colored variant, the design has transparency (the knockout we
   already do).

Pure function of (design props, placement constraints) — the testable core.
**Policy: warn + auto-remediate, never hard-block** — a non-designer organizer
gets "this needs reshaping for the mug → fix it" (regenerate at right aspect /
knockout), not a dead end.

### Catalog gaps to close (`products.ts`, all additive / v1-safe except 4)

1. add **`technique`** to `Placement` (default `"dtg"`);
2. add **`dpi`** to placement geometry + validate source resolution against it;
3. add a **product-offering / category** layer above blanks (today's `Product.type`
   is a hand-rolled stand-in);
4. migrate literal `"front"` → `"front_large"` — coupled to a v1→v2 Printful API
   move; v1 still accepts `"front"` for our three shirts, so **not urgent**.

---

## Ground rules

- **TDD.** Tests first. Pure helpers get unit tests; anything touching the DB uses
  the real-DB integration pattern (`src/lib/__tests__/test-db.ts` derives DDL from
  `schema.ts` via `drizzle-kit/api` — always current, FKs enforced). Never mock the
  DB for money or ownership logic.
- **Phone-first.** Build the phone layout first; widen for desktop. Not done until
  driven on a Pixel-7 viewport (Playwright project exists in `e2e/`). Targets ≥44px.
- **Flag-gated.** New customer-facing surfaces ship behind `STORES_ENABLED`
  (pattern: `GUEST_FUNNEL_ENABLED`, `CART_ENABLED`). Merge dark, flip when verified.
- **Versioned migrations.** `db:generate` → review SQL in PR → `db:migrate` with
  inline prod creds. **Never `db:push` to prod** (dev-only). See CLAUDE.md.
- **Read framework docs first.** Per `AGENTS.md`, before any route / middleware /
  server-action code read the relevant guide under `node_modules/next/dist/docs/`.
  This is Next.js 16 — don't trust memorized APIs.

Phases ordered so value lands early and the riskiest schema work is isolated.
**Phase 0 ships standalone** (the mobile fix, no schema). **Phase 0.5 (rename)
precedes all schema work** so "product" is free for the organizer sellable.

---

## Phase 0 — Tappable chat options (the mobile fix)

**Why first:** highest-value, persona-independent, no schema. Kills the "list looks
like buttons but you must type a number" bug.

**Bug, precisely:** `ai.ts` CHAT_SYSTEM_PROMPT (~L27-30) tells Claude to *number*
options; `chat-panel.tsx:256` renders the reply as inert markdown; no quick-reply
component exists. The composer also crams 5 controls into one non-wrapping flex row
(`chat-panel.tsx:297`).

**Approach:** the reply is already a JSON envelope (`extractChatEnvelope`,
`chatAboutDesign` → `{message, readyToGenerate}`). Add optional
`options: {label, value}[]`. The model fills it for multiple-choice questions; the
UI renders tappable `QuickReply` chips; tap submits `value` as the user's turn.
Stop instructing numbered prose.

**Tests first**

- `extractChatEnvelope` parses `options`; tolerates absent (back-compat); salvages
  from mixed prose+JSON (existing failure mode).
- `buildMessages` strips embedded option-blocks from assistant history (same
  cascade fix already done for envelopes — don't teach the model to re-emit them).
- Pure `quickReplyFromOptions` mapper (empty / over-long label handling).
- `QuickReply` component: renders ≥44px chips; tap fires `onSelect(value)`.

**Build**

1. `QuickReply` in `src/components/ui/` + index export + test.
2. Envelope type + parser in `ai.ts`; CHAT_SYSTEM_PROMPT + READINESS_SYSTEM_PROMPT
   return structured `options` instead of numbered prose.
3. `chat-panel.tsx`: render `options` as a chip row under the assistant bubble; tap
   submits the turn.
4. Composer relayout: one input + one primary (Send/Draw-it merged per design
   system), Compare demoted to overflow. Phone row wraps; ≥44px targets.

**Done:** on Pixel-7, a style question yields tappable chips; no numbered-list
typing; composer doesn't overflow. Playwright mobile spec covers tap-to-answer.

---

## Phase 0.5 — Rename `product` → `blank` (standalone, no behavior change)

**Why:** frees the noun "product" for the organizer's sellable before any schema
uses it. Pure mechanical rename; merge-before-Phase-1.

**Scope (code symbols only — NOT DB columns, NOT `printfulProductId`)**

- `products.ts` → `blanks.ts`; `Product` type → `Blank`; `ProductColor` →
  `BlankColor`; `PRODUCTS` → `BLANKS`; `ACTIVE_PRODUCTS` → `ACTIVE_BLANKS`;
  `DEFAULT_PRODUCT_ID` → `DEFAULT_BLANK_ID`; `getProduct[OrThrow]` →
  `getBlank[OrThrow]`. Update ~18 importer files.
- **Leave alone:** `printfulProductId` (Printful's own term for a blank), and the
  DB columns `order.product_id` / `design_image.product_id` / `order_item.*` /
  `cart_item.*` (renaming columns is a separate, later, destructive migration —
  documented as "stores a blank id" for now).

**Tests:** the full suite + `build` are the spec — a pure rename keeps every test
green. No new tests; CI proves no behavior changed.

**Done:** lint + 238-ish tests + build green; zero functional diff; "product" no
longer means a blank anywhere in code.

---

## Phase 1 — Store + product object model (schema only, no UI)

**Why isolated:** the migrations. Land + prove zero-drift before any surface
depends on them.

**New tables** (`src/lib/db/schema.ts`):

```
store
  id            text pk
  ownerId       text  → user.id      (re-parented on claim, like design/order)
  slug          text  unique          url-safe; slugify(name) + collision suffix
  name          text
  description    text  nullable
  accentColor   text  nullable         the one per-store brand color
  status        enum  draft|live|hidden  default draft
  createdAt, updatedAt

product_offering                        (catalog category + availability window)
  id            text pk
  name          text
  printfulCategoryId  int  nullable     join to Printful catalog-categories
  availableFrom integer timestamp nullable
  availableUntil integer timestamp nullable   null = always on
  sortOrder     int  default 0
  createdAt, updatedAt

product                                 (organizer's sellable: design × blank × placements)
  id            text pk
  ownerId       text  → user.id        (re-parented on claim)
  storeId       text  → store.id  nullable   loose products allowed
  designId      text  → design.id
  blankId       text                    catalog blank id (e.g. "bella-canvas-3001")
  placements    json  {placementKey: imageId}   front_large/back/… → design_image
  price         real  nullable          organizer override; null = computed default
  status        enum  draft|listed|hidden  default draft
  position      int   default 0
  createdAt, updatedAt
```

Order linkage (Phase 3, but additive now): nullable `order.storeId`,
`order.productId` *(the new product, distinct from the blank — naming resolved by
Phase 0.5)* so a sale attributes to a store + product.

**Tests first** (real-DB integration via `test-db.ts`)

- store: slug uniqueness; FK to user; status default `draft`.
- product: FK to design + store; placements JSON round-trips; loose product
  (`storeId` null) allowed; reject a blank the design's owner can't use.
- **validity helper** (pure, no DB): `validateProduct(design, blank, placement)` →
  the 5-rule matrix above; warns (not throws) with a remediation hint.
- `slugify(name)`: collision suffixing, unicode/emoji strip, max length.
- re-parent: a guest's store + product move to the real account on
  `onLinkAccount` (extend the existing claim test in `auth`).

**Build:** schema edit → `db:generate` (review `000N_*.sql` in PR) → migrate dev
only. **No prod migrate until a UI phase flips the flag.** Extend `onLinkAccount`
(`auth.ts`) to re-parent `store` + `product` alongside design/order/cart. Add
`technique` + `dpi` to the `Placement` type + `validateProduct` helper in
`blanks.ts`.

**Done:** integration tests green; migration SQL reviewed; dev DB has the tables;
claim re-parents stores + products.

---

## Phase 2 — Organizer setup flow (`STORES_ENABLED`, default off)

**Why:** the primary entry point — name a shop, add products, get a link.

**Surfaces**

- `/dashboard` — organizer back office. Shop card with **Copy link** (the
  load-bearing control), sales summary, products-in-shop manager, **Create a shop**
  primary. Defaults to the single store; "create another" only when >0 exist.
- Store create/edit — name, slug (auto, editable), accent color (from the shirt
  palette).
- Product compose — pick a design, a blank, placement(s), price; live validity
  (warn + fix). Reuses `/preview` mockup machinery.
  - **Design source (decided 2026-06-24): A-first-then-B.** Slice 2 ships the
    picker over the **organizer's own design threads only** (single-owner R2,
    no attribution tangle, reuses existing render/submit paths). Structure the
    picker + `createProduct` so a later widening to **any published design** (B)
    is an additive source, not a rewrite — same isolation #6 used. B is gated on
    the designer royalty/credit + status-flip-edge decisions still open from #6,
    so it does not block the compose UI.
  - **Price (decided 2026-06-24): floor-guarded, soft-warn (option B).** The
    organizer sets the price; the form shows live **suggested price, est. org
    proceeds, and a floor**, and warns below the floor (never hard-blocks — the
    warn+fix policy). The proceeds math is the economics section below.
- `actions.ts`: `createStore`, `updateStore`, `createProduct`, `updateProduct`,
  `addProductToStore`, `reorderProducts`, `getMyStores`, `getStore`.

**Tests first**

- Pure: `slugify`, `storeShareUrl(slug)` off request origin (NOT hardcoded
  `NEXT_PUBLIC_APP_URL` — the preview-checkout-bounces-to-prod lesson),
  `canManageStore(user, store)` ownership guard, `validateProduct` in the compose UI.
- Integration: createStore writes a draft + unique slug; createProduct rejects an
  unowned design; reorder persists.
- Playwright (mobile + desktop): create shop → add two products → copy link →
  link resolves. Anonymous organizer builds a shop; it claims on sign-up.

**Build:** read `node_modules/next/dist/docs/` for App-Router route + server-action
specifics first. Phone layout first. Nav gains **Dashboard** for organizers.

**Done:** an organizer on a phone makes a named shop, adds products, copies a
working link; anon→account claim verified; flag still off in prod.

**Slice 2 status (2026-06-24).** Compose flow built behind `STORES_ENABLED`:

- ✅ **2b.1 proceeds core** (`pricing.ts`, pure): `PRNTD_OPS_FEE` $1, `MIN_ORG_PROCEEDS`
  $5, `computeProceeds` / `priceForProceeds` / `minViablePrice` / `suggestedPrice`;
  `calculateStripeFee` moved here as the single source (ledger re-exports).
- ✅ **2b.2 compose COGS + validity glue**: `estimateComposeCogs` (destination-free
  baseCost+shipping proxy); `product-compose.ts` `checkProductFit` feeds
  `validatePlacementFit` from the aspect `design_image` persists today (pixel/alpha
  deferred → non-warning sentinels).
- ✅ **2b.3 service**: `updateProduct` + `getProductById`, owner-guarded.
- ✅ **2b.4 actions**: `getComposableDesigns` (own designs = source A),
  `createProductDraft`, `saveProduct`, `getProductDraft`.
- ✅ **2b.5 compose UI** `/dashboard/products/new`: design × blank × placement ×
  size/color × price; live validity (warn+fix) + live proceeds breakdown computed
  client-side from the pure helpers; below-floor soft-warn; suggested-price prefill;
  "Add product" on each store card. Preview = artwork-on-blank-color.
- ⏭️ **2b.6 store edit** (name/accent/slug) — `updateStore` exists; UI not built.
- ⏭️ **2b.7 Playwright** — needs a signed-in (claimed, non-anon) e2e helper +
  store seed; harness `STORES_ENABLED` flag added. Compose needs a real account,
  which the current anon-only e2e helpers don't mint.
- ⏭️ **Follow-up:** embed the real Printful `/preview` mockup in the compose
  preview (currently artwork-on-color); product edit page (reuse the new form);
  capture design pixel-dims + alpha so the DPI/knockout validity rules light up.

---

## Phase 2 economics — proceeds split (decided 2026-06-24)

The organizer flow **inverts** the consumer model. Consumer flow: prntd sets the
price (`baseCost × 1.5`) and keeps all margin. Organizer flow: the **organizer
sets the price**, prntd takes a **fixed $1/product ops fee**, and **everything
above costs flows to the organizer's org** (soccer team, PTA, nonprofit).

**Per-product money flow** (one shirt sold):

```
Customer pays        = P (organizer's item price) + $4.69 shipping
  − Stripe fee       = 2.9% × (P + 4.69) + $0.30        (cc processing; ledger.ts)
  − COGS             = Printful invoice total            (garment + print + Printful ship + Printful tax)
  − PRNTD ops fee    = $1.00                             (fixed; first pass — PRNTD_OPS_FEE constant)
  ─────────────────────────────────────────────
  = Org proceeds     → the organizer's org              (floor-guaranteed ≥ $5 — MIN_ORG_PROCEEDS)
```

Things that matter for getting the math right:

- **No separate customer sales tax.** Per the 1C tax policy, prntd does not
  collect customer tax (`automatic_tax` off). The only tax in the math is
  *Printful's*, already inside COGS. So "tax" is **not** a fourth deduction —
  don't double-count it.
- **Shipping ≈ pass-through.** We charge $4.69; Printful's real ship cost sits
  inside COGS, so net ≈ $0. Kept a separate Stripe line so a % promo never eats
  it (the 1B margin fix).
- **COGS is only exact after fulfillment.** At compose + checkout we have an
  *estimate* (`/orders/estimate-costs`); the real figure lands on the invoice
  post-submission. The org-proceeds figure shown to the organizer is therefore
  an **estimate**, reconciled to actual at payout. Compose UI labels it "≈".

**Worked example** — Bella 3001, M, single front print, organizer prices at **$25**:

```
Customer pays     $25.00 + $4.69  = $29.69
Stripe fee        2.9% × 29.69 + 0.30 = $1.16
COGS (est.)       ~$17.50   (garment+print ~$12.95 + Printful ship ~$4.55 + tax)
PRNTD ops fee     $1.00
────────────────────────────────────────
Org proceeds      ≈ $10.03  → soccer team
```

**Floor (the soft-warn threshold).** The floor is the price at which org proceeds
hit the **$5 minimum** (`MIN_ORG_PROCEEDS`) — not $0. Below it, the org earns less
than a worthwhile-per-shirt fundraise (and below ~$14.68 prntd would actually
subsidize the sale). Solving the flow for this blank, the $5-floor lands near
**$19.82**; below that the form warns "At this price your team receives less than
$5.00," but still lets it through (warn+fix, never block). The compose form shows,
live as the organizer types: **suggested price · est. org proceeds · floor.**

Worked floor: `P ≥ (COGS + 1.746) / 0.971` to clear $5 to the org (derived from
the flow above: the `0.971` is `1 − Stripe 2.9%`; the `1.746` folds in the $0.30
Stripe fixed fee, the $1 ops fee, the $5 minimum, less the shipping pass-through).

**Open (not slice-2 blockers):**

- **Payout mechanism** — how proceeds actually reach the org (Stripe Connect
  transfer per sale? periodic manual payout? hold-to-threshold?). Slice 2 only
  *computes + displays* the split; moving money is its own phase.
- **Both floors are starting knobs,** not load-bearing — `PRNTD_OPS_FEE` ($1, the
  prntd cut) and `MIN_ORG_PROCEEDS` ($5, the guaranteed-to-the-org floor). Keep
  each a single named constant, one-line tunable like `BACK_PLACEMENT_UPCHARGE`.
  `PRNTD_OPS_FEE` could become a % later.
- **Per-org receipting** (nonprofit donation receipts / 1099s) — out of scope,
  flagged for later.

---

## Phase 3 — Buyer storefront (`STORES_ENABLED`)

**Why:** the shared link's destination. Generalizes `/prints` + `/d/[imageId]` to
one organizer's shop.

**Surfaces**

- `/shop/[slug]` — shop header (name, accent, one line), product grid, per-product
  buy (size/color/price), one **Buy** primary. Account demanded only at checkout
  (anonymous plugin). No studio chrome.
- Reuse `BuyPanel`, `SizePicker`, `ColorPicker`, `computeOrderTotal`, the checkout
  choke point (`createStripeCheckoutForOrder` / `buildCheckoutSessionParams`) — the
  buy path is solved; this scopes it to a store and tags the order with
  `storeId` + `productId`.

**Tests first**

- Pure: `getShopListings(slug)` assembly; store visibility (`canViewStore` — draft
  hidden, live public); price unchanged from `computeOrderTotal`.
- Integration (extend `money-path.integration.test.ts`): buy a product from a store
  → order carries `storeId`/`productId` → webhook → ledger sale/fee/cogs, one
  shipping line. Attribution: buyer + organizer + original designer.
- Playwright: open `/shop/[slug]` cold (signed out) → pick size → checkout gate →
  sign in → order lands in buyer's `/orders`.

**Build:** buyer sees only the shop. Confirm bundled-shipping invariant (one
shipping line per order, not per item) — the #26 contract test already locks it.

**Done:** a buyer purchases from a shared link end-to-end on a phone; order
attributes to the organizer; money path integration-tested; flag flippable.

---

## Phase 4 — Brand / persona polish

**Why last:** needs the flows to exist before copy + homepage can be concrete —
Manine's whole point.

- Homepage three-state branch (unrecognized → "set up a shop" + a real example;
  recognized organizer → dashboard; buyer → design/browse). Tested pure function of
  (session, role, has-store).
- Newman's-Own voice pass on shop-setup + storefront copy (Manine reviews against
  live shops, not an abstract doc).
- Badge palette 11 hues → 4 semantic tokens; per-store accent token.
- Nav IA finalized: Dashboard-first for organizers.

---

## Sequencing & risk

- **Ship order:** 0 → 0.5 → 1 → 2 → 3 → 4. Phase 0 is independent and ships
  immediately; 0.5 is a pure rename that must precede schema.
- **Riskiest:** Phase 1 migration (isolated) and Phase 3 money path (covered by the
  real-DB pattern — the one place we never mock).
- **Reuses, doesn't rebuild:** anonymous-plugin claim, checkout choke point,
  pricing, bundled shipping, ledger, BuyPanel, product options, mockup machinery —
  all shipped. The pivot is mostly a new *grouping* (store + product) and a new
  *entry point*, not new commerce.
- **Prod migrate discipline:** back up (`turso db create prntd-backup-<date>
  --from-db prntd`), `migration-smoke.ts before|after`, then inline-cred
  `db:migrate`. Manual, not fire-on-merge.

## Open product questions (don't block the build)

1. Does "Fresh Prints" (the global feed) survive as a curated house store, or
   retire for per-organizer shops?
2. Collections — surface multi-store membership, or keep one-to-one in UI for now?
3. ~~Proceeds / pro-social mechanic~~ **RESOLVED 2026-06-24** — see "Phase 2
   economics" above. Organizer sets price; prntd takes a fixed $1/product ops fee;
   remainder after Stripe + COGS flows to the org. Floor-guarded soft-warn. Open
   sub-item moved there: the payout *mechanism* (how money reaches the org).
4. Embroidery / non-DTG blanks — the `technique` field is in from Phase 1, but the
   first embroidery offering is its own product+UX effort.
5. `/design` "Generations" column — IA + naming both wrong under the pivot (raised
   2026-06-18, live on the Phase 0 build). The word is generator-jargon; worse, the
   column is dead space on an empty design ("No images yet") and its role — a
   gallery of renders you pick from to "make products" — is the exact seam the
   pivot reshapes (design → *product* = design × blank × placements). Decide what
   the column *is* and when it appears, not just a rename. Persona/IA-dependent →
   resolve with Manine, not ahead of her. A neutral rename ("Drafts"/"Versions") is
   a safe stopgap if it grates before then.
