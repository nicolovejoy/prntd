# PRNTD Design System

2026-06-18. Rewrite of the 2026-06-10 first draft (PR #34) after the persona
conversation with Manine. **Supersedes PR #34** — that draft was correct about
the visual language but couldn't answer Manine's central objection: *the product
had no persona, so tone and copy couldn't be reviewed.* This version starts
there.

The pivot it encodes: PRNTD is **organizer-first**. The wedge customer is not
the person buying one shirt — it's the **organizer** who has an audience and
wants merch without buying inventory. See `docs/positioning-pivot.md`.

Five parts:
0. **Who it's for** — the persona, concretely. The new foundation.
1. **Design language** — ink/paper, re-anchored to the persona.
2. **The two flows** — organizer setup (primary) and buyer (downstream).
3. **Vocabulary, tokens, components** — the shared kit.
4. **Page inventory** — every surface, what's built, what's new.

Divergences from current code are marked **[gap]**. Surfaces that don't exist
yet are marked **[new]**.

---

## Part 0 — Who it's for

### The organizer (primary)

> **Manine runs a youth baseball club.** Thirty families. Every season a parent
> asks "are we doing shirts this year?" and every season it dies on the logistics:
> who fronts the money, who collects sizes, who eats the leftover XLs. She is not
> a designer and doesn't want to become one. She wants to spin up a little shop —
> *"Manine's Baseball Club"* — pick a couple of designs, and text a link to the
> team. Parents order their own sizes, pay their own money, shirts show up. She
> never touches inventory and never fronts a cent.

That's the customer. Not demographics — the *moment*: someone with a built-in
audience and a recurring "should we do shirts?" that keeps failing on hassle and
risk. Clubs, bands, studios, classrooms, reunions, small causes.

What she wants, in priority order:

1. **No inventory, no money up front.** The fear we remove. Everything else is
   secondary to this.
2. **A shareable thing.** A named shop with a link she can drop in a group chat.
   The link *is* the product to her.
3. **To not look amateur.** It should feel like she hired someone, not like a
   form-builder.
4. **Five minutes, on her phone, between other things.** She's organizing this
   in a parking lot, not at a desk.

What she is **not**: a designer, a power user, someone who will read help text,
someone at a computer.

### The buyer (secondary, downstream)

The parent who gets the link. Opens it on a phone, sees the team's shirts, picks
a size, pays. Doesn't make an account until checkout. This is essentially today's
`/design → preview → order` funnel, but entered *from a store*, not cold. The
buyer is real volume but not the wedge — we win the buyer by winning the
organizer.

### Voice

The lens is **Newman's Own**: a real product that stands on its own, where the
proceeds happen to do good. Not a charity that also sells shirts — a good shirt
shop that's also pro-social. Keep the do-good light; never lead with it, never
guilt with it.

Three words: **capable, warm, unfussy.**

Never: salesy, cutesy, "platform"-y, or technical. Never makes the organizer feel
like she's operating software. No "leverage," no "seamless," no exclamation-mark
enthusiasm. If a sentence sounds like a SaaS onboarding tooltip, cut it.

The test for any copy or control: *would Manine-in-a-parking-lot understand it in
one read, and would it make her feel handled rather than tasked?*

---

## Part 1 — Design language

### Direction

PRNTD is a print shop, and the interface is the shop counter: matte black, quiet,
monochrome. **The artwork is the only color on the screen.** Every hue the chrome
claims for itself competes with the designs being sold, so the chrome claims none.
White is the accent; a primary action is an inversion (paper-on-ink), not a
colored button.

This still holds under the organizer pivot, with one addition: **a store can carry
one accent color** — the organizer's pick, the one place brand color is allowed,
because it's *her* brand, not ours. Everywhere else stays ink and paper.

Three principles:

1. **Ink and paper.** Chrome is monochrome. Color belongs to artwork, product
   swatches, and a store's single chosen accent. Nothing else.
2. **One primary per screen.** Exactly one inverted (white) button: the next step.
   Everything else is outline or ghost. (Current violation: the Studio composer
   offers Send / Draw it / Compare at equal weight — Part 4.)
3. **Phone-first, one column.** The phone layout *is* the design; desktop gets
   more room, not more features. The organizer works on her phone — if it's
   awkward on a phone, it's broken, not "desktop-optimized."

### Type

Geist Sans / Geist Mono, tokenized as `--font-sans` / `--font-mono`. (The Arial
override was fixed 2026-06-14, commit `cbedcbe`.) Roles:

- `text-3xl/5xl bold` — page hero
- `text-lg/xl semibold` — screen title
- `text-sm font-medium` — section labels, card titles
- `text-sm` — body, chat
- `text-xs text-text-muted` — metadata
- `font-mono` — IDs, codes, money references

---

## Part 2 — The two flows

This is the information architecture the pivot demands. Today there is one funnel
(design → buy). The pivot splits the front door in two.

```
ORGANIZER FLOW (primary entry)          BUYER FLOW (downstream)
────────────────────────────           ──────────────────────
Land → "Set up a shop"                  Open shared link
  → Name it                              → /shop/[slug]  (the store)
  → Pick / make designs                  → pick a design
  → Get shareable link  ───────link────▶ → size + color
  → (optionally buy too)                 → checkout (account at this step)
        │                                       │
        ▼                                       ▼
   Organizer dashboard                     Their /orders
   (sales, designs, link)
```

Key IA decisions:

- **The store is the noun.** Designs live *in* a store. "Fresh Prints" (the global
  feed) becomes one example store among many — or is reframed entirely (Part 4,
  open question).
- **The organizer flow is the homepage's primary call.** A recognized organizer
  lands on their dashboard; an unrecognized visitor lands on "set up a shop" with
  a real example store as proof. (This answers Manine's "homepage should do
  different things for different users in different states.")
- **Auth moves later, again.** Setting up a shop should be possible far into the
  flow before sign-up is forced — the anonymous-plugin claim machinery already
  re-parents designs and orders on sign-in; it will re-parent stores the same way.
- **The buyer never sees the machinery.** No "design studio," no generation
  counter — just the organizer's shop and a size picker.

---

## Part 3 — Vocabulary, tokens, components

### Vocabulary

Shared nouns. Code names in parentheses where they differ.

**Objects** (full model + Printful mapping in `docs/organizer-pivot-plan.md`)

- **Product offering** *(new)* — a category of blanks with an availability window
  (new / seasonal / expiring). Maps to Printful's **category**; the window is ours.
- **Blank** *(rename of code's `Product`)* — a printable item: tee, mug, cozy. One
  Printful catalog product; has color × size variants and **placements**.
- **Placement** — a print location on a blank, Printful's keys verbatim
  (`front_large`, `back`, `sleeve_left`, `label_inside`, …). Carries a **technique**
  (`dtg` default), print area, DPI, aspect.
- **Design** — a thread: the conversation plus its generations. One `design` row,
  one `/design?id=` URL.
- **Generation** — one numbered render inside a design (`design_image` row).
  Append-only; never replaced.
- **Product** *(new — the organizer's sellable)* — a Design on a Blank at a
  Placement, priced. One design → many products. Persists the config today thrown
  away at checkout. *(Validity = a pure function of design props × placement
  constraints; warn + auto-remediate, never block — see the plan.)*
- **Collection** *(backlog, no URL)* — a grouping of products (teams, seasons),
  discount optional.
- **Store / Shop** *(new)* — a named, shareable shop owned by an organizer. Slug
  (`/shop/[slug]`), name, one accent color, a link. **Many per organizer, optimized
  for one.** The pivot's central new object.
- **Mockup** — a generation placed on a blank (Printful render).
- **Backdrop** — the shirt-palette color a product sits on; checkerboard unset.
- **Swatch** — a selectable product-color circle.

**Places**

- **Studio** — `/design`. Where designs are made. (Organizer or designer surface,
  never the buyer's.)
- **Shop** — `/shop/[slug]` *(new)*. A single organizer's storefront. What the
  buyer sees.
- **Dashboard** — `/dashboard` *(new)*. The organizer's back office: their
  shop(s), the share link, sales.
- **Funnel** — Shop → size/color → Order → Confirm. Linear, breadcrumbed.
- **Shelf** — personal archive: `/designs`, `/orders`.
- **Counter** — `/admin`. Back of shop.

**Surfaces & regions**

- **Stage** — the dominant artwork area of a screen.
- **Composer** — the chat input row in the Studio.
- **Sheet** — a bottom drawer on phones (the phone's version of a desktop rail).
- **Lightbox** — full-screen image overlay with per-image actions.
- **Sticky bar** — the fixed bottom CTA bar on phone funnel pages.
- **Chip** — a small pill-shaped tappable element. **Quick reply** *(new)* — a
  chip that answers the assistant's question with one tap instead of typing a
  number (Part 4, the mobile bug).

**States**

- **Thinking** — waiting on a chat reply (~3–6s).
- **Drawing** — waiting on a generation (~6–15s). "Drawing your design…", pulses.
- **Ready nudge** — Draw it pops secondary→primary when the idea has subject +
  style. Never blocks.

### Tokens

`src/app/globals.css` (Tailwind v4 `@theme inline`). Semantic only — components
use these, never raw `gray-*` / hex. (The 40-class gray sweep landed 2026-06-14.)

```
--background      #0a0a0a   page
--surface         #111111   inputs, wells
--surface-raised  #1a1a1a   cards
--border          #2e2e2e   resting
--border-hover    #444444   hover/focus
--foreground      #ededed   primary text
--text-muted      #999999   secondary text
--text-faint      #666666   tertiary/metadata
--accent          #ffffff   the one inversion color
--accent-fg       #000000   text on accent
```

`.bg-checkerboard` — transparency indicator for raw PNGs.

Proposed additions **[gap]**:

```
--overlay         rgba(0,0,0,.9)   tokenize the modal scrim
--positive        green-400-ish    money-in, success
--negative        red-400-ish      money-out, destructive, error
--attention       yellow-400-ish   pending
--store-accent    (per-store)      the organizer's one color, set on a Shop
```

Collapse the 11 badge hues onto `positive / attention / negative / neutral`.

### Component grammar

Five base components in `src/components/ui/` — the only sanctioned primitives:
**Button**, **Badge**, **Card**, **Input**, **Modal**. Composites are built from
these, never from raw markup.

New primitive the pivot needs **[new]**:

- **QuickReply** — a tappable chip rendered from a structured option the assistant
  returns (not parsed out of markdown text). Solves the "type a number" bug. ≥40px
  tall. Tapping submits the choice as if typed.

Interaction grammar:

- Radius: `rounded-md` controls, `rounded-lg` cards/images, `rounded-full`
  chips/badges.
- Spacing: 4px base; `p-4` standard; `gap-2` within a control group, `gap-4`
  between.
- **Touch targets ≥ 44px on phone.** (Raised from the old 40px — the organizer is
  always on a phone; this is non-negotiable, not aspirational.)
- Motion: `transition-colors` on hover, `animate-pulse` for Drawing. Nothing else.
- Selection: accent ring/border marks the selected thumbnail/swatch/product.
- Escape goes **up** one funnel level; overlays eat the first Escape to close.

---

## Part 4 — Page inventory

Every surface, ranked by importance to its job (1 = the page fails without it).
**[new]** = doesn't exist yet. Mobile/desktop and flag gates noted. Paths relative
to `src/`.

### Global chrome (`app/layout.tsx`)

1. **SiteHeader** (`components/site-header.tsx`) — logo, nav, sign-in/out. Phone:
   hamburger. The nav must change with the pivot: an organizer's primary nav is
   **Dashboard / New Design**, not "Fresh Prints / My Designs / Orders." **[gap —
   nav IA is pivot work.]**
2. **Breadcrumbs** (`components/breadcrumbs.tsx`) — desktop full trail; phone
   single `← Parent`. Escape navigates up.
3. **FeedbackLauncher** — fixed bottom-right FAB.

### `/` Home (`app/page.tsx`) — **the page the pivot most changes**

Job: get an organizer to set up a shop; get a returning organizer back to their
dashboard. Manine's three-states note lives here.

- **Unrecognized visitor:** lead with **"Set up a shop in five minutes — no
  inventory, no money up front."** One primary CTA. Below it, a *real* example
  shop (Manine's-Baseball-Club-style) as living proof, not an abstract "how it
  works." **[gap — today's home leads with a published-image feed.]**
- **Recognized organizer:** land on or route straight to the dashboard — their
  shop, their link, recent sales. No pitch.
- **Recognized buyer (no shop):** "Start a design" / browse. The current behavior.

This three-way split is **[new]** as an explicit, tested branch.

### `/dashboard` Organizer back office **[new]**

Job: the organizer's home base.

1. **Shop card(s)** — name, accent, the share link with a one-tap **Copy link**
   (the single most important control for this persona).
2. **Sales summary** — units sold, by design. Plain numbers.
3. **Designs in the shop** — add / remove / reorder.
4. **Create a shop** (if none) — primary.

### `/shop/[slug]` Storefront **[new]**

Job: the buyer's whole experience. The link the organizer shares lands here.

1. **Shop header** — store name, organizer's accent, one line of description.
2. **Listing grid** — the shop's designs on their backdrops; tap → buy.
3. **Per-listing buy** — size + color + price, one **Buy** primary. Account only
   demanded at checkout (anonymous plugin).
4. No studio, no chrome that implies "make your own." This is a store.

Generalizes today's `/prints` + `/d/[imageId]`, scoped to one organizer.

### `/design` Studio (`app/design/page.tsx`) — **fixes the mobile bug**

Job: turn a described idea into a generation worth selling.

1. **Composer** (`app/design/chat-panel.tsx`) — today crams upload + input + Send
   + Draw it + Compare into one non-wrapping row (`chat-panel.tsx:297`). **[gap —
   collapse to one input + one primary; demote Compare into the gallery/overflow.
   Phone-first single row that wraps.]**
2. **Quick replies** — when the assistant asks a multiple-choice question (style,
   direction), it returns **structured options** the UI renders as tappable
   **QuickReply** chips. Today the assistant is told to *number* options
   (`ai.ts:27-30`) and they render as inert markdown text (`chat-panel.tsx:256`),
   forcing the user to **type a number** — unusable on a phone. **[gap — the
   highest-value mobile fix; Phase 0 of the plan.]**
3. **Style up front.** Manine's complaint: being asked "what style?" *after*
   typing is backwards. Offer styles as quick-reply chips from the first turn, so
   the question rarely needs asking. **[gap.]**
4. **Message thread** — user bubbles right, assistant markdown left, inline images.
5. **Mobile Sheet** + count FAB (`app/design/mobile-gallery-drawer.tsx`) — the
   phone gallery; auto-opens after each generation.
6. **Generations Rail** (`app/design/image-gallery.tsx`) — desktop 320px;
   thumbnails, selection border, **Make Products →** exit.
7. **Lightbox** (`app/design/image-lightbox.tsx`) — per-image: Make Products,
   Publish/Add-to-shop, Delete.
8. **Empty state** — centered hero composer; example chips after 8s idle. (Keep
   one implementation; the second in-thread variant is near-dead **[gap].**)

### `/preview` (`app/preview/page.tsx`)

Job: convince that the design works on a real product.

1. **Stage / mockup hero** — Printful render; click-to-zoom; error + Try again.
2. **Use this design →** exit to /order (or **Add to shop** in the organizer flow
   **[gap]**).
3. **ColorPicker** + product selector.
4. Front/Back toggle + back-source picker (flag `MULTI_PLACEMENT_ENABLED`, +$8).
5. Design-size slider.

### `/order` (`app/order/page.tsx`)

Job: confirm size/price, hand off to Stripe.

1. **Buy now — $X.XX** — phone: **sticky bottom bar**.
2. **Pricing breakdown** — product, back (+$8 conditional), shipping ($4.69),
   total.
3. **SizePicker / ColorPicker** (`components/product-options.tsx`).
4. **Add to cart** (flag `CART_ENABLED`).

### `/order/confirm`, `/cart`, `/designs`, `/orders`, `(auth)`, `/admin*`

Unchanged in role from the prior draft; see git history of this file for the full
prior inventory. The pivot touches them only where noted: `/designs` gains an
**Add to shop** action; `/orders` is the buyer's post-purchase home; admin is
unaffected.

### Resolved since the first draft

- Geist font restored (`cbedcbe`).
- 40 raw `gray-*` + 4 dead tokens swept to semantic (`cbedcbe`).

### Open gaps (ranked)

1. **Quick-reply chips** — kill "type a number." Phase 0. *(mobile, highest value)*
2. **Store entity + organizer flow** — the pivot itself. Phases 1–3 of the plan.
3. **Homepage three-state branch** — organizer / returning / buyer.
4. **Composer collapse** — one input, one primary; Compare demoted.
5. **Style-up-front** — quick-reply styles from turn one.
6. **Nav IA** — Dashboard-first for organizers.
7. **Badge palette** — 11 hues → 4 semantic.
8. **Per-store accent token** — the one sanctioned brand color.

Implementation sequencing and tests: `docs/organizer-pivot-plan.md`.
