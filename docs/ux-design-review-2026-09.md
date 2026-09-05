# UX design review — September 2026

Written 2026-09-04 against main (`a269001`), from code plus screenshots of a
compiled build on `:3100` with the funnel flags on and a seeded dev DB
(12 published listings, three conversations, one draft store). Screenshots
are at `/private/tmp/claude-501/-Users-nico-src-prntd/929ee2b1-ceef-4e62-97da-104150c4eca9/scratchpad/ux-review/<route>-<390|1440>.png`
and do not survive the session. Not screenshotted: `/admin/*` (needs
`ADMIN_EMAIL`, which is a secret), `/preview` with a back design, `/orders`
and `/cart` with rows, `/shop/[slug]/[productId]` (no listed product in dev),
`/dashboard/products/[id]/edit`, `/reset-password` with a token.

Target: Look "Paper", variant "PaperB quieter" — warm off-white ground
`oklch(0.97 0.008 80)`, ink `#141311`, 1px ink-bordered cards with no shadow,
outlined ink primary button, underlined ink links, sparse mono labels, Geist.
Light only. Site-wide rollout is #188; the Studio-specific work is #187.
Persona stays The Clean Label (`docs/design-system.md` Part 1).

## Summary

Four things make the site read as undesigned, in order of weight:

1. **No composition, only stacking.** Every page is `h1` + a centred column of
   unstyled controls at one size. Nothing is placed; whitespace is uniform
   padding, not layout. The Studio at 1440px is two thumbnails in the top-left
   of an empty 900px-tall page with the composer 800px away at the bottom.
2. **Default-dark chrome with white-on-black buttons** is the look of every
   AI tool's demo. The palette in `globals.css:4-17` is literally
   `#0a0a0a`/`#ededed`; the primary button is `bg-accent` white. Paper fixes
   this by definition, but only if the ~20 hardcoded darks listed below go too.
3. **Five surfaces claim "my work"** (Studio, Archive, My Designs, thread,
   image page) and two things are called "Shop". The nav is a list of tables.
4. **Artwork is shown on the wrong ground**: chat inline images have no
   backdrop (`chat-panel.tsx:309-313`), so a black-ink design is invisible on
   the dark thread; publishers can pin a Black backdrop under dark ink
   (screenshot `prints-390`, "Sunset palms"). Under Paper the inverse bites
   white-ink art.

Proposed order: tokens + primitives (slice 1) → nav model (slice 2) → the four
mocked screens in the order Studio bench, focused stage, `/d`, `/prints` →
remaining routes mechanically → emails/OG/favicon last.

## Nav model

**What exists** (`src/components/site-header.tsx:102-111`). Signed in:
Studio · My Designs · Shop · Orders · [Dashboard] · [Admin] · Cart · Feedback ·
Sign out · build date. Signed out: Shop · Cart · Feedback · Sign in. Desktop
links are `text-xs text-text-muted` (`:168-176`), so the whole nav reads as
footer text. Mobile is a hamburger with a right-aligned `text-lg` list
(`:202-262`). `/` redirects signed-in users to `/studio`
(`src/app/page.tsx:25-26`).

**Why it confuses.** "My work" is reachable on five surfaces, each with a
different unit and a different verb set:

- `/studio` — open _conversations_ as lanes; tap cell = anchor; Close/Delete
  per lane (`studio-client.tsx:380-403`).
- `/studio/archive` — closed conversations; Reopen (`studio/archive/page.tsx`).
- `/designs` "My Designs" — every owned _image_, flat grid, Archived/Published
  markers (`designs/library-grid.tsx:24-56`).
- `/design?id=` — the thread: chat + stage, Close, Make Products, and its own
  breadcrumb reads "Design" while the nav says Studio (`design-stage.tsx`,
  `chat-panel.tsx`). The lane title on the bench links here
  (`studio-client.tsx:375-380`), so Studio → thread → `/d` → `/preview` is a
  four-page walk to order something you just made.
