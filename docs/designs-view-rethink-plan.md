# My Designs / thread-open rethink (#136)

Design pass for issue #136: "a conversation is not a design". Written 2026-07-30, before code.

## What was reported

Opening a design from My Designs on a phone: chat renders first, then an empty
"Generations — no images yet", then images pop in. The thread holds five
near-identical variants presented as equal peers, one on a different backdrop.
The landing object is the chat, but the user came looking for the picture.

## Current state

- `/designs` lists one card per **conversation** (`design` row), showing
  `primaryImage`. Every tap target on the card — the image, "Edit" — goes to
  `/design?id=…`, the chat thread.
- `/design` renders chat on the left and a "Generations" gallery on the right
  (`image-gallery.tsx`), flat, newest-appended, all variants equal weight.
- `/d/[imageId]` is the image-first view we already want: hero, collapsed
  Order CTA that expands the picker in place, "New design from this image",
  publish/un-publish for the owner. It is currently reachable only for
  **published** images — `canViewPublishedImage` requires `publishedAt`.

Strand 1 of the issue (the flash) is already fixed: PR #141 made `/design` a
server shell that hands the client a thread promise, and the client `use()`s it
so the first paint has chat + images together. No "no images yet" for a
non-empty thread. Confirm on prod, then this doc is about strands 2 and 3.

## Direction

Model B already says image is the artifact and conversation is the workshop.
The UI should match:

- **My Designs lands on the image, not the chat.** Card tap → an image view.
- **Chat is one tap deeper**, from the image view ("View conversation").
- **The image view is `/d/[imageId]`**, extended to owner-private images
  instead of a second parallel page. Guard becomes
  `published && !hidden` **OR** viewer owns the image. Everything the buy page
  already does — order with the size/color picker, start-from-image, publish —
  then works for unpublished designs too, which also converges the two order
  pipelines (`/preview` for own designs vs `/d` for published ones).
- **Variants are history, not peers.** The thread's gallery leads with the
  current/primary image; older generations sit in a secondary strip. The image
  view gets an "other images from this design" row so a non-primary variant is
  still one tap away.

## Decisions (Nico, 2026-07-30)

All five settled as recommended:

1. **Route.** Extend `/d/[imageId]` to owner-private images rather than adding
   `/i/[imageId]`. One view, one order path. Because "published" is no longer
   implied by the URL, publish state must be visible on the page.
2. **What My Designs lists.** One card per conversation, showing the primary
   image. Per-image cards would turn five near-duplicate generations into five
   cards — the same noise moved up a level.
3. **"Edit" button.** Dropped from the card. Chat is reached via
   "View conversation" on the image view.
4. **Ordered designs.** "Reorder" keeps pointing at `/preview` for now;
   converging it onto `/d` is a follow-up so this diff stays reviewable.
5. **Primary image selection.** Add an explicit "Use this one" action
   (sets `design.primary_image_id`). Without it strand 2 has no user-facing
   fix, only a reordering of the same list.

## Slices

1. **Guard + route.** `/d/[imageId]` serves owner-private images; page shows
   publish state; add "View conversation" for the owner. No changes to
   `/designs` yet.
2. **My Designs relanding.** Card tap → `/d/[imageId]?from=/designs`; card
   actions trimmed per Q3.
3. **Variant hierarchy.** Thread gallery leads with primary + history strip;
   "other images from this design" row on the image view; explicit
   "Use this one" (Q5).

Each slice is its own PR. Slice 1 carries the security-sensitive change (a
private image becoming addressable by id), so it needs ownership tests in the
same shape as `canUseAsPlacementSource` got in PR #95.

## Slice 2 status (2026-07-30)

Shipped: card tap → `designCardHref` (`src/lib/design-view.ts`) — `/d/{primaryImageId}?from=/designs`,
falling back to `/design?id=` for a thread with no image yet, since there is no
image page to land on. "Edit" dropped from the card (the image page's
"View conversation" replaces it); the published card's "Published →" link
dropped too, now that the card itself goes there. Un-publish, Publish, Delete,
Close/Reopen, New-from-image and Reorder are unchanged; Reorder still points at
`/preview` per decision 4.

## Slice 3 status (2026-07-30)

Shipped, image-view half:

- `setPrimaryImage(designId, imageId)` (`src/app/design/actions.ts`) — Q5's
  explicit action. Owner-gated, and the image must have a `conversation_image`
  link to that design, otherwise an owner could point their design at any
  image id they can name. Deliberately allowed on a **closed** conversation:
  choosing which image represents the record isn't a thread write, so
  `assertConversationOpen` doesn't apply.
- `getConversationImages(designId)` (`src/app/d/actions.ts`) — owner-only,
  seeds included (a fresh-start thread's anchor is legitimate history and a
  legitimate primary). Renders as `ConversationImages`: "Use this one" when
  the viewed image isn't primary, plus an "Other images from this design"
  strip linking to each sibling's `/d` page, `?from` preserved.
- 8 real-DB tests (`set-primary-image.integration.test.ts`) covering the
  ownership, cross-conversation, signed-out and closed-thread cases.

**Deferred: the thread-gallery half** (primary leads, older generations in a
secondary strip). #147 says the thread view needs a layout conversation before
more is built on it, and reshuffling the gallery now would be work thrown away
by that redesign. The hierarchy is expressible either way — `design.primary_image_id`
is now user-settable, which is what the gallery would key off.
