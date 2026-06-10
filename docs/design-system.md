# PRNTD Design System — first draft

2026-06-10. Drafted for the UX rethink with Manine. Two halves: (1) a proposed
design language + vocabulary, (2) a full component inventory per page, ranked
by how critical each component is to that page's job. The language section is
a proposal to push against, not documentation of the status quo — divergences
from current code are marked **[gap]**.

---

## Part 1 — Design language

### Direction

PRNTD is a print shop. The interface is the shop counter: matte black, quiet,
monochrome. **The customer's artwork is the only color on the screen.** Every
hue the chrome claims for itself competes with the design being made, so the
chrome claims none. White is the accent; a primary action is an inversion
(paper-on-ink), not a colored button.

Three principles:

1. **Ink and paper.** Chrome is monochrome. Color belongs to generations,
   mockups, and product swatches only. (Current exception: status badge hues —
   see Gaps.)
2. **One primary per screen.** Each screen has exactly one inverted (white)
   button: the next step in the funnel. Everything else is outline or ghost.
   (Current violation: /design's composer offers Send / Draw it / Compare at
   equal-ish weight.)
3. **Phone-first, one column.** The phone layout is the design; desktop gets
   extra space, not extra features. Anything desktop-only (e.g. the
   Generations rail) must have a phone equivalent (the Sheet), not be dropped.

### Vocabulary

Shared nouns for design conversations. Code names in parentheses where they
differ.

**Objects**

- **Design** — a thread: the conversation plus all its generations. One row in
  `design`, one `/design?id=` URL.
- **Generation** — one numbered render inside a design (`design_image` row).
  Append-only; never replaced.
- **Print** — a published generation. Lives in the storefront, has a title,
  description, and backdrop. (`published_at` on `design_image`.)
- **Mockup** — a generation placed on a physical product (Printful render).
- **Product version** — a generation re-rendered for a specific product's
  print area (placement render).
- **Backdrop** — the shirt-palette color a Print is displayed on; checkerboard
  when unset.
- **Swatch** — a selectable product color circle.

**Places**

- **Studio** — `/design`. Where designs are made.
- **Storefront** — `/prints`, branded "Fresh Prints". Where Prints are browsed
  and bought.
- **Funnel** — Studio → Preview → Order → Confirm. Linear, breadcrumbed.
- **Shelf** — the personal archive: `/designs`, `/orders`.
- **Counter** — `/admin`. Back of shop.

**Surfaces & regions**

- **Stage** — the dominant artwork area of a screen (mockup hero on /preview,
  image on /d/[id]). One Stage per screen, as large as the viewport allows.
- **Composer** — the chat input row in the Studio (input + actions).
- **Rail** — the desktop Generations sidebar (320px, right).
- **Sheet** — a bottom drawer on phones (mobile gallery). The phone's Rail.
- **Lightbox** — full-screen image overlay with per-image actions.
- **Sticky bar** — the fixed bottom CTA bar on phone funnel pages (/order).
- **Chip** — a small pill-shaped tappable suggestion (example prompts, filter
  tabs).

**States**

- **Thinking** — waiting on a chat reply (~3–6s).
- **Drawing** — waiting on a generation (~6–15s). Always says "Drawing your
  design…", pulses.
- **Ready nudge** — the soft readiness signal: Draw it pops secondary→primary
  when the idea has subject + style. Never blocks.

### Tokens

Defined in `src/app/globals.css` (Tailwind v4 `@theme inline`). Semantic, not
literal — components must use these, never raw `gray-*` / hex.

Elevation (4 steps, all near-black):

```
--background      #0a0a0a   page
--surface         #111111   inputs, wells
--surface-raised  #1a1a1a   cards
(overlay)         black/90  modals, lightbox   [gap: not yet a token]
```

Line + text:

```
--border          #2e2e2e   resting
--border-hover    #444444   hover/focus
--foreground      #ededed   primary text
--text-muted      #999999   secondary text
--text-faint      #666666   tertiary/metadata
```

Accent:

```
--accent          #ffffff   the one inversion color
--accent-fg       #000000   text on accent
```

Utility: `.bg-checkerboard` — transparency indicator for raw PNGs (thumbnails,
unset backdrops).