- `/d/[imageId]` — image page: Order, Publish, Open conversation, Delete
  conversation, siblings strip (`d/[imageId]/page.tsx:88-119, 143-197`).

And two "Shops": `/prints` is the community feed labelled Shop
(`prints/page.tsx:10-16`, "Designs published by other makers."), and
`/shop/[slug]` is an organizer storefront. The footer's "Open a shop →" goes
to `/dashboard`, a third meaning. `/orders` and `/cart` empty states send
people to `/design`, not `/studio` (`orders-list.tsx:56, 82`; `cart/page.tsx`),
so "New Design" still exists as a door even though the nav deleted it.

**Candidate models.**

A. _Two verbs + account menu (recommended)._ Nav = **Studio** (make) ·
**Shop** (buy) · account. Studio holds bench, library and archive as three
views (tabs or a segmented control) at `/studio`, `/studio/library`,
`/studio/archive`; the thread and image page become detail views _inside_
Studio with a consistent back target. Orders, Dashboard, Admin, Sign out and
the email live under an account menu (initial or "Account"). Organizer
storefronts keep `/shop/[slug]` but are never in the nav — they are someone
else's site. Tradeoffs: two-tap reach for Orders; `/designs` becomes a redirect;
the Studio needs a sub-nav it does not have. Cost is mostly the sub-nav and
retargeting ~12 links.

B. _Three nouns._ Studio · Designs · Shop, Orders under account. Keeps the
bench/library split visible in the top bar since the plan
(`docs/studio-plan.md`) argues they are different jobs. Tradeoffs: still two
"my work" tabs, still the archive as an orphan, and "Designs" vs "Studio" is
the distinction Nico already called incoherent.

C. _Bottom tabs on phone._ Studio · Shop · Cart · Account as a bottom bar,
top bar only for the wordmark. Studio-plan slice 5 deferred this. Tradeoffs:
the Studio composer is already docked bottom (`studio-client.tsx:282`), so the
bar and the composer fight for the same 60px; #187 moves the composer up top,
which would make C viable later. Not first.

Recommend A now, with C as the phone follow-up once #187 lands. Whatever is
picked, the four route-level fixes are the same: one unit per page, one
back target per detail view, the word Shop used for exactly one thing, and
the community feed renamed if it is not the thing.

## Route-by-route

Format: purpose · what is generic or wrong · verdict · Paper notes.

**`/` landing** (`src/app/page.tsx`, `components/maker-hero.tsx`). Composer
hero + Shop teaser + Pricing + footer. Generic: centred `text-5xl` headline
over an input is the AI-tool template; the Pricing section (`page.tsx:60-70`)
is a second hero-sized block for one sentence; the Shop `h2` is centred bold.
Keep, restructure: hero left-aligned in a text column, price as a mono
sub-line, Shop as the first real content, Pricing folded into the footer.
Paper: input on paper with an ink border, outlined Generate, chips as
underlined text or bordered pills, no `bg-surface` band.

**`/studio`** (`studio/studio-client.tsx`). Bench. Wrong (from #187 and the
1440 screenshot): composer docked off-screen (`:282`), title row is
`text-sm` + three `text-xs` links at equal weight (`:367-403`), lanes are 112px
thumbnails on checkerboard with nothing separating them, no optimistic
pending cell — `submit()` awaits the action before `pollOnce()` (`:161-185`)
so the page is silent for seconds. Empty state is "No open designs." +
"Browse the Shop" (`:255-267`) for a page whose job is making. Change per
#187 (mock first). Paper: the checkerboard is the wrong ground for
thumbnails on paper (see components); lanes as ruled rows with a mono index.

**`/studio/archive`**. Closed conversations list with Reopen. Fine as a
list; wrong as a top-level page. Merge into Studio as a view. Paper: ruled
rows, outlined Reopen.

**`/designs` My Designs** (`designs/page.tsx`, `library-grid.tsx`). Flat
3-col image grid. Generic: no hierarchy at all — 3 columns of identical
tiles with a `text-xs` marker. Merge into Studio (library view). Keep the
grid, add a sort/filter line (Published, Archived) in mono.

