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
6. Order CTA: "Buy now" (no price before size + garment are picked — see Part 2, Pricing rule)
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
6. Order CTA: "Print it" (no price before size + garment are picked — see Part 2, Pricing rule)
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

1. Hero: **"PRiNT your brAIn"** / "Type it — See it — Wear it"
2. Placeholder: "Describe a design"
3. Chips: drawn at random from the 300-prompt library in
   `src/lib/design-examples.ts`, not a fixed set of strings.
4. Generating: "Generating…"
5. Empty `/designs`: "No designs yet." + [New design]
6. Order CTA: "Order" (no price before size + garment are picked — see Part 2, Pricing rule)
7. Confirmation opening: "Order confirmed."
8. Error: "Generation failed. You were not charged."

**Note on the hero copy:** "PRiNT your brAIn" / "Type it — See it — Wear it"
breaks voice principles 1 and 4 above — it is playful, and it is not
sentence case. That is a deliberate owner override of persona C for this one
surface (the hero), not a drift the sweep missed. A future copy sweep back to
persona C should leave the hero headline and subline as they are.

**Visual deltas from ink/paper base**

- Quieter still: no 8s-delay chip reveal (chips always visible, catalog-
  style), more whitespace, `/shop` grid gets stronger catalog emphasis
  (bigger cards, less metadata).
