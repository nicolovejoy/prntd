# #288 owner notice for an admin-hidden image, and #289 item 4 (one reader for "published")

Date: 2026-10-08. Branch `claude/288-hidden-owner`. No migration.

## Context

An admin hides a published image from `/admin/published`. Today `getImagePage` (`src/app/d/actions.ts` ~line 228) reads hidden from the mirror `product` row (`mirrorIsHidden(r.status)`, `src/lib/composition-reads.ts:40`) and `canViewImagePage` (`src/lib/design-publish.ts:232`) returns false for everyone including the owner, so the owner gets the not-found page and is not told. My Designs (`src/app/designs/`) and the zip export (`src/lib/design-export.ts`, served by `src/app/designs/export/route.ts`) do not read the hidden flag at all. The buy gate (`src/lib/buyable-image.ts`) reads `image_publication.is_hidden`. So "hidden" has two readers (#289 item 4).

Rulings from Nico on #288 (2026-10-05):

1. The owner gets a plain notice that an admin has hidden the image, no reason, with the contact address help@prntd.org.
2. A hidden image is left out of the zip export from My Designs.
3. Paid orders are unchanged. Cart lines pinning a hidden image already read "No longer available" since #290; nothing more.
4. The R2 object URL stays public (watch item; not changed here).

Rulings (Claude, 2026-10-08) on what the issue left open:

- **One reader.** `image_publication` (`published_at`, `is_hidden`) is the authority for visibility (CLAUDE.md data model: it "holds image visibility only"). Every reader that decides whether an image is published or hidden reads it: `getImagePage`, the image detail page's other readers in `src/app/d/actions.ts`, `src/lib/image-share.ts`, `src/app/admin/actions.ts`. The `product.status` mirror keeps being written exactly as today (writers unchanged); it is no longer read for visibility. If `mirrorIsHidden` / `mirrorPublishedAt` end up with no caller, delete them and their tests; if a caller remains for a non-visibility reason, leave it and say why in the PR body.
- **My Designs shows a placeholder, not nothing.** The owner must be able to find the notice, so the tile stays in the grid with no artwork: a Paper-look tile (ink 1px border, no shadow) with the mono uppercase label `HIDDEN`, linking to the image detail page. It is excluded from any bulk action on the page (select, delete, publish) — check what bulk actions exist in `library-grid.tsx` and skip hidden tiles in each.
- **The image detail page for the owner** renders the notice in place of the artwork: no image, no lightbox, no Order / Add to cart / Publish / Unpublish, no "start a new design from it". Non-owners keep the not-found page. Copy (persona C, plain): heading `Hidden`; body `An admin has hidden this image. It is not shown in the Shop or on your pages, and it can't be ordered or published.`; a line `Questions: help@prntd.org` with the address as a `mailto:` link. Nico confirms the copy at the smoke.
- **Studio lanes and the `/design?id=` thread** are out of this slice's fence. The implementer lists in the PR body what each renders for a hidden image today (artwork, hero, anything), with file:line, so a follow-up can be sized. Do not change them.
- **The zip export** skips images whose `image_publication` row has `is_hidden = true`, and the count the page shows (if any) matches.

## Global constraints

- Real-DB integration tests (`createTestDb`, factories) for the readers and the export. There is an existing `src/app/designs/__tests__/admin-hidden-owner.integration.test.ts` — read it first and extend it rather than duplicating its seed.
- `"use server"` files: async exports only; pure helpers go in `src/lib/`. `server-action-exports.test.ts` pins exports of four action files — read it before adding an export to any action file.
- Copy and look follow CLAUDE.md "Conventions" (persona C; Paper; mono uppercase labels; AA contrast; rose only on the wordmark and Generate).
- `no-preselection-price.test.ts` and the `/preview` literal guard must keep passing.
- Fence: `src/app/d/**`, `src/app/designs/**`, `src/lib/design-publish.ts`, `src/lib/design-export.ts`, `src/lib/image-share.ts`, `src/lib/composition-reads.ts`, `src/app/admin/actions.ts` (reader only), tests. Do not touch `src/app/cart/**`, `src/lib/order-checkout.ts`, `src/lib/buyable-image.ts`'s decision (you may call it), or the schema.
- Gate before reporting: `npm run lint && npm run typecheck && npm test`.

## Tasks

### Task 1 — one reader for visibility (#289 item 4)

Move every visibility read to `image_publication`. `getImagePage` and friends select `published_at` / `is_hidden` from the publication row (left join; absent row = unpublished, not hidden). Tests: an image with a publication row `is_hidden = true` and a stale mirror `product.status` that disagrees → the page reads hidden from the publication row. An image with a publication row and no mirror product → published.

### Task 2 — the owner's notice on the image detail page

`getImagePage` returns a distinguishable result for "owner of a hidden image" (e.g. a `hiddenForOwner: true` variant with only what the notice needs: image id, title if any) instead of `null`. The route renders the notice described above for that variant and keeps 404 for everyone else. Tests: owner → notice (no img, no buy panel, no publish controls, mailto present); non-owner and signed-out → not found; owner of a visible image unchanged.

### Task 3 — My Designs placeholder tile and the zip export

`getMyDesigns` (or whatever `src/app/designs/actions.ts` exposes for the grid) carries `isHidden` per image from the publication row; `library-grid.tsx` renders the `HIDDEN` tile and skips hidden tiles in bulk actions. `src/lib/design-export.ts` excludes hidden images. Tests: the grid data marks the hidden image; the export's file list omits it; a visible image is unaffected.

### Task 4 — PR

Open the PR on `claude/288-hidden-owner` with `gh pr create`. Body: the rulings above, the Studio/thread survey with file:line, what `mirrorIsHidden`/`mirrorPublishedAt` became, and `Closes #288`. Mention "#289 item 4" so that issue can be updated. End the body with the attribution line from the session reminder.
