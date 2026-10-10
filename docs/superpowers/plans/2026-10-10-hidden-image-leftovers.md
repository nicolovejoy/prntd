# Hidden-image leftovers (#300 follow-up)

Date: 2026-10-10. Branch: `claude/hidden-image-leftovers`. No migration.

## Goal

After #300 and #306, two owner-facing surfaces still show an admin-hidden image
to its owner: the Studio lanes and the `/design?id=` thread. And
`isImageAdminHidden` still reads two tables. This slice closes both.

## Rulings this plan argues from (there is no separate spec)

- Nico, 2026-10-05: once an admin hides an image nobody can buy, print or mock
  it up, the owner included, and the owner cannot undo the hide.
- The owner notice on the image detail page (shipped, #300) says: "An admin has
  hidden this image. It is not shown in the Shop or on your pages, and it can't
  be ordered or published." "Not shown on your pages" is the requirement here.
- Nico, 2026-10-08: no placeholder the owner can't identify. A hidden image is
  left out, not replaced by a tile. The notice stays reachable from an old link
  to the image detail page. My Designs already does this (`src/lib/user-designs.ts`,
  the `or(isNull(is_hidden), eq(is_hidden, false))` filter).
- #300: `image_publication` is the one visibility reader. `product.status` is
  still written by `setImageHidden`; it is no longer read for visibility.

## Global constraints

- No schema change, no migration, no new environment variable.
- No new user-facing string. If a task seems to need one, stop and report.
- Keep writing `product.status` wherever it is written today.
- A hidden image is `image_publication.is_hidden = true`. No publication row
  (a LEFT JOIN yielding NULL) means not hidden.
- Tests that touch the database are real-DB integration tests on the in-memory
  libSQL (`src/lib/__tests__/test-db.ts`, factories in
  `src/lib/__tests__/factories.ts`). No mocks of the query layer.
- `@typescript-eslint/no-explicit-any` is an error in product code.
- Comments say what the code does and why, plainly. Any comment or docblock
  that this change makes false must be corrected in the same commit, including
  ones a few lines away from the edit.
- Gate before reporting: `npm run lint`, `npm run typecheck`, `npm test`.
  All three, from the worktree root.
- One commit per task.

## Task 1: `getDesignSourceImages` never returns a hidden image

File: `src/lib/design-images.ts` (`getDesignSourceImages`, around line 618).

Today the function takes `excludeHidden` and only the back-source group passes
it; its docblock says "the conversation views keep them". Change the rule:
the function always leaves hidden images out. Remove the `excludeHidden`
option and update every caller and the docblock.

Callers to update (verify the list with a search; report any not listed):
`src/lib/design-thread.ts`, `src/app/design/actions.ts` (`getDesignGallery`),
`src/lib/design-images.ts` (`getDesignImagesForAIContext`),
`src/lib/back-sources.ts`, `src/app/d/actions.ts`.

Consequence to keep true: the `/design` gallery and the AI context
(`getDesignImagesForAIContext`) number images by position in this one list, so
they keep agreeing with each other.

Tests (integration): a conversation with three outputs where the middle one is
hidden returns two, in creation order; `getDesignImagesForAIContext` numbers
them 1 and 2; with `includeSeeds`, a hidden seed is left out too; an image with
no publication row and a published, not hidden image are both returned.

## Task 2: the `/design?id=` thread payload carries no hidden artwork

Files: `src/lib/design-thread.ts` (`getDesignThreadData`),
`src/app/design/actions.ts` (`getDesignGallery`), and the readers they call in
`src/lib/design-images.ts` (`getDesignDisplayImageUrl`,
`getDesignPlacementRenders`).

Requirement: neither payload contains the URL of a hidden image, in any field.

- `sources`: covered by Task 1.
- `design.displayImageUrl`: when the image it would return is hidden, behave as
  the function already does when that image does not exist (read the function
  and follow its existing fallback order; do not invent a new one).
- `productGroups`: leave out a placement render whose `source_image_id` is a
  hidden image. A legacy render with no recorded source cannot be judged; keep
  it and say so in the report.
- `chat`: rows keep their `imageId` (an id, not artwork). Check that the
  `/design` client and the Studio's history list tolerate a chat row whose
  `imageId` is not in `sources` (a deleted image already produces that state).
  If either does not, report it; fix it only if the fix is a guard of a few
  lines.

Test (integration): seed a conversation whose primary image is hidden, with a
placement render sourced from it and a chat row naming it. Assert that
`JSON.stringify(await getDesignThreadData(designId, ownerId))` contains neither
the hidden image's URL nor that render's URL. A control conversation with the
same shape and nothing hidden contains both.

## Task 3: Studio lanes leave hidden images out

File: `src/lib/studio.ts` (`getStudioLanesData`, the image query around
line 204).

Leave hidden rows out of `cells`. The lane itself stays listed, even with no
cells left (the same state as a conversation with no result yet). No cell is
`isPrimary` when the primary image is hidden. Check `laneLastActiveAt` and the
lane title still behave with the hidden entry gone, and correct the comment on
`backdropColor` if it becomes inaccurate.

The focused stage (`/studio?conversation=&image=`) resolves `image=` against
the lanes, so a hidden id becomes an unresolved focus. There is an existing
test for an unknown image id in `src/app/studio/__tests__/studio-client.test.tsx`;
confirm it covers this and add nothing unless it does not.

Tests (integration, next to the existing lanes tests): a lane with one visible
and one hidden image has one cell; a lane whose only image is hidden is listed
with zero cells; the serialised lanes do not contain the hidden image's URL.

## Task 4: `isImageAdminHidden` reads one table

File: `src/lib/model-b-writes.ts` (around line 305).

Read `image_publication.is_hidden` only; drop the mirror-product read. Rewrite
the docblock to describe the single reader and keep the 2026-10-05 ruling it
records. Its callers are in `src/app/designs/actions.ts`; read each call site
and its comments and correct anything that describes the two-table read.

Tests: update any test that relies on the mirror-only state reading as hidden.
Add one that pins the single reader: publication row `is_hidden = false` with a
mirror product whose `status` is `hidden` reads as not hidden.

## Task 5: survey (report only, no code)

In the report file, list every other read that returns an image URL or id to
its owner without checking `is_hidden`. For each: the function and `file:line`,
whether it shows hidden artwork to the owner, and whether a UI path reaches it.
Check at least: cart lines, order history and order emails, the seed lookup in
`src/app/design/actions.ts` (around line 1462), `getDesignImageById`, and
whether `generateDesign` accepts a hidden image as the anchor of an edit when
called directly. Do not change any of them.