Proposed additions **[gap]**:

```
--overlay         rgba(0,0,0,.9)   tokenize the modal scrim
--positive        green-400-ish    money-in, success (ledger, profit)
--negative        red-400-ish      money-out, destructive, errors
--attention       yellow-400-ish   pending states
```

…and collapse the 11 badge hues (see Gaps) onto those three plus neutral.

### Type

Geist Sans / Geist Mono are loaded and tokenized (`--font-sans`,
`--font-mono`) but **body currently renders Arial** — `body` in globals.css
overrides with `Arial, Helvetica, sans-serif`. **[gap — pick one and commit;
proposal: Geist.]**

Scale in use (Tailwind steps), proposed roles:

- `text-3xl/5xl bold` — page hero (h1 on home, /prints)
- `text-lg/xl semibold` — screen title
- `text-sm font-medium` — section labels, card titles
- `text-sm` — body, chat
- `text-xs text-text-muted` — metadata
- `text-xs text-text-faint` / `text-[10px]` — fine print, badges
- `font-mono` — IDs, codes, money references

### Component grammar

Five base components in `src/components/ui/` — the only sanctioned primitives:

- **Button** (`button.tsx`) — variants `primary` (inverted), `secondary`
  (outline), `danger` (outline, reddens on hover), `ghost`; sizes sm/md/lg.
  Rule: one `primary` per screen.
- **Badge** (`badge.tsx`) — pill, 11 status variants (see Gaps).
- **Card** (`card.tsx`) — `surface-raised` + border + rounded-lg.
- **Input** (`input.tsx`) — `surface` well, border-hover focus ring.
- **Modal** (`modal.tsx`) — black/90 scrim, Escape-closes (wins over
  Escape-to-go-up).

Composites built from these: `SizePicker`/`ColorPicker`
(`product-options.tsx`), `PublishModal`, `PublishedGrid`, `Breadcrumbs`,
`BuyPanel`.

Interaction grammar:

- Radius: `rounded-md` controls, `rounded-lg` cards/images, `rounded-full`
  chips/badges/FAB.
- Spacing: 4px base; `p-4` standard padding; `gap-2` within a control group,
  `gap-4` between groups.
- Touch targets ≥ 40px on phone (established rule).
- Motion: `transition-colors` on hover, `animate-pulse` for Drawing — nothing
  else. No entrance animations.
- Selection: accent ring/border (`border-accent` / `ring-accent`) marks the
  selected thumbnail, swatch, or product.
- Escape goes **up** one funnel level (breadcrumb parent); overlays eat the
  first Escape to close themselves.

### Gaps / inconsistencies to resolve

1. **Arial vs Geist** — fonts are loaded + tokenized but body overrides to
   Arial. Decide; one-line fix.
2. **Raw grays everywhere** — chat panel, admin, headers use `text-gray-400`,
   `bg-gray-800`, `bg-gray-900` alongside the semantic tokens. Sweep to
   tokens, or the palette can never be retuned in one place.
3. **Badge palette is the only chrome color** — 11 variants across 6 hues
   (yellow/blue/purple/green/emerald/red). Proposal: neutral + positive +
   attention + negative only.
