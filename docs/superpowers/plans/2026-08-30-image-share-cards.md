# Per-image link preview cards for `/d/[imageId]`

Spec: Nico, 2026-08-30 — a link to a specific design
(`https://prntd.org/d/3a6062d3-…`) currently previews as the site-wide
branded card ("PRNTD / Your idea, on a shirt."). It should preview as the
design itself.

No issue number yet; file one if this outlives the session.

## The problem, precisely

`src/app/d/[imageId]/page.tsx` exports no `generateMetadata`, and the
segment has no `opengraph-image` / `twitter-image` of its own. Metadata
file conventions cascade from parent segments, so every design link
inherits the root `src/app/opengraph-image.tsx` and
`src/app/twitter-image.tsx` — one static card for the whole site.

## Global constraints

1. **The share card is published-only.** `publishedAt !== null && !isHidden`.
   An owner-private image falls back to the site card for everyone,
   including its owner. This is deliberately stricter than
   `canViewImagePage`, which does let an owner see their own unpublished
   work — see decision 1.
2. **No `headers()`, no session read, anywhere in the image routes.**
   That is what keeps them cacheable, and it is what makes a cache hit
   safe to serve to any viewer.
3. **No new DB columns, no migration.** Everything needed
   (`image.imageUrl`, `listing.title`, `listing.backgroundColor`,
   `listing.publishedAt`, `listing.isHidden`, `user.name`) already exists.
4. The DB reader lives in `src/lib/`, not in `d/actions.ts` — that file is
   `"use server"`, so anything exported from it becomes a server action,
   and a route handler should not import one.
5. Every new module gets tests in the existing style; the real-DB
   integration harness is `src/lib/__tests__/test-db.ts`.
6. `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` all
   pass before a task is DONE. Typecheck is not optional — an agent PR has
   shipped a type error past lint/test/build before.

## Design decisions this plan makes (and why)

**1. Published-only, and no session read.** `opengraph-image.tsx` is a
specialized Route Handler that Next caches unless it touches a
request-time API. Reading the session to honour `canViewImagePage`'s
owner shortcut would both make the route dynamic and open the door to a
cached response — keyed on the URL, not the viewer — serving one person's
private artwork to whoever asks next. A crawler has no session anyway, so
the owner shortcut buys nothing here and costs a leak class. Private
images therefore fall back to the site card.

**2. Composite the artwork onto its backdrop, don't serve the bare PNG.**
Designs are transparent PNGs. Pointing `og:image` straight at the R2
object would hand chat clients an image with no background — and the
screenshot that prompted this shows those clients compositing onto a dark
card, where a dark design disappears. `publishedBackdrop(backgroundColor)`
already resolves the pinned colour (legacy nulls display White, per #76),
which is the same colour the detail page shows it on. The card should
match the page.

**3. The image carries artwork only; the title goes in `og:title`.** Chat
clients render title and domain as a caption band under the image, so
baking the title into the picture shows it twice. A small muted PRNTD
wordmark is the only text in the card.

**4. Both `opengraph-image.tsx` and `twitter-image.tsx`.** Adding only the
former leaves the root `twitter-image.tsx` cascading into this segment, so
X/Twitter would keep showing the branded card while everything else showed
the design. The twitter route re-exports the OG one — same card, two
conventions.

**5. `generateMetadata` on the page, same published-only rule.** Gives
`og:title` = the listing title, `og:description` = the designer
attribution. An unpublished image has no listing and therefore no title,
so it falls through to the site defaults with nothing to leak.

**6. One shared reader.** `getImageShareCard(imageId)` in
`src/lib/image-share.ts`, used by `generateMetadata` and by the image
route. That is one extra indexed lookup per detail-page render; the page's
own `getImagePage` stays untouched rather than being refactored into a
shared cache, which would be more surgery than this feature earns.

## Tasks

### Task 1 — `src/lib/image-share.ts`

- Pure `canShareImageCard({ publishedAt, isHidden })` — the rule from
  constraint 1, stated once and tested directly.
- `getImageShareCard(imageId)`: one query joining `image` → `user` →
  `listing`, returning `{ imageUrl, title, designerName, backgroundColor }`
  or `null` when the image is missing or not shareable.
- Tests: unit for the pure gate (published, unpublished, hidden,
  hidden-and-published); real-DB integration for the reader (published
  image returns its row; unpublished returns null; hidden returns null;
  unknown id returns null).

### Task 2 — the card routes

- `src/app/d/[imageId]/opengraph-image.tsx`: 1200×630 `ImageResponse`,
  backdrop fill from `publishedBackdrop`, artwork centred and contained,
  muted PRNTD wordmark. Falls back to the site-card design when
  `getImageShareCard` returns null, so a crawler on a private link gets a
  valid image rather than a 404 in the preview slot.
- `src/app/d/[imageId]/twitter-image.tsx`: re-export.

### Task 3 — `generateMetadata` in `page.tsx`

- Published: `title` = listing title, `description` = "Designed by X".
- Not published / not found: return `{}` and inherit the site defaults.

### Task 4 — verification

Full gate, plus a rendered-card eyeball: fetch the OG route for a known
published image locally and confirm the PNG shows the artwork on its
backdrop.

## Deliberately not in scope

- Backfilling or changing any listing's `backgroundColor`.
- The shirt mockup as the share image. The artwork on its backdrop is what
  the detail page leads with; the mockup is behind the Order expand
  (#135 slice 1) and is generated on demand.
- Share cards for `/design`, `/preview`, or organizer storefront routes.
