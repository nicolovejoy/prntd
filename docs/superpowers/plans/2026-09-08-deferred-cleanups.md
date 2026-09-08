# Deferred cleanups from the 2026-09-08 batch (#227–#229)

**Source:** CLAUDE.md "Deferred from the batch" (2026-09-08 session). No spec doc; this plan is the spec. All four items are small and independent; execute as ONE batched task.

## Global Constraints

- No new strings that a user sees unless named below. Copy lives in `src/lib/action-copy.ts` when it is user-facing and referenced from more than one file.
- Persona C: plain, no exclamation marks, no whimsy.
- Run `npm run lint`, `npm run typecheck`, and the named test files before committing.
- No schema change.

## Task 1 (batched): four cleanups

### 1a. Empty-string `alt` fallbacks

`img.title ?? "Design"` yields `alt=""` when the title is the empty string (legacy rows predate #228's blank-title refusal). Change to `img.title || "Design"` / `line.title || "Design"` at exactly these three sites:

- `src/components/published-grid.tsx` line ~52
- `src/app/admin/published/page.tsx` line ~71
- `src/app/admin/orders/[id]/page.tsx` line ~290

No test required for the admin pages. For `published-grid.tsx`, if an existing test file renders the grid, add one case: an image with `title: ""` renders `alt="Design"`. If no test file exists for it, skip.

### 1b. Hoist the error-boundary copy into `action-copy.ts`

`src/app/error.tsx` and `src/app/global-error.tsx` both hard-code "Something went wrong loading this page.", "Try again", and (error.tsx only) "Go to the home page". Add to `src/lib/action-copy.ts`, under a new `// Error boundaries (src/app/error.tsx, global-error.tsx)` section:

```ts
export const ERROR_BOUNDARY_TITLE = "Something went wrong loading this page.";
export const ERROR_BOUNDARY_RETRY = "Try again";
export const ERROR_BOUNDARY_HOME = "Go to the home page";
```

Use them in both files. `global-error.tsx` renders outside the root layout, so confirm the import still works in that file (it is a plain module import; it does). Existing tests under `src/app/__tests__/` for the boundaries (if any) must still pass unchanged — they assert on the rendered text, which is byte-identical.

### 1c. Server-side title length limit

`updatePublishedNaming` in `src/app/designs/actions.ts` refuses a blank title but accepts any length; the client (`src/app/d/[imageId]/editable-naming.tsx`) sets `maxLength={80}`. Enforce the same limit server-side:

- Add `export const MAX_IMAGE_TITLE_LENGTH = 80;` to `src/lib/design-publish.ts` (or the module `updatePublishedNaming` already imports naming rules from — check; if none fits, `src/lib/action-copy.ts` is NOT the place for a number, so put the constant in `design-publish.ts`).
- Add to `src/lib/action-copy.ts` next to `EMPTY_TITLE_REJECTED`: `export const TITLE_TOO_LONG = "A title can't be longer than 80 characters.";`
- In `updatePublishedNaming`, after the blank check: `if (title !== undefined && title.trim().length > MAX_IMAGE_TITLE_LENGTH) return { error: TITLE_TOO_LONG };`
- In `editable-naming.tsx`, replace the literal `80` with the imported constant.
- Test: in `src/app/designs/__tests__/empty-title.integration.test.ts` (rename NOT required), add a case: an 81-character title returns `{ error: TITLE_TOO_LONG }` and does not change the stored title; an 80-character title saves.

### 1d. `/order/confirm` CTA copy

`src/app/order/confirm/page.tsx` has "View My Orders" at two sites (the receipt and the receipt-unavailable fallback). Nav model A has no "My" anywhere (the header item is "Orders", the masthead is ORDERS). Change both to `View orders`. Update `src/app/order/confirm/__tests__/confirm-page.test.tsx`: the test named `"links View My Orders to /orders"` and the second `getByRole("link", { name: "View My Orders" })` at line ~152 — rename the test to `"links View orders to /orders"` and change both accessible-name queries to "View orders". Also check `e2e/` for the string and update if present.

Commit as one commit: `Deferred cleanups: alt fallbacks, error-boundary copy hoisted, server-side title limit, "View orders"`.
