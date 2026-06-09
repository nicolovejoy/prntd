# Guest funnel + multi-item cart (#26 umbrella)

Two shippable stages. Stage A opens the whole funnel to signed-out visitors
(gate moves to the purchase point); Stage B builds the multi-item cart on top.
Decisions locked with Nico 2026-06-08:

- **Guest identity:** Better-Auth `anonymous` plugin (real lightweight `user`
  row per guest browser; existing `NOT NULL userId` FKs keep working).
- **Claim on sign-in:** plugin's `onLinkAccount` re-parents the guest's rows to
  the real account, then the plugin deletes the anonymous user.
- **Abuse guard:** per-session + per-IP daily generation cap, shipped *with* the
  ungating (ungated generation = real Replicate/Anthropic spend).
- **Gate:** moves to the checkout action; `/designs`, `/orders`, `/admin` stay
  account-gated (personal records).
- **Item mix (Stage B):** both same-design-multiples and different-designs.
- **Cart entry (Stage B):** persistent cart.
- **Flag:** whole thing behind `GUEST_FUNNEL_ENABLED` (default off), flipped on
  in prod after local verify, like `MULTI_PLACEMENT_ENABLED`.

## Stage A — open funnel + guest identity + abuse guard

### A1 — anonymous identity wiring
- `auth.ts`: add `anonymous({ onLinkAccount })` to plugins. `onLinkAccount`
  re-parents `design.userId` + `order.userId` (and `cart.userId` once B exists)
  from `anonymousUser.user.id` → `newUser.user.id` **before** the plugin deletes
  the anon user. (design_image / chat_message follow via designId.)
- `auth-client.ts`: add `anonymousClient()`.
- `schema.ts`: add `user.isAnonymous` (boolean, nullable/default false — the
  plugin's required column). Push to dev DB; later to prod.
- Plugin behavior confirmed from source (better-auth 1.5.6): `/sign-in/anonymous`
  creates `user{isAnonymous:true, email:temp@<id>.com, name:"Anonymous"}`; the
  post-sign-in/up `after` hook calls `onLinkAccount` then deletes the anon user
  unless same-user. Re-parent timing is correct inside `onLinkAccount`.

### A2 — open the middleware + move the gate
- `middleware.ts`: drop `/design`, `/preview`, `/order` from `protectedRoutes` +
  `matcher` (keep `/designs`, `/orders`, `/admin`). Guard the whole thing behind
  `GUEST_FUNNEL_ENABLED` — when off, keep today's protected list.
- Mint the anon session lazily: first guest action needing a `userId` (first
  chat/generate) triggers `authClient.signIn.anonymous()` client-side before the
  server action runs. Server actions stop throwing "Unauthorized" for anon users
  on the design/preview/order surface; checkout still requires a *non-anon* user.
- Checkout gate: `createCheckoutSession` / `buyPublishedDesign` return a
  `needsAuth` signal when the session user is anonymous → client routes to
  `/sign-in?next=<return>`; after auth the link hook claims everything and
  checkout resumes.

### A3 — abuse guard (same PR)
- New `generation_usage` table: `(id, identityKey, kind, day, count)` where
  `identityKey` is the anon/real user id and a second row keys on IP. Increment
  in `generateDesign` / `compareGenerators` before the model call.
- Over the daily cap (env-tunable, e.g. `GUEST_GEN_DAILY_CAP=8`) → return a
  "sign in to keep designing" result, no API spend. Authed users get a higher
  cap (`USER_GEN_DAILY_CAP`).
- Pure `checkAndCountGeneration(...)` helper, unit-tested (cap math, window
  rollover, IP-vs-identity).

### A4 — verify
- Playwright on local `npm run dev`: incognito guest → generate (hits cap at N)
  → preview → pay → sign-in → designs + in-progress order claimed and visible in
  `/designs` + `/orders`.

## Stage B — multi-item cart (#26)

### B1 — data model
- New `order_item` child table: `(id, orderId, productId, size, color,
  placements json, itemPrice, printfulCost, createdAt)`. `order` keeps
  order-level totals + shipping + ledger linkage. Migration, no backfill (single
  spots in `checkout.ts`/`printful.ts`/webhook flagged in #11's 1D work).
- New `cart` / `cart_item` tables (or a single `cart_item` keyed by userId) so a
  guest cart survives the sign-in claim. Account-tied via the anon user row.

### B2 — live Printful shipping quote (deferred here from #11)
- `printful.ts`: `estimateCosts({ recipient?, items })` → `/orders/estimate-costs`;
  returns bundled shipping for N items. `estimateShipping` swaps the
  `FLAT_SHIPPING_USD` constant for the quote (keep flat as the fallback when the
  estimate call fails / address unknown — hosted Stripe can't re-quote post-
  address anyway, so quote at cart time on a default destination).

### B3 — cart UX (phone-first)
- Persistent cart surviving `/design` ↔ `/preview`; add-from-preview +
  buy-panel; cart review page (qty, remove, edit size/color/back); running total
  with the bundled-shipping savings surfaced ("add another, shipping barely
  moves").

### B4 — checkout fan-out
- `buildCheckoutSessionParams`: N line items + one bundled `shipping_option`
  (still promo-excluded).
- `printful.createOrder`: N-item array, each item its own variant + files.
- webhook: resolve placements + COGS per `order_item`; ledger `sale`/`cogs`
  reconcile at the order level.

### B5 — tests
- Extend `money-path.integration.test.ts`: per-item sale sum, shipping charged
  once per order, bundled-quote shape, claim-on-sign-in re-parents cart + order.

## Build order
A1 → A2 → A3 → A4 (ship Stage A, flag on, watch the bill), then B1 → … → B5.
Stage A merges independently before Stage B starts.