- Badge palette collapses hardest here (neutral + one status color pair).
- No decorative elements of any kind; the paper well stays (it's functional).

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

> **DECIDED 2026-07-19: Option C — The Clean Label** (Nico). The doc's
> recommendation was A; C's case — neutrality that holds up as organizer
> storefronts grow — carried. Copy sweep to C's principles is the next
> persona task; the sections below are kept as the record of the choice.

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

PRNTD is a print shop. The interface is the counter: warm paper, quiet,
monochrome. The customer's artwork is the only colour on the screen — every
hue the chrome claims for itself competes with the design being made, so the
chrome claims almost none. A primary action is an outlined ink button on the
ground, not a filled one; the single filled accent is rose, and it means "the
render happens now" (wordmark and Generate only).

This direction's structure — one shared monochrome visual base under Option A
or C, with Option B amending it (one ink accent, mono promotion — see above)
— still holds. Its specific palette does not: the base was re-specified in
2026-09 as Paper (variant PaperB "quieter", `docs/ux-design-review-2026-09.md`)
— warm off-white ground, outlined ink as the primary control, light only, no
dark-mode mechanism. See Tokens below for the current values.

Three principles:

1. **Ink and paper.** Chrome is monochrome. Color belongs to generations,
   mockups, and product swatches only. (Current exceptions: the status pair
   on badges — positive/negative text color, see Gaps, item 1, RESOLVED —
   and `--accent-rose` on the wordmark and the Generate button, see Tokens.)
2. **One primary per screen.** Each screen has exactly one emphasized action:
   the next step in the funnel, styled as the outlined-ink `primary` button
   variant — or, on the Studio composer submit and the landing hero, the
   solid rose `generate` variant. Everything else is `secondary` (outline),
   `ghost`, or a plain link. (The old equal-weight Send / Draw it / Compare
   composer is resolved — #174 collapsed the composer to one submit control
   that generates, with chat kept to a separate, visibly lower-weight "Ask"
   tap. See Gaps, item 5, RESOLVED.)
3. **Phone-first, one column.** The phone layout is the design; desktop gets
   extra space, not extra features. Anything desktop-only (e.g. the
   generations strip beneath the Stage — `DesignStage`, #151) must have a
   phone equivalent (the mobile gallery drawer/strip), not be dropped.

### Vocabulary

Shared nouns for design conversations. Code names in parentheses where they
differ.

**Objects**

- **Design** — a thread: the conversation plus all its generations. One row in
  `design`, one `/design?id=` URL.
- **Generation** — one numbered render inside a design (an `image` row,
  linked to its conversation via `conversation_image`; `design_image` was
  dropped in Model B slice 5, migration `0009`). Append-only; never replaced.
- **Print** — a published generation. Lives in the Shop, has a title,
  description, and backdrop. Publishing writes a `listing` row (keyed on the
  image id) that grants visibility (`published_at`, `is_hidden`); the
  sellable fields — title, description, backdrop, feed rank — are read from
  the image's mirror `product` row (composition slices 2–4, `storeId` and
  `designId` both null), not from `listing` (whose same-named columns are now
  a frozen, unread mirror pending composition slice 5).
- **Mockup** — a generation placed on a physical product (Printful render).
- **Product version** — a generation re-rendered for a specific product's
  print area (placement render).
- **Backdrop** — the shirt-palette color a Print is displayed on; the paper
  well when unset.
- **Swatch** — a selectable product color circle.

**Places**

- **Studio** — `/studio` (Bench · Library · Archive, nav model A,
  `docs/ux-design-review-2026-09.md`). Where designs are made (Bench) and
  organized (Library, Archive). One conversation thread lives one level in,
  at `/design`.
- **Shop** — `/shop`, the community storefront (renamed from "Fresh
  Prints" 2026-07-19). Organizer stores were also shops (`/shop/[slug]`,
  each a self-contained storefront) — retired 2026-09-05 (#191):
  `STORES_ENABLED` is off in Production and Preview and there is no live
  entry point; `/shop/[slug]` and `/dashboard` remain as files until
  composition slice 5 (held, PR #201) drops the underlying tables. No
  replacement — organizer storefronts are retired outright, not replaced.
- **Funnel** — Studio → Preview → Order → Confirm. Linear, breadcrumbed.
- **Shelf** — the personal library of owned work: `/studio/library` (every
  owned image) and `/orders`. Distinct from `/studio/archive`, Studio's own
  view of idle conversations (Model B `closed`/#181-swept threads) —
  "archive" now names two different things, so Shelf is glossed as library,
  not archive.
- **Counter** — `/admin`. Back of shop.
- **Dashboard** — `/dashboard`. Where organizers ran their shops. Retired
  2026-09-05 (#191): the file still exists but has no live entry point (see
  Shop, above); no replacement.

**Surfaces & regions**

- **Stage** — the dominant artwork area of a screen (mockup hero on /preview,
  image on /d/[id]). One Stage per screen, as large as the viewport allows.
- **Composer** — the chat input row in the Studio (input + actions). Also the
  signed-out landing hero (`MakerHero`) — the landing is the composer.
- **Rail** — retired by #151 (2026-08-02). The desktop layout is now
  `DesignStage`: the current image at full size, a generations strip
  beneath it, chat a fixed-width column beside. There is no separate
  right-side sidebar.
- **Sheet** — a bottom drawer on phones (`MobileGalleryDrawer`, opened from
  the thumbnail strip docked above the composer, `MobileGalleryStrip`). Now
  the only surface carrying this pattern, since the Rail it used to pair
  with is gone.
- **Lightbox** — full-screen image overlay with per-image actions.
- **Sticky bar** — the fixed bottom CTA bar on phone funnel pages (/order).
- **Chip** — a small pill-shaped tappable suggestion (example prompts, filter
  tabs).

**States**

- **Thinking** — waiting on a chat reply (~3–6s).
- **Drawing** — waiting on a generation (~6–15s). Copy: "Generating…"
  (persona C, shipped 2026-07-19, PR #79, `chat-panel.tsx` `DrawingStatus`).
  A's "Drawing your design…" and B's "Pulling your print…" were never
  shipped and are historical — see Part 1.
- **Ready nudge** — `assessReadiness` and `READINESS_SYSTEM_PROMPT` were
  deleted in #174 (2026-08-30/31); there is no scoring step left to pop a
  button between weights. What remains: readiness colours a hint line under
  the composer ("Add more detail, or tap Generate.") when the idea looks
  thin, never the button itself — Generate is always primary (or the rose
  `generate` variant on the Studio composer) and always generates
  (`chat-panel.tsx` `showStyleHint`).

### Tokens

Defined in `src/app/globals.css` (Tailwind v4 `@theme inline`). Semantic, not
literal — components must use these, never raw `gray-*` / hex.

**Paper (variant PaperB, "quieter") — light only, shipped 2026-09.** There is
no dark-mode mechanism: no `prefers-color-scheme` branch, only tokens. Every
token below is warm off-white ground + near-black ink, mixed toward each
other for the intermediate steps — never an inverted grey-on-black ramp.

Ground + ink:

```
--background   oklch(0.97 0.008 80) ≈ #f8f5ef   page ground (warm off-white)
--foreground   #141311                          ink (primary text)
```

Surfaces (no elevation shadows anywhere — 1px borders are the only
separator):

```
--surface         #ffffff   inputs, plain paper wells
--surface-raised  #ffffff   cards (same paper; a border does the work)
--surface-well    #e6e3dd   media/transparency well — ink mixed 8% into the
                             ground. Replaces the checkerboard: see
                             `.bg-checkerboard` below.
(overlay)         ink/20%   modals, lightbox scrim   [gap: not yet a token]
```

Line + text — muted/faint are ink mixed 24% / 40% toward the ground. Both
clear 4.5:1 on the ground: `text-faint` is used at `text-sm` across ~90
call sites on substantive copy (not just fine print/decoration), so it has
to pass AA for normal text the same as muted, not just the 3:1 large-text
floor:

```
--border          #bfbdb8   resting (hairline) — ink at ~25% over the ground
--border-hover    #141311   hover/focus/emphasis — solid ink, 1px
--text-muted      #4b4946   secondary text — ink 24% toward ground
--text-faint      #6f6d6a   tertiary/metadata — ink 40% toward ground
```

Accent — the one inversion is now ink-on-ground (an outlined ink button),
not a filled white-on-black chip; `accent`/`accent-fg` alias the ink/ground
pair directly so any future filled-ink surface stays correct by construction:

```
--accent      var(--foreground)   ink
--accent-fg   var(--background)   ground (text on an ink fill)
```

Rose — ONE accent hue in the whole system ("One Mark"): the wordmark and the
solid Generate button (Studio composer submit, landing hero Generate).
Nothing else is rose. A fuller rose palette may come later as a token-only
swap — every rose reference in the app must go through this token.

```
--accent-rose   #a83250
```

Status pair (Clean Label): money-in/terminal-good vs money-out/destructive.
Chrome stays monochrome otherwise — recoloured for the light ground (were
dark-theme `#4ade80`/`#f87171`):

```
--positive   #166534
--negative   #b91c1c
```

**Computed AA contrast ratios** (WCAG relative-luminance formula; ≥4.5:1 is
AA for normal text, ≥3:1 for large text/UI components):

```
ink       (#141311) on ground (#f8f5ef)  → 17.06:1
muted     (#4b4946) on ground            →  8.25:1   (passes AA normal text)
faint     (#6f6d6a) on ground            →  4.74:1   (passes AA normal text)
rose      (#a83250) on ground (#f8f5ef)  →  5.96:1   (passes AA normal text)
rose      (#a83250) on white (#ffffff)   →  6.49:1   (passes AA normal text)
ground    (#f8f5ef) on rose fill (#a83250) → 5.96:1  (solid Generate button — the button is bg-accent-rose text-background, not white text)
positive  (#166534) on ground            →  6.55:1
negative  (#b91c1c) on ground            →  5.95:1
```

Utility: `.bg-checkerboard` — was a literal checkerboard (transparency
indicator for raw PNGs); on paper that read as noise, so it's now a plain
well (`background-color: var(--surface-well)` only — call sites that want
an edge add `border border-border` themselves; the class must never set
`border`, see gap #4). The class name is kept so existing call sites keep
compiling.

### Type

Geist Sans / Geist Mono, tokenized (`--font-sans`, `--font-mono`). The old
Arial body override was fixed on main 2026-06-14 (`cbedcbe`) — body renders
Geist now.

Scale in use (Tailwind steps), roles:

- `text-2xl sm:text-5xl bold` — page hero (`MakerHero` h1 on `/`; `/prints`
  is now a bare 308 redirect to `/shop`, not a hero page — see Vocabulary,
  Shop)
- `text-lg/xl semibold` — screen title
- `text-sm font-medium` — card titles
- `text-sm` — body, chat
- `text-xs text-text-muted` — metadata
- `text-xs text-text-faint` / `text-[10px]` — fine print
- `font-mono text-[11px] leading-4 tracking-[0.08em] uppercase` — mono
  label. Not in the original draft; now the most-used label type in the app
  (12+ call sites incl. the Shop/`/orders` mastheads, `Badge`, `EmptyState`'s
  `label` prop, `SizePicker`/`ColorPicker` section labels — shared as
  `MONO_LABEL` in `src/app/d/[imageId]/mono-label.ts`). Fills the role
  "section labels" used to name above.
- `font-mono` — IDs, codes, money references (Option B widens this role to
  generation numbers, prices, and labels)

### Component grammar

Ten primitives in `src/components/ui/` — the only sanctioned building
blocks. Five in the original draft (Button, Badge, Card, Input, Modal);
`ConfirmSheet`, `NoticeSheet`, `InlineNotice`, `EmptyState`, and `QuickReply`
were added since, mostly by the #218 alert sweep:

- **Button** (`button.tsx`) — variants `primary` (outlined ink, not
  inverted), `secondary` (outline, muted), `danger` (outline, reddens on
  hover), `ghost`, and `generate` (solid rose fill — reserved for the Studio
  composer submit and the landing hero Generate button); sizes sm/md/lg.
  Rule: one emphasized action (`primary` or `generate`) per screen.
- **Badge** (`badge.tsx`) — a mono uppercase text label, no pill/background/
  radius. 11 status variant names, palette collapsed to neutral +
  positive/negative (see Gaps, item 1, RESOLVED).
- **Card** (`card.tsx`) — `surface-raised` + border + `rounded-lg`.
- **Input** (`input.tsx`) — `surface` background, a 1px ink
  (`border-foreground`) border at rest, an ink focus ring layered on top
  (not a border-color swap); `surface-well` only when disabled.
- **Modal** (`modal.tsx`) — `bg-foreground/20` scrim (ink at 20%, not
  black), centered dialog, Escape-closes (wins over Escape-to-go-up). Base
  for `ConfirmSheet` and `NoticeSheet` below.
- **ConfirmSheet** (`confirm-sheet.tsx`) — a `Modal`-based confirm dialog
  (title/body + Confirm/Cancel, optional `danger` styling) behind the
  `useConfirm` hook; replaced every `window.confirm` call (#200).
- **NoticeSheet** (`notice-sheet.tsx`) — `ConfirmSheet`'s one-button
  sibling: acknowledge-only, for a failure with no stable inline slot (a
  lightbox, a drawer, a thread header). Behind `useNotice`.
- **InlineNotice** (`inline-notice.tsx`) — one line of result copy next to
  the control that produced it, for a failing control that stays on screen;
  `negative`/`neutral` tone, an optional admin-only diagnostic `hint`. Copy
  constants live in `src/lib/action-copy.ts` (#218).
- **EmptyState** (`empty-state.tsx`) — the one shared "nothing here yet"
  block (optional mono label, one line of muted copy, one action), used on
  the Studio bench, Library, Archive, Shop, Cart, and Orders. `/design`'s own
  empty-conversation views do not use it — see Gaps, item 3.
- **QuickReply** (`quick-reply.tsx`) — tappable chat-option chips rendered
  under an assistant message; a tap submits `value` as the next turn.

Composites built from these: `SizePicker`/`ColorPicker`
(`product-options.tsx`), `PublishModal`, `PublishedGrid`, `Breadcrumbs`,
`BuyPanel`, `MakerHero`. `ComposeForm` (organizer product compose) is under
the retired `/dashboard` (#191, see Vocabulary) — the file exists, but has
no live entry point.

Interaction grammar:

- Radius: `rounded-md` controls, `rounded-lg` cards/images, `rounded-full`
  chips (example prompts, filter tabs) and circular icon buttons (e.g. the
  image detail page's back arrow). Badges carry no radius at all now (a mono
  label, not a pill — see Component grammar); the numbered gallery FAB was
  removed in #89 and no longer exists. A pattern not in the original rule: a
  container on a ruled surface (the admin/published grid card, an `/orders`
  thumbnail well) carries a hairline `border` and NO radius — square, not
  rounded.
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

1. ~~**Badge palette is the only chrome color**~~ — RESOLVED 2026-07-19 under
   C: `--positive`/`--negative` tokens added; badges collapse to a neutral
   pill with status carried by text color (shipped/delivered = positive,
   canceled = negative, everything else neutral; no `--attention` — pending
   states are neutral under C). Raw `green-400`/`red-400` classes swept onto
   the tokens (admin money coloring, error lines, danger button hover).
2. ~~**Dark-only is implicit, not declared**~~ — RESOLVED 2026-09-06 under
   Paper: the app is light-only by tokens now (`docs/ux-design-review-2026-09.md`,
   variant PaperB "quieter"), and there is no `prefers-color-scheme` branch
   to declare or theme around — the halfway state this gap warned about is
   gone because there's only one mode. The dark-literal sweep (`bg-gray-900`,
   `bg-black/*`, `text-white`, `shadow-*`) that made the old dark-only brand
   implicit is complete (#188 slice 1) — zero matches outside tests.
3. **Two empty-state implementations remain in a design's conversation
   thread** (`/design`, `chat-panel.tsx`) — the page-level empty state (no
   messages and no images at all) and a second, in-thread variant shown once
   images exist but no message has been sent yet. Neither uses the shared
   `EmptyState` primitive (`src/components/ui/empty-state.tsx`, added since
   the original draft); that primitive unified the OTHER hand-rolled empty
   states across the app (Studio bench, Library, Archive, Shop, Cart,
   Orders), but `/design`'s two were never among them and both still render
   on a live path — this is not near-dead code. (Vocabulary correction: this
   gap's original wording said "in the Studio" — "Studio" now names
   `/studio`, not `/design`; fixed here.) Persona-independent cleanup, but
   the surviving copy is persona-dependent (see Part 1 samples).
4. **"Selected image" is load-bearing but nearly invisible** — a 2px border
   decides what Make Products ships to /preview. Persona-independent problem;
   B's ink accent gives it a free fix, A/C need a heavier white treatment
   (thicker ring + dimmed siblings). **Incident, 2026-09-06:** the Paper
   slice-1 rollout's `.bg-checkerboard` alias briefly made this worse than
   "nearly invisible" — it set an unlayered `border` that overrode the 2px
   `border-accent` selection indicator outright on five thumbnails/swatches
   (preview back-picker, /d back-picker, conversation-images aria-current,
   design-stage strip, studio isPrimary), so the selected state rendered no
   differently from an unselected one. Caught in the slice-1 whole-branch
   review, fixed (the alias no longer sets a border), and guarded by a test
   asserting the rule stays border-free. This gap itself — the 2px border
   being weak even when it renders — is unchanged and still open.
5. ~~**Three composer actions at equal weight**~~ — RESOLVED 2026-08-30/31
   under #174 (studio slice 1): the composer has exactly one submit control,
   labelled "Generate" (persona C), and it always generates. Chat is still
   reachable but only via a separate, visibly lower-weight "Ask" tap
   (`variant="ghost"` vs. the submit's `variant="primary"`/`"generate"`).
   `chat-panel.tsx` `handleSubmit`/`handleAsk`.
6. ~~**Accent = white means no brand color exists.**~~ — RESOLVED 2026-09-06
   under Paper (#213): false twice over now — `--accent` resolves to ink
   (`var(--foreground)`), not white, and one brand hue does exist:
   `--accent-rose`, the "One Mark" rule (the wordmark and the `generate`
   Button variant, nothing else). Option B's old "single ink accent" idea is
   superseded by this narrower, already-shipped rose accent.
7. ~~**Internals leak into customer copy**~~ — RESOLVED: Compare, and its
   generator-naming tooltip, was removed entirely in #56 (2026-07-19). A
   repo-wide grep for "Compare" and for generator/`Ideogram` naming in
   `src/app`/`src/components` (excluding tests) found no remaining
   customer-facing hits. Order status text on the customer-facing `/orders`
   page is fully relabeled (`statusLabel` in `orders-list.tsx` covers all six
   statuses) — no raw enum value reaches a customer there. `/admin`'s order
   list still renders `{order.status}` raw, but that is an ops surface, not
   customer copy, and was never in this gap's scope.

---

## Part 3 — Page inventory

Every page, every visible component, ranked by importance to the page's job
(1 = the page fails without it). Mobile/desktop splits and flag gates noted.
File paths relative to `src/`. Inventory updated for the maker landing
(2026-07-05) and organizer pages; copy called out below is persona-dependent
and covered by Part 1's samples.

### Global chrome (`app/layout.tsx`)

1. **SiteHeader** (`components/site-header.tsx`) — logo, nav (Studio /
   My Designs / Shop / Orders, Dashboard behind `STORES_ENABLED`; "New
   Design" removed 2026-09-01 — the Studio composer starts new work), cart
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
6. **Pricing line** — REMOVED (2026-09-08). **Pricing rule (owner, Nico):
   no price is shown anywhere before the buyer has picked garment and size.**
   The item floor ($19.43) excludes the $4.69 shipping line, so it is a number
   nobody pays; it shipped as "false" or "fake precision" four times (hero
   #214, Pricing section #215, Order button #131, Shop card + image-detail
   PRICE row 2026-09-08). Price surfaces are the expanded buy panel total, the
   cart, Stripe, and receipts. `src/lib/__tests__/no-preselection-price.test.ts`
   enforces it — do not add a price line, a "From $" string, or a catalog-floor
   helper.
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

1. Ruled receipt — mono opening line (= Part 1 surface 7), order ID (mono),
   per-line thumbnails, size/color, total. Server-rendered, so the first paint
   is the receipt; the decorative checkmark went with the Paper sweep.
2. **View My Orders** (primary) + Start another design (underlined link).
3. Three states: the receipt, order-not-found, and receipt-couldn't-be-loaded
   (a caught loader failure, which must not read as a failed payment).

### `/cart` (`app/cart/page.tsx`) — flag `CART_ENABLED`

Job: review the bundle and check out once.

1. **Checkout — $X.XX** (primary).
2. **Item list** — thumbnail, product, color/size, front+back marker, qty,
   unit×qty price, Remove.
3. **Pricing summary** — items subtotal, bundled shipping, total.
4. Add another design (secondary); empty state → Start a design.

### `/shop` Shop (`app/shop/page.tsx`)

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

1. **Order rows** (ruled, no Card) — status Badge (mono text under Paper, no
   pill), per-line thumbnail on shirt color, name/ID, price, size/color,
   front+back + ×qty markers, date, **Track shipment** link, designer
   attribution when bought from someone else.
2. **Filter tabs** — underlined text, Active (N) / Canceled (N) / All (N).
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
