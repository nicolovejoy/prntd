# PRNTD Design System — persona + copy proposal

2026-07-19 (supersedes the 2026-06-10 abstract draft). Three parts: (1) a
**persona decision** — three fully-worked options for who PRNTD sounds like,
with the same copy surfaces written out in each voice so they compare
line-by-line; (2) the design language + vocabulary; (3) the per-page component
inventory and gap list, with persona-dependent items marked.

The original review (Manine, 2026-06-14) made one central point: the product
had no persona, so tone couldn't be judged. That decision is now Nico's +
Claude's to make. This doc exists so it gets made by picking one of three
options, not by drifting into one.

Naming note: the community storefront was renamed from "Fresh Prints" to
**"Shop"** (2026-07-19). This doc assumes that name throughout.

---

## Part 1 — Persona

Three options. Each includes voice principles, copy for the same eight
surfaces, visual deltas from the ink/paper base (Part 2), implications, and a
one-line "choose this if". The eight surfaces, in order:

1. Landing hero — headline + sub
2. Composer placeholder
3. Example chips (3)
4. Generating state
5. Empty `/designs` state
6. Order CTA
7. Order-confirmation opening line
8. One error message (failed generation)

Current live copy for reference (all on the landing shipped 2026-07-05):
hero "Type an idea. Wear it." / "AI draws your design in seconds. Free to try
— pay only if you order."; placeholder "Describe your design..."; generating
"Drawing your design…"; order CTA "Buy now — $X.XX".

### Option A — The Print Shop

A neighborhood print shop that happens to have a very good illustrator behind
the counter. Warm, utilitarian, plainspoken. The current landing and the
ink/paper direction already lean this way — this is the continuity pick.

**Voice principles**

1. Verbs of making: describe, draw, print, wear. Never "generate", "create
   with AI", "AI-powered" — the tech is the illustrator, not the pitch.
2. Short declarative sentences, second person, present tense. No exclamation
   points anywhere.
3. Whimsy is allowed only inside the drawing moment ("Drawing your design…",
   "What shall we draw together?"). Nav, checkout, orders, and errors are
   flat and factual.
