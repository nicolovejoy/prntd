# #139 slice 1: per-image luminance, picker sort, dark well

Date: 2026-10-09. Issue: #139. Follows the spike of 2026-10-08
(`scripts/suitability-sheet.ts` on `claude/139-suitability-spike`, ledger
`docs/superpowers/ledgers/2026-10-08-139-suitability-spike.md`), whose
contrast ranking matched Nico's eye on both contact sheets.

## Rulings this spec implements

- Nico, 2026-10-08: nullable per-image light/dark column plus backfill (HOLD,
  migration 0015); the pickers sort light-to-dark with a direction toggle, not
  a filter; the same signal picks a dark well under unpublished artwork in My
  Designs, the Studio and `/admin/usage`; the Shop keeps its pinned backdrops;
  no interim well change before this lands.
- Nico, 2026-10-09 (this session): (1) the column stores one number, the mean
  WCAG relative luminance of the opaque pixels; (2) the back-source picker's
  default order follows the chosen shirt colour, with a Light first / Dark
  first control to flip it; (3) the dark well is ink `#141311`, chosen by a
  contrast threshold against the paper well, on all four unpublished-artwork
  surfaces.

## 1. The signal

`image.luminance`: nullable REAL, 0 (black) to 1 (white). The mean, over the
image's opaque pixels, of WCAG relative luminance (sRGB linearised, Rec. 709
weights; the same function as `relativeLuminance` in `src/lib/blanks.ts`).
Opaque means alpha > 128. Pixels are read after downscaling to fit 256×256,
which is enough for a mean. `NULL` means not computed: rows older than the
backfill, a decode failure, or an image with no opaque pixel.

