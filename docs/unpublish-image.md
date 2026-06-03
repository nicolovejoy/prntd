# Un-publish an image (reversible)

Status: in progress — 2026-06-03

## Goal

Let an image owner take a published image back down from the storefront, reversibly. Reverses the previous "publish is a one-way lock" decision (`design-publish.ts` header comment + `publishImage` doc).

## Behavior

- **Un-publish** (`unpublishImage(imageId)`): owner-only, sets `published_at = null`. Image drops out of the discover feed (`/`, `/prints`), `canBuyPublishedImage` returns false, `/d/[imageId]` 404s. `title` / `description` / `background_color` are left intact so re-publish reuses them.
- **Re-publish**: the existing `publishImage` runs again (its `if (image.publishedAt) return` no-op no longer trips because `published_at` is null). Naming fields are already set, so no fresh Claude call. The image reappears with a **fresh `published_at`** — it sorts as newly published (top of feed), it does not keep its original date. (Confirmed acceptable.)

## The deletion-lock re-keying (safety-critical)

`published_at` currently does double duty: public marker **and** deletion lock (`assertNotLocked` refuses to delete any image with `published_at` set). Un-publish clears `published_at`, which would silently remove that lock and let an **ordered** image be deleted out from under its order (`order.placements.front = imageId` for buy-existing orders).

Fix: move the deletion guard off "is published" and onto "is referenced by an order".

- New `isImageOrdered(imageId)`: true iff `imageId` appears as a value in any `order.placements` JSON. Scoped by `order.designId = image.designId` for a cheap lookup, then JS-checks `Object.values(placements)`.
- `deleteDesignImage` calls `isImageOrdered` instead of `assertNotLocked`.
- Result: ordered images are never deletable (regardless of publish state); un-ordered images are deletable whether published or not. The user accepted this (option B for un-ordered images "for free").

Normal /order flow points `placements` at derived placement-render rows, not the published source image, so it does not lock the source — only direct references (buys) do.

## UI (both surfaces)

- `/d/[imageId]` `PublishedImageView`: "Un-publish" button by the backdrop-swatch owner row; optimistic; routes owner to `/designs` afterward (page is no longer public).
- `/designs` cards: existing Publish affordance becomes a publish/un-publish toggle keyed on the card's `publishedAt`.

## Revalidation

`unpublishImage` revalidates `/`, `/prints`, `/d/[imageId]`.

## Tests

Pure helpers in `design-publish.test.ts` style:
- `isImageOrdered` true (id in placements) / false (absent).
- `canBuyPublishedImage` false once `published_at` is null.

## Out of scope (YAGNI)

- No dedicated "delete image" button. Re-keying the guard is enough; deletion stays in the gallery.
- `is_hidden` (admin moderation) is untouched and independent.