4. State facts plainly — prices, timing, what happened. True claims only
   ("in seconds" stays because it's true).
5. When helpful and terse conflict, terse wins; the shop doesn't chat at the
   register.

**Copy samples**

1. Hero: **"Type an idea. Wear it."** / "Describe a shirt and watch it get
   drawn. Free to try — pay only if you order."
2. Placeholder: "Describe your design..."
3. Chips: "A minimalist mountain landscape in blue and white" · "A retro
   sunset with palm tree silhouettes" · "An abstract geometric wolf head"
4. Generating: "Drawing your design…"
5. Empty `/designs`: "Nothing here yet. Describe an idea and we'll draw it."
   + [New design]
6. Order CTA: "Buy now — $19.43"
7. Confirmation opening: "Order placed. We're printing your shirt."
8. Error: "The drawing failed. Nothing was charged — try again."

**Visual deltas from ink/paper base**: none. Ink/paper as specified in Part 2
is this persona's visual half; the two were drafted together.

**Implications**

- Lowest churn: the live landing, "Draw it", "Drawing your design…", and the
  chat empty state already speak this voice. Work is an audit pass, not a
  rewrite — a dozen or two strings that leak internals or AI-speak (e.g. the
  Compare tooltip "Compare styles across all generators (current: ideogram)"
  exposes generator plumbing to customers).
- Fits "Shop" naming with no friction — a print shop has a shop.
- Compatible with organizer storefronts: the voice is quiet enough that a
  bakery's shop page doesn't read as someone else's brand talking.
- Risk: low. The failure mode is blandness, mitigated by keeping the
  drawing-moment warmth.

**Choose this if**: you want the persona decision to mostly ratify what's
live, ship the audit in a day, and keep the site sounding like the place that
prints your shirt.

### Option B — The Zine Studio

Small-batch print culture: riso, zines, one-off runs. The copy is dry and a
little playful; the studio has opinions. More character, more risk.

**Voice principles**

1. Talks like a riso studio's flyer: deadpan, specific, unbothered. Jokes are
   dry one-liners, never wacky.
2. Print-craft vocabulary used honestly — runs, pulls, the press — without
   skeuomorphic cosplay. PRNTD sells a run of one; the copy leans on that.
3. Money is always straight: checkout, prices, refunds, and payment errors
   carry zero jokes. Humor stops at the register.
4. The machine can be a character, sparingly ("the press jammed") — never
   named, never cute, never apologizing at length.
5. Short beats clever whenever they conflict.

**Copy samples**

1. Hero: **"One-off shirts from one sentence."** / "Type it, we draw it, you
   wear it. No minimum run — a run of one."
2. Placeholder: "what are we printing?"
3. Chips: "a wolf, but geometric" · "sunset, palm trees, 1983" · "\"HELLO\"
   in fat graffiti letters"
4. Generating: "Pulling your print…"
5. Empty `/designs`: "The flat file is empty. Print something."
   + [New design]
6. Order CTA: "Print it — $19.43"
7. Confirmation opening: "It's on the press. One shirt, run of one."
8. Error: "The press jammed. Nothing was charged — try again."

**Visual deltas from ink/paper base**

- One ink accent color added — a riso staple (blue or fluorescent-adjacent
  red), used only for chips, generation numbers, and small marks. This breaks
  the "white is the only inversion color" rule (gap #8); the primary button
  stays white-on-ink.
- Geist Mono promoted: generation numbers, prices, and section labels set in
  mono, hand-set-type style.
- Registration-mark / crop-mark motifs allowed as decoration on empty states
  and the confirmation card — nowhere functional.

**Implications**

- Every customer-facing string is a rewrite, and the voice needs maintenance:
  each future feature has to decide whether it gets the joke or plays it
  straight. That's a standing tax.
- "Shop" naming is a mild mismatch — this persona would rather call it the
  rack or the wall. Livable, but the neutral name dilutes the voice.
- Worst fit with organizer storefronts: a Pilates studio's customers land on
  copy with PRNTD's sense of humor. Until white-label (#45) isolates shop
  pages, the voice bleeds onto surfaces that belong to organizers.
- Risk: medium-high. Dry copy misreads for some buyers, and a voice half-
  applied is worse than none.

**Choose this if**: PRNTD stays maker-first, you want the brand itself to be
memorable, and you'll pay the ongoing cost of maintaining a voice.

### Option C — The Clean Label

Uniqlo-esque neutrality. Copy is nearly invisible; the product and the
mockups do the persuading. Least voice, safest, most conventional.

**Voice principles**

1. Every string is the shortest accurate label. Nouns and verbs; no
   metaphors, no "we".
2. Microcopy states facts only — price, time, status. It never sells,
   reassures, or performs.
3. No whimsy anywhere, including the drawing moment. Waiting states name the
   operation and stop.
4. Sentence case, full stops, zero exclamation points, zero jokes.
5. When a string can be deleted, delete it.

**Copy samples**

1. Hero: **"Design a shirt by describing it."** / "Free to design. Printed
   and shipped from $19.43."
2. Placeholder: "Describe a design"
3. Chips: "Minimalist mountain landscape" · "Retro sunset, palm silhouettes"
   · "Geometric wolf head"
4. Generating: "Generating…"
5. Empty `/designs`: "No designs yet." + [New design]
6. Order CTA: "Order — $19.43"
7. Confirmation opening: "Order confirmed."
8. Error: "Generation failed. You were not charged."

**Visual deltas from ink/paper base**

- Quieter still: no 8s-delay chip reveal (chips always visible, catalog-
  style), more whitespace, `/shop` grid gets stronger catalog emphasis
  (bigger cards, less metadata).
- Badge palette collapses hardest here (neutral + one status color pair).
- No decorative elements of any kind; checkerboard stays (it's functional).

**Implications**

- Best fit for organizer storefronts and white-label (#45): neutral chrome
  disappears behind anyone's brand. If organizer stores become the business,
  this is the persona they'd ask for.
- Moderate churn — fewer strings change than B, but the changes all point the
  deflating direction, and "Generating…" trades the product's one warm beat
  for the same word every AI tool uses. Neutral copy here is, ironically,
  more generic-AI-flavored than Option A's craft framing.
- Fits "Shop" naming perfectly.
- Risk: low operationally, real strategically — nothing about the chrome
  gives anyone a reason to remember PRNTD.

**Choose this if**: organizer storefronts are the business, and PRNTD chrome
should disappear behind the shops it hosts.

### Recommendation

**Option A.** Three reasons, none of them "it's what's already there":

1. The maker flow is still the primary product (per the 2026-07-05 direction:
   maker UX now, organizer readiness rudimentary). A's voice serves makers
   without alienating storefront buyers — B risks the latter, C flattens the
   former.
2. The drawing moment is the product's one differentiated beat, and A is the
   only option that keeps its warmth while staying cheap to maintain. B keeps
   it at high upkeep; C deletes it.
3. The argument for C — neutrality under organizer brands — is better solved
   by #45's white-label work (shop pages get their own restrained treatment)
   than by neutering the maker surface sitewide.

The honest counter-case: if the organizer pivot becomes the whole business,
C wins and this decision should be revisited — the persona applies to PRNTD's
own surfaces, and those shrink in that future. B is the right pick only if
brand personality is being bet on as a growth lever; nothing currently
depends on that bet.

Picking A means: ratify the current voice, run a sitewide string audit
against A's five principles (the Compare tooltip and a handful of
internals-leaking strings fail it today), and write new features' copy
against those principles from now on.

---

## Part 2 — Design language

### Direction

PRNTD is a print shop. The interface is the shop counter: matte black, quiet,
monochrome. The customer's artwork is the only color on the screen — every
hue the chrome claims for itself competes with the design being made, so the
chrome claims none. White is the accent; a primary action is an inversion
(paper-on-ink), not a colored button.

This direction is Option A's visual half and survives unchanged under A or C.
Option B amends it (one ink accent, mono promotion — see above).

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
- **Print** — a published generation. Lives in the Shop, has a title,
  description, and backdrop. (`published_at` on `design_image`.)
- **Mockup** — a generation placed on a physical product (Printful render).
- **Product version** — a generation re-rendered for a specific product's
  print area (placement render).
- **Backdrop** — the shirt-palette color a Print is displayed on; checkerboard
  when unset.
- **Swatch** — a selectable product color circle.

**Places**

- **Studio** — `/design`. Where designs are made.
- **Shop** — `/prints`, the community storefront (renamed from "Fresh
  Prints" 2026-07-19). Organizer stores are also shops: `/shop/[slug]`, each
  a self-contained storefront.
- **Funnel** — Studio → Preview → Order → Confirm. Linear, breadcrumbed.
- **Shelf** — the personal archive: `/designs`, `/orders`.
- **Counter** — `/admin`. Back of shop.
- **Dashboard** — `/dashboard`. Where organizers run their shops.

**Surfaces & regions**

- **Stage** — the dominant artwork area of a screen (mockup hero on /preview,
  image on /d/[id]). One Stage per screen, as large as the viewport allows.
- **Composer** — the chat input row in the Studio (input + actions). Also the
  signed-out landing hero (`MakerHero`) — the landing is the composer.
- **Rail** — the desktop Generations sidebar (320px, right).
- **Sheet** — a bottom drawer on phones (mobile gallery). The phone's Rail.
- **Lightbox** — full-screen image overlay with per-image actions.
- **Sticky bar** — the fixed bottom CTA bar on phone funnel pages (/order).
- **Chip** — a small pill-shaped tappable suggestion (example prompts, filter
  tabs).

**States**

- **Thinking** — waiting on a chat reply (~3–6s).
- **Drawing** — waiting on a generation (~6–15s). Copy is persona-dependent:
  A "Drawing your design…" (current), B "Pulling your print…",
  C "Generating…".
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
Option B would add one more: `--ink-accent` (riso blue/red). A and C add
nothing.

### Type

Geist Sans / Geist Mono, tokenized (`--font-sans`, `--font-mono`). The old
Arial body override was fixed on main 2026-06-14 (`cbedcbe`) — body renders
Geist now.

Scale in use (Tailwind steps), roles:

- `text-3xl/5xl bold` — page hero (h1 on home, /prints)
- `text-lg/xl semibold` — screen title
- `text-sm font-medium` — section labels, card titles
- `text-sm` — body, chat
- `text-xs text-text-muted` — metadata
- `text-xs text-text-faint` / `text-[10px]` — fine print, badges
- `font-mono` — IDs, codes, money references (Option B widens this role to
  generation numbers, prices, and labels)

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
`BuyPanel`, `MakerHero`, `ComposeForm` (organizer product compose).

Interaction grammar:

- Radius: `rounded-md` controls, `rounded-lg` cards/images, `rounded-full`
  chips/badges/FAB.
- Spacing: 4px base; `p-4` standard padding; `gap-2` within a control group,
  `gap-4` between groups.
- Touch targets ≥ 44px on phone (established rule).
- Motion: `transition-colors` on hover, `animate-pulse` for Drawing — nothing
  else. No entrance animations.
- Selection: accent ring/border (`border-accent` / `ring-accent`) marks the
  selected thumbnail, swatch, or product.
- Escape goes **up** one funnel level (breadcrumb parent); overlays eat the
  first Escape to close themselves.

### Gaps / inconsistencies

Status as of 2026-07-19. Items 1, 2, and the undefined-token no-ops from the
first draft were fixed on main 2026-06-14 (`cbedcbe`): Geist restored, 40 raw
`gray-*` classes swept to semantic tokens, 4 dead token names corrected.
Remaining:

1. **Badge palette is the only chrome color** — 11 variants across 6 hues.
   Persona-dependent resolution: A and C collapse to neutral + positive +
   attention + negative; C collapses hardest (neutral + one pair); B keeps
   the same collapse but may map "attention" onto its ink accent.
2. **Dark-only is implicit, not declared** — light-mode Tailwind classes
   break on the dark background when they sneak in. Declare dark-only as a
   principle (it's the brand under all three personas) or do real theming.
   No halfway. Persona-independent; decide once.
3. **Two empty-state implementations** in the Studio (hero composer + an
   older in-thread variant in `chat-panel.tsx`) — the second is near-dead
   code. Persona-independent cleanup, but the surviving copy is persona-
   dependent (see Part 1 samples).
4. **"Selected image" is load-bearing but nearly invisible** — a 2px border
   decides what Make Products ships to /preview. Persona-independent problem;
   B's ink accent gives it a free fix, A/C need a heavier white treatment
   (thicker ring + dimmed siblings).
5. **Three composer actions at equal weight** — violates one-primary. The
   structural fix (what Send / Draw it / Compare collapse into) is persona-
   independent; the labels are persona-dependent (A keeps "Draw it", B
   "Print it"-adjacent, C "Generate").
6. **Accent = white means no brand color exists.** Under A and C this is a
   stated decision — ink/paper is the brand, nobody "adds some color" ad
   hoc. Option B is the one persona that amends it (single ink accent, scoped
   to chips/numbers/marks, never the primary button).
7. **Internals leak into customer copy** (new) — the Compare tooltip names
   generators; a few statuses render raw enum-ish strings. Fails all three
   personas; audit rides along with the persona copy pass.

---

## Part 3 — Page inventory

Every page, every visible component, ranked by importance to the page's job
(1 = the page fails without it). Mobile/desktop splits and flag gates noted.
File paths relative to `src/`. Inventory updated for the maker landing
(2026-07-05) and organizer pages; copy called out below is persona-dependent
and covered by Part 1's samples.

### Global chrome (`app/layout.tsx`)

1. **SiteHeader** (`components/site-header.tsx`) — logo, nav (Shop /
   New Design / My Designs / Orders, Dashboard behind `STORES_ENABLED`), cart
   count (flag `CART_ENABLED`), sign-in/out. Phone: hamburger dropdown. Anon
   guests read as signed-out.
2. **Breadcrumbs** (`components/breadcrumbs.tsx`) — desktop: full trail;
   phone: single `← Parent` chip. Escape navigates up.
3. **FeedbackLauncher** (`components/feedback-launcher.tsx`) — fixed
   bottom-right FAB, opens feedback panel. (Competes with /design's gallery
   FAB for the same corner region.)
4. Build-date stamp in header (deploy check, desktop only).

### `/` Home (`app/page.tsx`)

Job: signed-out, the landing is the composer — start a design in one gesture.
Signed-in, route back to work.

1. **MakerHero** (`components/maker-hero.tsx`) — signed-out hero: headline,
   input + Draw it, 3 example chips → `/design?prompt=` (auto-fires Draw-it).
   All copy persona-dependent (Part 1 surfaces 1–3).
2. **HomeHero** (`components/home-hero.tsx`) — signed-in personal hero.
3. **Proof strip** — "Made by chatting here": 2 real published designs on
   their backdrops. Header line persona-dependent.
4. **Shop teaser** — `PublishedGrid` 12-card feed + "See all" → /prints.
5. **Promo banner** — conditional, config-driven (`lib/promotion.ts`).
6. **Pricing line** — driven by `minRetailPrice()`, never hardcoded.
7. **Footer** — contact email + "Open a shop →" (`/dashboard`).

### `/design` Studio (`app/design/page.tsx`)

Job: turn a described idea into a generation worth ordering.

1. **Composer** (in `app/design/chat-panel.tsx`) — input + upload button +
   Send / **Draw it** / Compare styles. Draw it carries the ready nudge.
   The single most load-bearing control on the site. Labels persona-dependent
   (gap #5).
2. **Message thread** (`chat-panel.tsx`) — user bubbles right, assistant
   markdown left, inline images ≤200px, Thinking/Drawing indicators
   (Drawing copy = Part 1 surface 4).
3. **Generations Rail** (`app/design/image-gallery.tsx`) — desktop only,
   320px: numbered thumbnail grid, generator badges, selection border,
   dark/light preview toggle, product-versions section, **Make Products →**
   pinned at bottom (the funnel exit).
4. **Mobile Sheet** (`app/design/mobile-gallery-drawer.tsx`) + count FAB —
   the phone Rail; auto-opens after each generation.
5. **Empty state** — centered hero composer ("What shall we draw together?"
   under Option A), example chips after 8s idle (`lib/design-view.ts` drives
   the split; Option C drops the delay).
6. **Lightbox** (`app/design/image-lightbox.tsx`) — per-image actions: Make
   Products (promotes that image), Publish, Adopt generator, Delete.
7. **PublishModal** (`components/publish-modal.tsx`) — title / description /
   backdrop on publish.
8. Drag-drop overlay + hidden file input — reference image upload.
9. Style-hint line (pre-ready), header title swap, breadcrumb.

### `/preview` (`app/preview/page.tsx`)

Job: convince the user the design works on a real product.

1. **Stage / mockup hero** — Printful render of the design on the chosen
   product+color; click-to-zoom lightbox; rotating loading copy
   (persona-dependent); error state with Try again; `ProductSilhouette`
   fallback.
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

1. **Order CTA** — desktop inline; phone: **sticky bottom bar** (the
   phone-first money button). Label = Part 1 surface 6.
2. **Pricing breakdown** — product, back design (+$8, conditional), shipping
   line, total. Trust surface; copy stays flat under all three personas.
3. **SizePicker** / **ColorPicker** (`components/product-options.tsx`).
4. **Mockup thumbnail** — reassurance, small on phone.
5. **Add to cart** (flag `CART_ENABLED`) — secondary, both layouts.
6. Breadcrumb.

### `/order/confirm` (`app/order/confirm/page.tsx`)

Job: confirm the money was well spent; route onward.

1. Confirmation card — checkmark, order ID (mono), size/color/total. Opening
   line = Part 1 surface 7.
2. **View My Orders** (primary) + Start another design (ghost).
3. Loading / order-not-found states.

### `/cart` (`app/cart/page.tsx`) — flag `CART_ENABLED`

Job: review the bundle and check out once.

1. **Checkout — $X.XX** (primary).
2. **Item list** — thumbnail, product, color/size, front+back marker, qty,
   unit×qty price, Remove.
3. **Pricing summary** — items subtotal, bundled shipping, total.
4. Add another design (secondary); empty state → Start a design.

### `/prints` Shop (`app/prints/page.tsx`)

Job: browse Prints, pick one to buy.

1. **PublishedGrid** — 2→4-col cards: image on its backdrop, title, designer
   ("by you" for own).
2. Header ("Shop" + one-liner, persona-dependent); empty state.

### `/shop/[slug]` Organizer storefront (`app/shop/[slug]/…`)

Job: sell an organizer's products to their audience. Persona note: this
surface belongs to the organizer, not PRNTD — chrome copy here should stay at
Option-C restraint regardless of the sitewide persona choice; white-label
depth is issue #45.

1. **Product grid** — the organizer's listed products.
2. **Buy page** (`[productId]`) — mockup Stage, size/color, buy CTA.

### `/dashboard` Organizer dashboard (`app/dashboard/…`) — flag `STORES_ENABLED`

Job: create and run a shop.

1. Create-shop form / shop card — Copy-link, Publish toggle, edit panel.
2. **Product compose** (`/dashboard/products/new`, shared `ComposeForm`) —
   design picker, blank, price with live proceeds + floor.

### `/d/[imageId]` Print detail (`app/d/[imageId]/page.tsx`)

Job: sell one Print.

1. **Stage** — `PublishedImageView`: image on its backdrop; owner-only
   backdrop swatch row (`components/background-picker.tsx`).
2. **BuyPanel** (`app/d/[imageId]/buy-panel.tsx`) — product / SizePicker /
   ColorPicker, price breakdown, **Buy now** (or "Sign in to buy" with
   `?next=`). Phone: image capped 40vh, floating ← back, sticky bottom CTA.
3. **Title + description** — `EditableNaming`, owner-inline-editable.
4. Designer attribution + fork-chain line (historical).
5. Breadcrumb (parent from `?from`).

### `/designs` Shelf (`app/designs/page.tsx`)

Job: re-enter past work.

1. **Design cards grid** (2→3-col) — checkerboard thumbnail linking back into
   the Studio, status badge, age, generation count, explicit **Edit** on
   non-ordered cards.
2. **Per-card actions** — Publish / Un-publish / Published→, Reorder +
   Archive (ordered), Delete (unordered).
3. **New Design** button (header).
4. PublishModal; empty state (= Part 1 surface 5) / loading / error states
   (error surfaces the message).

### `/orders` Shelf (`app/orders/page.tsx`)

Job: check where my shirt is.

1. **Order cards** — status Badge, per-line thumbnail on shirt color,
   name/ID, price, size/color, front+back + ×qty markers, date, **Track
   shipment** link, designer attribution when bought from someone else.
2. **Filter chips** — Active (N) / Canceled (N) / All (N).
3. New Design button; empty states.

### Auth (`app/(auth)/…`)

Job: get in fast and get back to what you were doing.

1. The form (email/password; name on sign-up; minLength 8) + single primary
   submit with busy text.
2. Cross-links (sign-in ↔ sign-up, forgot password) — honor `?next=`.
3. Error line (red); forgot/reset success + invalid-token states.

### `/admin` Counter (`app/admin/page.tsx`)

Job: see the business and unstick orders. Persona-independent — internal
tooling keeps flat factual copy under any option.

1. **Orders table** — sortable columns (order, status, customer, design
   thumb, details, shipping, revenue, COGS, profit, Printful ID, date);
   per-row Recover / Retry Printful / Refund (canceled) / Track / Archive.
2. **Financial summary cards** — orders, revenue, Stripe fees, COGS, gross
   profit.
3. **Classification + tags controls** — dropdown per row, tag pills, +tag.
4. **Filter chips** — All / per-classification / Archived.
5. Classification legend (collapsible); link to /admin/published.
   Phone: table scrolls horizontally (tolerated — Counter is desk work).

### `/admin/orders/[id]` (`app/admin/orders/[id]/page.tsx`)

Job: audit and fix one order.

1. **Ledger timeline** — sale / Stripe fee / COGS / refund /
   refund-COGS-reversal entries, colored amounts, timestamps.
2. **Action row** — Recover (replay webhook), Retry Printful, Refund, Track,
   Archive.
3. **Customer / Product / Financials cards** — email, address, thumbnail,
   revenue/COGS/profit.
4. Classification + tags card; References card (Stripe/Printful IDs, mono);
   header with badges.

### `/admin/published` (`app/admin/published/page.tsx`)

Job: moderate the storefront.

1. **Moderation grid** — Print cards with Hide/Unhide; hidden = red border +
   dimmed.
2. Card metadata (title, designer, email, date); empty state.