Why luminance and not the spike's two contrast means: one axis gives the
light-to-dark sort directly, a threshold on it picks the well, and the
contrast against any of the 83 shirt colours can be derived at read time
(`(hi + 0.05) / (lo + 0.05)` against the colour's luminance) without another
migration. The spike ranked by mean contrast ratio, which is not the same
number (a mean of ratios is not a ratio of means), but it orders the same
way for the purpose of a light-to-dark sort.

Computation lives in `src/lib/image-luminance.ts`:

```ts
export async function meanLuminance(png: Buffer): Promise<number | null>;
```

It uses `sharp` (already in `node_modules` as Next's optional dependency;
this slice adds it to `package.json` as a direct dependency at the installed
version, 0.35.x, so the import is declared, not borrowed). A LUT over the 256
sRGB byte values keeps the loop cheap. Any throw inside returns `null`; the
caller logs with `console.warn("[luminance] …", { imageId })` and continues.

## 2. Where it is computed

`insertDesignImage` (`src/lib/design-images.ts`) takes a new optional
`luminance: number | null` and writes it on the `image` row (placement
renders, which go to `placement_render`, ignore it). Both callers that hold
the PNG bytes compute it right before the insert:

- the generation continuation in `src/app/design/actions.ts` (the `buffer`
  fetched from Ideogram, before `uploadImageObject`), which covers generate
  and edit, since both land through the same continuation;
- the upload action in the same file (`base64Data` decoded to `buffer`).

The computation never fails a job: a `null` result is written as `NULL`. It
runs before the R2 upload so the extra decode does not extend the window
between upload and row write (the continuation's deadline logic stays as
it is).

## 3. Backfill

`scripts/backfill-image-luminance.ts` (ops script, outside lint and tsconfig
like every script; the per-image logic is `meanLuminance`, so the script is a
loop): selects `image` rows where `luminance IS NULL`, oldest first, fetches
each PNG from `${NEXT_PUBLIC_R2_PUBLIC_URL}/images/{id}.png` (falls back to
the row's `image_url` for legacy `designs/{designId}/{n}.png` keys), computes
`meanLuminance`, and writes it with `UPDATE image SET luminance = ? WHERE id
= ? AND luminance IS NULL`. Flags: `--limit N` (default all), `--dry-run`
(prints what it would write). A 404 or a `null` result leaves the row `NULL`
and is counted in the summary line (`updated / skipped / failed`). Idempotent;
safe to re-run. Env from `.env.local` by default, or `DATABASE_URL` and
`DATABASE_AUTH_TOKEN` inline for preview and prod, like `db:migrate`.

Order of operations for prod, in the runbook (section 8): migrate, then
backfill, then merge. Old code ignores the column, so the backfill can run
before the deploy and the picker sorts from its first request.

## 4. The well

New token in `src/app/globals.css`: `--surface-well-dark: #141311` with
`--color-surface-well-dark` in the theme block, so `bg-surface-well-dark` is a
utility like `bg-surface-well`.

`src/lib/artwork-well.ts`:

```ts
export const PAPER_WELL_HEX = "#e6e3dd";          // --surface-well
export function contrastRatio(l1: number, l2: number): number;
export type ArtworkWell = "paper" | "dark";
export function wellForLuminance(lum: number | null): ArtworkWell;
```

`wellForLuminance` returns `"dark"` when `contrastRatio(lum,
relativeLuminance(PAPER_WELL_HEX)) < 3` (WCAG's floor for large graphics;
on paper that is roughly "lighter than mid-grey"), `"paper"` otherwise, and
`"paper"` for `null`. One consumer-facing helper, `wellClass(lum)`, maps that
to `bg-surface-well` / `bg-surface-well-dark`.

Surfaces that paint unpublished artwork on the well switch to `wellClass`:

- My Designs tiles (`src/app/designs/library-grid.tsx`; `LibraryImage` gains
  `luminance`, read by `getUserImageLibrary`).
- The focused stage (`src/app/studio/focused-stage.tsx`): the large image and
  each results-strip cell. Its "the #139 slice decides its tone later"
  comment is replaced by the rule.
- The Studio lane cells and thumbnails (`src/app/studio/studio-client.tsx`),
  wherever `bg-surface-well` sits under artwork (not the menu hover states).
- `/admin/usage/[userId]` (`src/app/admin/usage/[userId]/page.tsx`).

Every loader behind those surfaces selects `image.luminance`. Published
artwork keeps its pinned backdrop on every surface; the Shop, the image
detail page and `/admin/published` do not change.

## 5. The picker

`BackSourceImage` (`src/lib/back-sources.ts`) gains `luminance: number |
null`, selected by `getBackSourceGroups`. Sorting is in `src/lib/
back-source-sort.ts`, pure and unit-tested:

```ts
export type SortDirection = "light-first" | "dark-first";
export function defaultSortForShirt(colorHex: string): SortDirection;
export function sortBySuitability<T extends { luminance: number | null }>(
  images: T[], direction: SortDirection): T[];
```

`defaultSortForShirt` returns `"dark-first"` when the shirt colour's relative
luminance is at or above 0.18 (a light shirt; 0.18 is the linear value of
perceptual mid-grey, L* 50) and `"light-first"` below it. `sortBySuitability` is stable:
images with `null` luminance keep their incoming order and go last in either
direction; ties keep incoming order (newest first, as the groups arrive).

In `buy-panel.tsx` the picker sorts each group's images with the current
direction. The direction starts as `defaultSortForShirt(selectedColor.value)`
and follows the colour while the buyer has not touched the control; one tap
on the control pins it for the rest of the panel's life. The control sits at
the top of the picker, above the first group: a mono uppercase row with two
options, "Light first" and "Dark first", the active one in ink and the other
muted, each a 44px-tall button (the picker's own colour swatches are 40px,
a known exception; new controls meet the rule). No price, no count, no
other copy. Nothing is persisted.

## 6. Migration

`drizzle/0015_<name>.sql`, generated from `schema.ts`:

```sql
ALTER TABLE `image` ADD `luminance` real;
```

Additive, so it applies to prod before the PR merges (standing rule). The PR
title carries HOLD until Nico has run the runbook.

## 7. Tests

- `src/lib/__tests__/image-luminance.test.ts`: synthetic PNGs built with
  sharp — all white opaque → ≈1; all black opaque → ≈0; white over a fully
  transparent background → ≈1 (transparent pixels ignored); fully transparent
  → `null`; not a PNG → `null`.
- `src/lib/__tests__/artwork-well.test.ts`: `contrastRatio` symmetric and
  21 for black on white; `wellForLuminance` is `"dark"` at 1 and at the
  threshold's light side, `"paper"` at 0, at mid-grey and for `null`.
- `src/lib/__tests__/back-source-sort.test.ts`: default direction for white,
  black and a mid colour at the boundary; both directions order correctly;
  nulls last and stable; ties stable.
- `src/lib/__tests__/design-images.integration.test.ts` (existing file, or
  a new case): `insertDesignImage` stores `luminance` and stores `NULL` when
  omitted.
- `src/lib/__tests__/back-sources.integration.test.ts` and
  `user-designs.integration.test.ts`: the returned rows carry `luminance`.
- `src/app/d/__tests__/buy-panel…` (existing component tests): the control
  renders with the colour-derived default, flips on tap, and a later colour
  change no longer moves it; group order follows the direction.
- `src/app/designs/__tests__/library-grid.test.tsx`,
  `src/app/studio/__tests__/focused-stage.test.tsx`: a light image gets
  `bg-surface-well-dark`, a dark or unscored one `bg-surface-well`.
- `src/app/__tests__/globals-css.test.ts` keeps passing (the new token is
  declared in the same places as `--surface-well`).
- `npm run db:generate` prints "No schema changes" after the migration is
  committed (CI's drift gate).

The backfill script has no test; it is a loop over `meanLuminance`. A dry
run on prntd-dev before the prod run is its check.

## 8. Runbook (HOLD PR)

1. Claude: branch, implement, gate (lint, typecheck, test, build), Opus
   whole-branch review, PR titled `HOLD: …`.
2. Claude: `npm run db:migrate` against prntd-dev, then
   `npx tsx scripts/backfill-image-luminance.ts` there; a read-back prints
   the count of scored and unscored rows.
3. Nico, from a checkout synced to the PR branch (the migration file is only
   there): backup `turso db create prntd-backup-20261009 --from-db prntd`;
   rehearsal on `turso db create prntd-0015-rehearsal --from-db prntd`
   (migrate, exit code 0, read-back); prod migrate with inline creds; the
   read-back script (`scripts/check-luminance-column.ts`: column present,
   row counts) prints clean; prod backfill with inline creds (reads R2 over
   the public URL; writes only `image.luminance`); preview migrate and
   backfill the same way.
4. Nico merges; deploy; prod smoke.

Smokes (one per message, after merge; nothing displays the number itself):
(a) My Designs paints a known light design on a dark tile and a known dark
one on paper; (b) the back-source picker on a white shirt lists a known dark
design before a known light one, and the control flips it; (c) a fresh
generation of a mostly-white design lands on a dark tile in the Studio
without a backfill.

## 9. Out of scope

- A filter, or a Shop feed sort (the issue's "maybe"; no ruling).
- Sorting by contrast against the exact chosen colour rather than two
  directions (derivable later from the same column).
- Any change to published artwork's backdrop, the OG card, or mockups.
- The `/design?id=` thread's cells (slice 2 of the focused stage decides
  that page's fate); they keep the paper well.
- Deleting the spike branch and worktree: the script stays unmerged; the
  worktree is removed in this slice's cleanup once the PR is open.
