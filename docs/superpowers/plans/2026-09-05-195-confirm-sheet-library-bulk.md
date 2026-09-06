# Plan: house confirm sheet + bulk select/delete on My Designs (#195)

**Issue:** #195 — "Bulk select/delete on My Designs + our own confirm dialog
(no window.confirm)". Nico on `window.confirm`: "looks shitty".
**Branch:** `feat/195-confirm-sheet-library-bulk`. Migration-free.

## Global constraints

- Phone-first: the sheet slides up from the bottom on phones (safe-area
  aware), centred dialog from `sm:` up. Tap targets ≥44px. Escape cancels and
  must `preventDefault` so Breadcrumbs' Escape-to-go-up does not fire (see
  `src/components/ui/modal.tsx` for the existing pattern — build on `Modal`).
- Copy is The Clean Label (`docs/design-system.md` Part 1): title = the
  question, one plain line of consequence, buttons "Delete" / "Cancel" (or the
  verb the caller passes). Existing strings `DELETE_CONVERSATION_CONFIRM`
  (`src/lib/design-view.ts`) and `bulkDeleteConfirm` (`src/lib/studio-view.ts`)
  are reused as the body text.
- Every `window.confirm` in `src/` goes: `studio/studio-client.tsx` ×2,
  `admin/page.tsx` ×3, `admin/orders/[id]/page.tsx` ×4,
  `d/[imageId]/published-image-view.tsx` ×1, `d/[imageId]/conversation-actions.tsx` ×1.
  After this branch `grep -rn "window.confirm" src` returns nothing.
  `window.alert` sites are out of scope (note them in the report).
- `studio-client.tsx` is also edited on a parallel branch (#187 optimistic
  pending cell, submit/poll region). Touch ONLY the two confirm lines and the
  host element there; expect to rebase.
- Image-level delete rules (never bypass): an image referenced by any order
  line (own design's lines, or pinned in another order's `placements`) is
  refused; a seed link is detached, not deleted; product/cart pins detach.
  `src/app/design/actions.ts` `deleteDesignImage` already encodes this for
  one image — extract, don't duplicate. `src/lib/design-images.ts`
  `deleteDesignImageRow` and `src/lib/delete-design.ts` (the #190 extraction)
  are the patterns.
- Ownership: `image.owner_id` (`src/lib/db/schema.ts`). Legacy library rows
  can have `sourceDesignId = null`; the bulk action must still handle them
  (ownership by `owner_id`, no conversation to reparent — R2 object + row).
- Tests: real-DB integration tests via `src/lib/__tests__/test-db.ts` for the
  bulk action (owned/unowned, order-referenced refused, seed detached,
  legacy null-source row, partial success reports both lists); RTL tests for
  the sheet and for the library select mode. Run `npm run lint`,
  `npm run typecheck`, `npm test` before reporting.

## Tasks

### Task 1 — `ConfirmSheet` primitive + `useConfirm`
`src/components/ui/confirm-sheet.tsx`: `ConfirmSheet` (props: `open`,
`title`, `body?`, `confirmLabel` default "Delete", `cancelLabel` default
"Cancel", `danger?: boolean`, `busy?: boolean`, `onConfirm`, `onCancel`),
built on `Modal`, `data-testid="confirm-sheet"`, confirm button
`data-testid="confirm-sheet-confirm"`. Plus `useConfirm()` returning
`{ confirm(opts): Promise<boolean>, element }` so a caller does
`if (!(await confirm({ title, body }))) return;` and renders `{element}` once.
Export from `src/components/ui/index.ts`. RTL tests: resolves true on
confirm, false on cancel/Escape/backdrop, focus lands on the cancel button on
open (safe default), Escape calls `preventDefault`.

### Task 2 — replace all eleven `window.confirm` sites
Mechanical swap to `useConfirm` in the five files listed above. Each site's
existing string becomes the `body`; the title is the short question form
(e.g. "Delete this conversation?", "Retry Printful submission?", "Archive
this order?", "Take this design down?"). Admin pages: `confirmLabel` matches
the verb ("Retry", "Refund", "Archive"). Assert with
`grep -rn "window.confirm" src` = empty; existing tests still pass.

### Task 3 — `deleteImages` bulk action with image-level rules
Extract the single-image core of `deleteDesignImage` into
`src/lib/delete-image.ts` as `planImageDeletion(imageId, userId)` /
`executeImageDeletion(plan)` (mirroring `delete-design.ts`'s plan/execute
split), returning an outcome from the same `ImageDeletionOutcome` vocabulary
plus `"not-owned"`. `deleteDesignImage` delegates to it (behaviour
unchanged — its tests must still pass). New server action
`deleteImages(imageIds: string[])` in `src/app/designs/actions.ts`: auth,
per-image plan, execute the deletable ones, return
`{ deleted: string[], skipped: { imageId, reason }[] }`; revalidate
`/designs`. Integration tests as listed in constraints.

### Task 4 — select mode on My Designs
`src/app/designs/library-grid.tsx` becomes a client component with Select /
Select all / Cancel / Delete (N), mirroring the Studio bench's select mode
(`studio-client.tsx` `enterSelectMode`…`bulkDelete`) — same optimistic
pattern: tiles leave now, skipped ones come back with one plain notice
line (write a pure `bulkImageDeleteNotice(skipped)` next to
`bulkDeleteSkipNotice` in `src/lib/studio-view.ts` or a new
`src/lib/library-view.ts`). Confirm via the new sheet with body from a pure
`bulkImageDeleteConfirm(count)` ("Delete N images? Images used in an order
are kept."). In select mode a tile toggles selection instead of navigating.
`data-testid="library-select"`, `library-delete`, `library-tile-checked`.
RTL tests: enter select, toggle, delete calls the action with the ids and
removes tiles, skipped tile returns with notice.