4. **Dark-only is implicit, not declared** — light-mode Tailwind classes break
   on the dark background when they sneak in. Either declare dark-only as a
   principle (proposal: yes, it's the brand) or do real theming. No halfway.
5. **Two empty-state implementations** in the Studio (hero composer + an older
   in-thread variant in `chat-panel.tsx` with 4 chips, no delay) — the second
   is near-dead code.
6. **"Selected image" is load-bearing but nearly invisible** — a 2px border
   decides what Make Products ships to /preview.
7. **Three composer actions at equal weight** — violates one-primary. The
   rethink should decide what Send/Draw it/Compare collapse into.
8. **Accent = white means no brand color exists.** Fine (ink/paper is the
   brand) — but make it a stated decision so nobody "adds some color" ad hoc.

---

## Part 2 — Page inventory

Every page, every visible component, ranked by importance to the page's job
(1 = the page fails without it). Mobile/desktop splits and flag gates noted.
File paths relative to `src/`.

### Global chrome (`app/layout.tsx`)

1. **SiteHeader** (`components/site-header.tsx`) — logo, nav (Fresh Prints /
   New Design / My Designs / Orders), cart count (flag `CART_ENABLED`),
   sign-in/out. Phone: hamburger dropdown. Anon guests read as signed-out.
2. **Breadcrumbs** (`components/breadcrumbs.tsx`) — desktop: full trail;
   phone: single `← Parent` chip. Escape navigates up.
3. **FeedbackLauncher** (`components/feedback-launcher.tsx`) — fixed
   bottom-right FAB, opens feedback panel. (Competes with /design's gallery
   FAB for the same corner region.)
4. Build-date stamp in header (deploy check, desktop only).

### `/` Home (`app/page.tsx`)

Job: route visitors — guests toward designing or browsing, returning users
back to work.

1. **HomeHero** (`components/home-hero.tsx`) — three variants: logged-out
   pitch + "Start Designing"; logged-in first-timer; "Welcome back" + New
   Design / View All Designs.
2. **Fresh Prints teaser** — `PublishedGrid` (`components/published-grid.tsx`)
   12-card feed + "See all" → /prints. The storefront's front window.
3. **Promo banner** — conditional, config-driven (`lib/promotion.ts`), accent
   bg, mono code block.
4. **How it works** — 3-step explainer, guests only.
5. **Pricing blurb** — static.
6. **Footer** — contact email.

### `/design` Studio (`app/design/page.tsx`)

Job: turn a described idea into a generation worth ordering.

1. **Composer** (in `app/design/chat-panel.tsx`) — input + upload button +
   Send / **Draw it** / Compare styles. Draw it carries the ready nudge.
   The single most load-bearing control on the site.
2. **Message thread** (`chat-panel.tsx`) — user bubbles right, assistant
   markdown left, inline images ≤200px, Thinking/Drawing indicators.
3. **Generations Rail** (`app/design/image-gallery.tsx`) — desktop only,
   320px: numbered thumbnail grid, generator badges, selection border,
   dark/light preview toggle, product-versions section, **Make Products →**
   pinned at bottom (the funnel exit).
4. **Mobile Sheet** (`app/design/mobile-gallery-drawer.tsx`) + count FAB —
   the phone Rail; auto-opens after each generation.
5. **Empty state** — centered hero composer ("What shall we draw together?"),
   example chips after 8s idle (`lib/design-view.ts` drives the split).
6. **Lightbox** (`app/design/image-lightbox.tsx`) — per-image actions: Make
   Products (promotes that image), Publish, Adopt generator, Delete.
7. **PublishModal** (`components/publish-modal.tsx`) — title / description /
   backdrop on publish.
8. Drag-drop overlay + hidden file input — reference image upload.
9. Style-hint line (pre-ready), header title swap, breadcrumb.

### `/preview` (`app/preview/page.tsx`)

Job: convince the user the design works on a real product.

1. **Stage / mockup hero** — Printful render of the design on the chosen
   product+color; click-to-zoom lightbox; rotating loading copy; error state
   with Try again; `ProductSilhouette` fallback.
2. **Use this design →** CTA (funnel exit to /order; disabled while
   rendering).
3. **ColorPicker** (`components/product-options.tsx`) — swatch row.
4. **Product selector** — one button per active product.
5. **Front/Back toggle + back-source picker** (flag
   `MULTI_PLACEMENT_ENABLED`) — "+$8.00" label; picker replaces the Stage
   while choosing a back image.
6. **Design size slider** — 30–100% print-area scale.
7. "Refine design" link back to Studio; breadcrumb.

### `/order` (`app/order/page.tsx`)

Job: confirm size/price and hand off to Stripe.

1. **Buy now — $X.XX** — desktop inline; phone: **sticky bottom bar** (the
   phone-first money button).
2. **Pricing breakdown** — product, back design (+$8, conditional), shipping
   ($4.69 line), total. Trust surface.
3. **SizePicker** / **ColorPicker** (`components/product-options.tsx`).
4. **Mockup thumbnail** — reassurance, small on phone.
5. **Add to cart** (flag `CART_ENABLED`) — secondary, both layouts.
6. Breadcrumb.

### `/order/confirm` (`app/order/confirm/page.tsx`)

Job: confirm the money was well spent; route onward.

1. Confirmation card — checkmark, order ID (mono), size/color/total.
2. **View My Orders** (primary) + Start another design (ghost).
3. Loading / order-not-found states.

### `/cart` (`app/cart/page.tsx`) — flag `CART_ENABLED`

Job: review the bundle and check out once.

1. **Checkout — $X.XX** (primary).
2. **Item list** — thumbnail, product, color/size, front+back marker, qty,
   unit×qty price, Remove.
3. **Pricing summary** — items subtotal, bundled shipping, total.
4. Add another design (secondary); empty state → Start a design.

### `/prints` Storefront (`app/prints/page.tsx`)

Job: browse Prints, pick one to buy.

1. **PublishedGrid** — 2→4-col cards: image on its backdrop, title, designer
   ("by you" for own).
2. Header ("Fresh Prints" + one-liner); empty state.

### `/d/[imageId]` Print detail (`app/d/[imageId]/page.tsx`)

Job: sell one Print.

1. **Stage** — `PublishedImageView`: image on its backdrop; owner-only
   backdrop swatch row (`components/background-picker.tsx`).
2. **BuyPanel** (`app/d/[imageId]/buy-panel.tsx`) — product / SizePicker /
   ColorPicker, price breakdown, **Buy now** (or "Sign in to buy" with
   `?next=`).
3. **Title + description** — `EditableNaming`, owner-inline-editable.
4. Designer attribution + fork-chain line (historical).
5. Breadcrumb (parent from `?from`).

### `/designs` Shelf (`app/designs/page.tsx`)

Job: re-enter past work.

1. **Design cards grid** (2→3-col) — checkerboard thumbnail linking back into
   the Studio, status badge, age, generation count.
2. **Per-card actions** — Publish / Un-publish / Published→, Reorder +
   Archive (ordered), Delete (unordered).
3. **New Design** button (header).
4. PublishModal; empty / loading / error states (error surfaces the message).

### `/orders` Shelf (`app/orders/page.tsx`)

Job: check where my shirt is.

1. **Order cards** — status Badge, thumbnail on shirt color, name/ID, price,
   size/color, front+back + ×qty markers, date, **Track shipment** link,
   designer attribution when bought from someone else.
2. **Filter chips** — Active (N) / Canceled (N) / All (N).
3. New Design button; empty states.

### Auth (`app/(auth)/…`)

Job: get in fast and get back to what you were doing.

1. The form (email/password; name on sign-up; minLength 8) + single primary
   submit with busy text.
2. Cross-links (sign-in ↔ sign-up, forgot password) — honor `?next=`.
3. Error line (red); forgot/reset success + invalid-token states.

### `/admin` Counter (`app/admin/page.tsx`)

Job: see the business and unstick orders.

1. **Orders table** — sortable columns (order, status, customer, design
   thumb, details, shipping, revenue, COGS, profit, Printful ID, date);
   per-row Recover / Retry Printful / Track / Archive.
2. **Financial summary cards** — orders, revenue, Stripe fees, COGS, gross
   profit.
3. **Classification + tags controls** — dropdown per row, tag pills, +tag.
4. **Filter chips** — All / per-classification / Archived.
5. Classification legend (collapsible); link to /admin/published.
   Phone: table scrolls horizontally (tolerated — Counter is desk work).

### `/admin/orders/[id]` (`app/admin/orders/[id]/page.tsx`)

Job: audit and fix one order.

1. **Ledger timeline** — sale / Stripe fee / COGS / refund entries, colored
   amounts, timestamps.
2. **Action row** — Recover (replay webhook), Retry Printful, Track, Archive.
3. **Customer / Product / Financials cards** — email, address, thumbnail,
   revenue/COGS/profit.
4. Classification + tags card; References card (Stripe/Printful IDs, mono);
   header with badges.

### `/admin/published` (`app/admin/published/page.tsx`)

Job: moderate the storefront.

1. **Moderation grid** — Print cards with Hide/Unhide; hidden = red border +
   dimmed.
2. Card metadata (title, designer, email, date); empty state.