**`/design?id=` thread** (`design/page.tsx`, `design-client.tsx`,
`chat-panel.tsx`, `design-stage.tsx`). Chat + stage. Wrong: mobile is a chat
transcript with images at `max-w-[200px]` and no backdrop (`chat-panel.tsx:309-313`),
so dark designs disappear; user bubbles are grey slabs; a 4-row bottom stack
(strip + upload + input + Generate + Ask) eats 200px of a phone. Desktop stage
(`design-stage.tsx:57`, `hidden md:flex`) is the right idea; `#N` labels sit
on `bg-black/70` (`:105`). Change: this becomes #187's focused stage —
tapped image large, composer directly under it, chat demoted to a history
disclosure. Paper: image on a bordered card, chat as a plain transcript with
hairlines, no bubbles.

**`/d/[imageId]` image page** (`d/[imageId]/page.tsx`, `buy-hero.tsx`,
`buy-panel.tsx`). Image detail + buy. Wrong: two visually identical
full-width buttons ("Order" white, "New design from this image" outlined)
directly under a `text-lg` title; the owner branch stacks seven small links
(`page.tsx:88-119`: Not published, Publish, Open conversation, Delete
conversation, Forked from…) at `text-sm` with no grouping; the expanded buy
panel is a 1,200px column and the floating Feedback pill sits over "Add to
cart" (`d-published-order-expanded-390`) because `isFunnelRoute` does not
include `/d`. Keep, re-lay: title/designer/price as one mono-labelled block,
Order primary, everything else in a small-text action row. Paper: the
storefront backdrop stays a real fill (it is the buyer's colour choice);
the back-arrow button (`page.tsx:162`, `bg-black/45`) becomes an ink circle.

**`/preview`** (`preview/page.tsx`, 1,275 lines, client). Mockup + picker +
order. Wrong: `h1` "Preview your Classic Tee" (`:781`) is a marketing
sentence for a screen title; the mockup card is a light panel
(`mockupBackdrop`, `:909`) floating on black — under Paper it will finally
sit on a ground that matches; the sticky bar shows "Choose a size" + a greyed
Order at 30% opacity (`ui/button.tsx:29`, `disabled:opacity-30`), which
reads as broken; 25 swatches in a row with 44px targets on a 390 screen wrap
to four lines. Keep; this is the money screen and works. Paper: price in
mono, section labels in mono caps, one outlined primary, secondary as text.

**`/order`** — a redirect (`order/page.tsx`). Drop from the map.

**`/order/confirm`** (client, `Loading…` centred string `:38-44`). Keep;
render server-side so the first paint is the card, not "Loading…".

**`/cart`** (client, `cart/page.tsx`). Wrong: empty state CTA "Start a
design" → `/design`. Keep; retarget; ruled rows instead of Cards.

**`/orders`** (`orders/orders-list.tsx`). Wrong: header button "New Design"
→ `/design` (`:56`), filter chips are three tiny buttons, each order is a
Card with a Badge. Keep under the account menu; ruled rows, mono ids/dates.

**`/prints` community feed** (`prints/page.tsx`, `components/published-grid.tsx`).
Wrong: centred `text-3xl` "Shop" + a sub-line that says the opposite of what
the composition decision wants ("Designs published by other makers" — the
Shop sells shirts, `docs/object-model-composition.md`); cards are
`rounded-md` tiles with `group-hover:border-accent`; no price on a shop card.
Keep, rename the route to `/shop` eventually (the organizer namespace is
`/shop/[slug]`, so this needs the slug-collision rule settled), add price and
garment name, make it the fourth mock.

**`/shop/[slug]` + `/shop/[slug]/[productId]`** organizer storefront. Wrong:
it renders inside PRNTD's header and dark chrome, with an accent-colour dot
next to the name (`shop/[slug]/page.tsx:26-34`) as the only branding; product
page shows artwork on checkerboard (`[productId]/page.tsx:39`) and titles the
page with the blank name (`:48`). Keep; Paper's neutral ground suits it; give
it its own minimal chrome (#45) rather than the site nav.

**`/dashboard`, `/dashboard/products/new|[id]/edit`** (client). Organizer
tools; a Card per store with four equal buttons; the compose form is a long
single column that works. Keep, mechanical Paper sweep; `accentColor ??
"#000000"` (`dashboard/page.tsx:365`) picks ink by default, fine under Paper.

**`/admin`, `/admin/orders/[id]`, `/admin/published`, `/admin/errors`**
(client). Desk tooling; summary cards + table; `Unauthorized` centred string
for non-admins. Keep, mechanical sweep only; tables on paper with hairlines
are the natural fit. Not screenshotted.

**Auth (`/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password`)**.
Centred form, correct. `/sign-in` defaults to `/designs` after login
(`sign-in/page.tsx:42-45`) — should be `/studio`. Paper: ink-bordered inputs,
outlined submit.

## Shared components audit

Primitives live in `src/components/ui/` (`button`, `card`, `badge`, `input`,
`modal`, `quick-reply`). Paper versions:

- **Header** (`site-header.tsx`). Needs: wordmark in ink, nav at body size
  (not `text-xs`), the build date out of the bar (keep it in the account
  menu), the running-jobs badge (`:162-166`) as a mono pill. Dropdown
  `shadow-lg shadow-black/60` (`:202`) → 1px ink border, no shadow.
- **Button** (`ui/button.tsx:3-12`). `primary` = white fill → outlined ink,
  ink text; `secondary` → underlined text or lighter outline; `danger` keeps
  `--negative` on hover; `disabled:opacity-30` (`:29`) reads as broken on
  paper — use a dotted border + muted text instead. One primary per screen
  rule stays; today `/d` and `/preview` both violate it (Order + Add to cart).
- **Input** (`ui/input.tsx:9`). `bg-surface` well → paper fill, 1px ink
  border, ink focus ring. Three inputs bypass the primitive with hardcoded
  `text-white` (`maker-hero.tsx:53`, `studio-client.tsx:329`,
  `chat-panel.tsx:210, 432`); route them through `Input`.
- **Card** (`ui/card.tsx:9`). `bg-surface-raised` → paper, keep border. Most
  list surfaces (orders, dashboard) should stop using Card and use ruled rows.
- **Badge** (`ui/badge.tsx:7-9`). Neutral pill with `--positive`/`--negative`
  text; under Paper become mono uppercase text with no pill, colour only for
  shipped/canceled. Recolour the two status tokens (`globals.css:15-16`,
  `#4ade80`/`#f87171` are dark-theme greens/reds).
- **Breadcrumbs** (`breadcrumbs.tsx:57-61, 64-80`). Fine structurally;
  underline the links, mono the separator.
- **Modal** (`ui/modal.tsx:37`, `bg-black/90` scrim). Paper: `ink/20` scrim
  or a bordered sheet; same for the lightbox (`image-lightbox.tsx:58`) and the
  mobile drawer (`mobile-gallery-drawer.tsx:45`). Publish modal and
  `background-picker.tsx` use the picker swatches — keep.
- **Empty states.** Nine near-identical `text-center py-16` blocks with a
  muted line and a button (`studio-client.tsx:258`, `designs/page.tsx:23`,
  `orders-list.tsx:79`, `cart`, `prints:20`, `archive:38`, `shop/[slug]:37`).
  One `EmptyState` component with a label, one line, one link; CTAs retargeted
  to `/studio`.
- **Feedback launcher** (`feedback-launcher.tsx`). Floating pill overlaps
  sticky bars on `/d`; add `/d` to `isFunnelRoute` or move to the menu only.
- **Chips** (`ui/quick-reply.tsx:27`, hero chips). Bordered pills → outlined
  ink pills or plain underlined text; keep 44px targets.

**Hardcoded darks that must be swept** (light-only means each is a bug, not a
theme leak):

- `src/app/globals.css:4-17` tokens; `:44-52` `.bg-checkerboard` (light grey
  on white — on paper it turns into visual noise; see Q2).
- `src/lib/instant-preview.ts:27-29` `isDarkShirt` is documented as "dark
  enough to vanish against the dark site chrome"; `:39-41` `mockupBackdrop`
  picks `#ececec`/`#f7f7f7` because the site is near-black. Both branches
  need re-deciding on a warm ground (use the page token for light shirts).
  Consumers: `preview/page.tsx:909, 924, 1193`, `d/[imageId]/buy-hero.tsx:167, 183`.
- `bg-gray-900` preview/thumb wells: `design/image-lightbox.tsx:102`,
  `design/image-gallery.tsx:97`, `design/mobile-gallery-strip.tsx:51`.
- `bg-black/*`: `design/image-lightbox.tsx:58`, `design/mobile-gallery-drawer.tsx:45`,
  `design/design-stage.tsx:105`, `design/image-gallery.tsx:62`,
  `preview/page.tsx:1173`, `ui/modal.tsx:37`, `d/[imageId]/page.tsx:162`,
  `d/[imageId]/buy-hero.tsx:107`, `site-header.tsx:202`.
- `text-white` literals (15): `chat-panel.tsx` ×4, `image-lightbox.tsx` ×3,
  `preview/page.tsx` ×2, `buy-hero.tsx` ×2, `maker-hero.tsx`,
  `studio-client.tsx`, `image-gallery.tsx`, `design-stage.tsx`.
- `bg-checkerboard` call sites (14): `studio-client.tsx:289, 426`,
  `studio/archive/page.tsx:48`, `designs/library-grid.tsx:30`,
  `design/design-stage.tsx:74, 92`, `design/image-gallery.tsx:60`,
  `d/[imageId]/conversation-images.tsx:84`, `d/[imageId]/buy-panel.tsx:319, 383`,
  `preview/page.tsx:842, 1044, 1064`, `cart/page.tsx:133`,
  `shop/[slug]/[productId]/page.tsx:39`, `admin/published/page.tsx:63`,
  `components/publish-modal.tsx:67`.
- OG/share: `src/lib/og-site-card.tsx:46-52` (`#0a0a0a` ground, white
  wordmark, `#999`/`#666` text) feeds `src/app/opengraph-image.tsx`,
  `src/app/twitter-image.tsx`, and the per-image fallback in
  `src/app/d/[imageId]/opengraph-image.tsx` / `twitter-image.tsx`;
  `designCardPalette` (`og-site-card.tsx:21-34`) is fine.
- Email: `src/lib/email.ts:17-20` uses zinc constants (`#18181b`, `#fafafa`)
  and an ink header bar (`:73-75`) with a filled CTA (`:62`) — already light,
  but a different warm than Paper; align tokens.
- Favicon/OG assets: there is **no** `src/app/icon.*` or `favicon.ico`
  (`public/` holds only the Next starter SVGs), and `layout.tsx:21-23` still
  titles the site "AI-Powered Custom Design" and mentions phone cases (the
  case was discontinued 2026-05-26).

## The four screens to mock next

1. **Studio bench with lanes** (`/studio`, #187). Questions a mock must
   answer: composer position (top, under the wordmark, or a sticky top bar);
   what a lane row is on paper (ruled row with a mono index, or a card);
   the ordering rule (activity-desc reads as random — creation-desc, or
   pinned-then-activity); where Close/Delete live (row hover, overflow, or
   swipe); how a pending cell looks and where it appears the instant Generate
   is pressed; empty state for a buy-only account.
2. **Focused stage** (tapped image with the composer under it). Whether this
   is a state of `/studio` or replaces `/design?id=`; how the image sits on
   paper (bordered card, backdrop colour, or bare); where sibling generations
   go (strip below vs the lane above); whether chat history is shown at all
   and, if so, as a disclosure; what the anchor chip becomes when the composer
   is adjacent to the image (it may not be needed).
3. **Image detail / buy page** (`/d/[imageId]`). Whether it is one page for
   owner and buyer or two states; the collapsed vs expanded Order question
   (#128) on paper; how price, garment and designer are labelled (mono
   block); where the owner's seven actions go; how the storefront backdrop
   reads inside a bordered card on warm paper; sticky bar vs inline CTA.
4. **Shop feed** (`/prints`). Card anatomy (art on backdrop, title, price,
   garment, maker — which of these); grid density at 390 (2-col vs 1-col
   editorial); whether the feed is compositions (shirt on colour) or artwork
   on backdrop, which is the composition-model question surfacing in UI; the
   name of the page.

## Rollout plan

Each slice is one PR. Migration-free unless noted.

1. **Tokens + primitives.** `globals.css` to Paper tokens (light only, remove
   nothing yet), Button/Input/Card/Badge/Modal/Breadcrumbs re-skinned, the
   `text-white`/`bg-gray-900`/`bg-black` sweep, `isDarkShirt`/`mockupBackdrop`
   re-decided, checkerboard decision (Q2). Risk: every page looks half-done
   for a day and the mockup blend (`mix-blend-multiply` over a light
   backdrop) needs eyeballing on `/preview` and `/d`. Large diff, low logic.
2. **Nav model.** Header per model A, account menu, Studio sub-nav
   (bench/library/archive), `/designs` → redirect, empty-state CTAs and
   `sign-in` default → `/studio`, Feedback off `/d`. Risk: e2e specs assert on
   nav text and `/designs` redirects (`e2e/helpers/auth.ts:30-33` waits for
   `/designs` after sign-up).
3. **Studio bench** (mock 1 + #187's optimistic pending cell and ordering
   rule). Risk: the polling/anchor state (`studio-client.tsx:77-150`, `:161-185`) is the
   part reviews flagged as fragile.
4. **Focused stage** (mock 2). Risk: decides the fate of `design-client.tsx`
   (825 lines) and the thread route; keep `/design?id=` as a redirect.
5. **Image detail page** (mock 3). Risk: buy flow; needs the Stripe e2e run.
6. **Shop feed** (mock 4). Risk: route rename collides with `/shop/[slug]`;
   price-on-card depends on the composition model's fixed-vs-open blank.
7. **Mechanical sweep** of orders, cart, confirm, dashboard, admin, auth,
   storefront, empty states. Risk: none beyond volume.
8. **Emails, OG cards, favicon, metadata.** Risk: OG raster cannot be
   unit-tested (satori/resvg under vitest), verify against a real server as
   #175 did.

## Open questions for Nico

1. Nav model A (Studio · Shop · account menu) — yes, good.
2. Checkerboard on paper: drop it everywhere for a plain paper ground with a 1px
   border (white-ink art then needs a forced backdrop pick at publish, which
   #140 already does)?
3. Does the community feed get renamed, and to what — `/shop` (collides with
   organizer slugs unless reserved), `/prints` stays, or something else? (see 5)
   **DECIDED 2026-09-05: feed moves to `/shop`, `/prints` redirects — in the nav slice.**
4. Focused stage: a state of `/studio`,
5. Do organizer storefronts (`/shop/[slug]`) get the Paper chrome now, or
   stay untouched until #45 gives them their own chrome? let's discuss getting rid of shops. not sure I'm going to do that actually, no traction.
   **DECIDED 2026-09-05: organizer storefronts are retired. Step 1 now: `STORES_ENABLED` off in Production + Preview and the three entry points (Dashboard nav item, footer "Open a shop", landing link) removed. Step 2 with composition slice 5: drop `store`, `product_offering`, `order.storeId`, `product.storeId`, the dashboard + storefront routes, `store-service.ts`, the store-compose e2e spec — which also removes slice 5's `product.designId` blocker. Verify on prod first that no order carries a store id.**

6. Emails: match Paper's warm ground
7. Favicon and OG: the OG card keeps artwork (per-image cards already do)?

Also decided 2026-09-05 (from the smoke round, tracked on #187): a cancelled
generation discards its result instead of landing it; still billed, quota
rule unchanged.
