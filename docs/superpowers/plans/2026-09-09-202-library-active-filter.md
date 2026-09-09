# My Designs Active/All Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace My Designs' always-on, meaningless "Archived" badge with an explicit Active/All filter, so the grid's default view reads as signal rather than noise — without ever hiding an image by default.

**Architecture:** `getUserImageLibrary` (`src/lib/user-designs.ts`) already computes `isArchived` per image (a conversation that's idle-archived off the bench, or explicitly archived by `deleteDesign`'s ordered-image fallback). The grid (`src/app/studio/library/library-grid.tsx`) currently prints "Archived" under nearly every tile — since #181's 3-day idle sweep, that's most images, so the label carries no information. Add a pure client-side filter (`src/lib/library-view.ts`) with two states, "All" (default) and "Active", and a small segmented toggle above the grid; drop the per-tile "Archived" text now that the filter expresses it instead.

**Tech Stack:** Next.js App Router, React (client component), Tailwind, Vitest + Testing Library.

**Spec:** GitHub issue #202 (`gh issue view 202`).

## Global Constraints

- **The default view must show every image, unfiltered ("All").** `user-designs.ts`'s own doc comment states why: "Hiding an ordered design's artwork would take the reorder route with it, since /d is how a design reaches /preview now." Confirmed by code: `order-fulfillment.ts:217` sets `design.status = "ordered"` on purchase, which does *not* clear `isArchived` — and the studio bench's 3-day idle sweep (`sweepIdleConversations`) sets `closed_at` on ANY design left untouched, ordered ones included. An ordered image reliably becomes `isArchived: true` a few days after purchase. Defaulting to "Active" would silently remove a customer's own ordered artwork from their library — do not do this.
- Do not attempt to split "conversation went idle" from "user explicitly archived" — issue #202 itself defers that as a harder, separate question. This plan only adds a filter over the existing single `isArchived` boolean.
- No new DB query, no schema change — `LibraryImage[]` already carries `isArchived`; this is a pure client-side filter over data already fetched.
- Run `npm run lint`, `npm run typecheck`, and the relevant vitest file after every task.

---

### Task 1: Pure filter helper

**Files:**
- Modify: `src/lib/library-view.ts`
- Test: create `src/lib/__tests__/library-view.test.ts` (no existing test file for this module — check first with `ls src/lib/__tests__/library-view*` in case one was added since this plan was written, and extend it instead of creating a duplicate)

**Interfaces:**
- Consumes: `LibraryImage` from `@/lib/user-designs` (existing type, has `imageId`, `isArchived`, etc. — see `src/lib/user-designs.ts:15-30`).
- Produces: `export type LibraryFilter = "all" | "active";` and `export function filterLibraryImages(images: LibraryImage[], filter: LibraryFilter): LibraryImage[]`, both imported by Task 2.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { filterLibraryImages } from "../library-view";
import type { LibraryImage } from "../user-designs";

function img(overrides: Partial<LibraryImage> = {}): LibraryImage {
  return {
    imageId: "img-1",
    imageUrl: "https://example.com/img-1.png",
    createdAt: new Date("2026-09-01T00:00:00Z"),
    isPublished: false,
    backgroundColor: null,
    sourceDesignId: "design-1",
    isArchived: false,
    ...overrides,
  };
}

describe("filterLibraryImages", () => {
  it("'all' returns every image unchanged, archived included", () => {
    const images = [img({ imageId: "a" }), img({ imageId: "b", isArchived: true })];
    expect(filterLibraryImages(images, "all")).toEqual(images);
  });

  it("'active' excludes archived images", () => {
    const images = [
      img({ imageId: "a", isArchived: false }),
      img({ imageId: "b", isArchived: true }),
    ];
    const result = filterLibraryImages(images, "active");
    expect(result.map((i) => i.imageId)).toEqual(["a"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/__tests__/library-view.test.ts`
Expected: FAIL — `filterLibraryImages` is not exported.

- [ ] **Step 3: Implement the helper**

Add to `src/lib/library-view.ts` (top-level export, alongside the existing helpers):

```ts
/**
 * Two views over the same list, never a server re-query: "all" is the
 * library's real default (every image, archived included — see the
 * doc comment on this module's Global Constraints in the implementation
 * plan for why an archived-conversation image must never be hidden by
 * default), "active" is an opt-in declutter for a user who wants to see
 * only what's still live on the Studio bench.
 */
export type LibraryFilter = "all" | "active";

export function filterLibraryImages(
  images: LibraryImage[],
  filter: LibraryFilter
): LibraryImage[] {
  if (filter === "all") return images;
  return images.filter((img) => !img.isArchived);
}
```

Add the import this needs at the top of the file:

```ts
import type { LibraryImage } from "./user-designs";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/__tests__/library-view.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/library-view.ts src/lib/__tests__/library-view.test.ts
git commit -m "library-view: pure all/active filter helper (#202)"
```

---

### Task 2: Wire the filter into the My Designs grid, drop the Archived badge

**Files:**
- Modify: `src/app/studio/library/library-grid.tsx`
- Test: `src/app/studio/library/__tests__/library-grid.test.tsx`

**Interfaces:**
- Consumes: `filterLibraryImages`, `LibraryFilter` from `@/lib/library-view` (Task 1).
- Produces: `data-testid="library-filter-all"` / `data-testid="library-filter-active"` on the two toggle buttons; no other exports change.

- [ ] **Step 1: Write the failing tests**

Add to `src/app/studio/library/__tests__/library-grid.test.tsx` (it already has an `img()` factory matching `LibraryImage` — see the file's existing setup):

```tsx
it("defaults to All — an archived image is visible on first render", () => {
  render(
    <LibraryGrid
      images={[img({ imageId: "img-1", isArchived: true })]}
    />
  );
  expect(screen.getByTestId("library-tile")).toBeTruthy();
});

it("Active hides archived images; All brings them back", () => {
  render(
    <LibraryGrid
      images={[
        img({ imageId: "img-1", isArchived: false }),
        img({ imageId: "img-2", isArchived: true }),
      ]}
    />
  );
  expect(screen.getAllByTestId("library-tile")).toHaveLength(2);

  fireEvent.click(screen.getByTestId("library-filter-active"));
  expect(screen.getAllByTestId("library-tile")).toHaveLength(1);

  fireEvent.click(screen.getByTestId("library-filter-all"));
  expect(screen.getAllByTestId("library-tile")).toHaveLength(2);
});

it("Active with nothing active shows a lighter empty state than the true-empty one", () => {
  render(<LibraryGrid images={[img({ imageId: "img-1", isArchived: true })]} />);
  fireEvent.click(screen.getByTestId("library-filter-active"));
  expect(screen.getByText("Nothing active — switch to All to see everything.")).toBeTruthy();
});

it("no longer prints an Archived marker on the tile", () => {
  render(<LibraryGrid images={[img({ imageId: "img-1", isArchived: true })]} />);
  expect(screen.queryByText("Archived")).toBeNull();
  expect(screen.queryByText(/Archived/)).toBeNull();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/studio/library/__tests__/library-grid.test.tsx -t "Active"`
Expected: FAIL — no `library-filter-active` testid exists yet.

- [ ] **Step 3: Add filter state and the toggle control**

In `src/app/studio/library/library-grid.tsx`, add the import:

```tsx
import { filterLibraryImages, type LibraryFilter } from "@/lib/library-view";
```

Inside `LibraryGrid`, alongside the existing `useState` calls (near the top of the component body), add:

```tsx
const [filter, setFilter] = useState<LibraryFilter>("all");
```

Compute the filtered view right before the `return` (after `bulkDelete`, before `return (`):

```tsx
const visible = filterLibraryImages(shown, filter);
```

Replace the controls block's opening (currently `{(shown.length > 0 || selectMode) && (` at line 117) with a row that also carries the filter toggle. Insert the toggle as a new sibling `<div>` directly above the existing Select/count controls block, gated on there being anything to filter (`shown.length > 0`, independent of `selectMode` — the toggle should stay visible while selecting too, so switching Active/All doesn't require leaving select mode):

```tsx
{shown.length > 0 && (
  <div className="mb-2 flex items-center gap-2">
    <button
      type="button"
      onClick={() => setFilter("all")}
      data-testid="library-filter-all"
      className={`text-xs px-2 min-h-11 ${
        filter === "all"
          ? "text-foreground underline underline-offset-[3px]"
          : "text-text-muted hover:text-foreground"
      }`}
    >
      All
    </button>
    <button
      type="button"
      onClick={() => setFilter("active")}
      data-testid="library-filter-active"
      className={`text-xs px-2 min-h-11 ${
        filter === "active"
          ? "text-foreground underline underline-offset-[3px]"
          : "text-text-muted hover:text-foreground"
      }`}
    >
      Active
    </button>
  </div>
)}
```

(This matches the existing underline-for-selected / muted-for-unselected filter pattern already used on `/admin` — same classes, same convention, nothing new invented.)

- [ ] **Step 4: Render the filtered list, and Select-all over the filtered list**

Change `disabled={shown.length === 0 || selected.size === shown.length}` and `onClick={() => setSelected(new Set(shown.map((i) => i.imageId)))}` (in the "Select all" button) to use `visible` instead of `shown`, so selecting-all only selects what's actually on screen:

```tsx
onClick={() => setSelected(new Set(visible.map((i) => i.imageId)))}
disabled={visible.length === 0 || selected.size === visible.length}
```

Change the grid render block from `shown.map((img) => (` to `visible.map((img) => (` (the JSX is otherwise unchanged).

- [ ] **Step 5: Two empty states — genuinely empty vs. filtered-to-nothing**

Replace the existing single `{shown.length === 0 ? <EmptyState message="No designs yet." /> : (...)}` block with:

```tsx
{shown.length === 0 ? (
  // Only reachable by deleting the last image — the page renders its
  // own empty state on a cold load. Same line, so the screen doesn't
  // change its mind about what to call this.
  <EmptyState message="No designs yet." />
) : visible.length === 0 ? (
  // Everything exists, the Active filter just hid all of it — a
  // different message than "No designs yet.", which would read as if
  // the account had nothing at all.
  <EmptyState message="Nothing active — switch to All to see everything." />
) : (
  <div
    data-testid="library-grid"
    className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 sm:gap-3"
  >
    {visible.map((img) => (
      <LibraryCell
        key={img.imageId}
        image={img}
        selectMode={selectMode}
        selected={selected.has(img.imageId)}
        onToggle={toggleSelected}
      />
    ))}
  </div>
)}
```

- [ ] **Step 6: Drop the "Archived" marker, keep "Published"**

In `LibraryCell`, replace:

```tsx
const marker = [
  img.isPublished ? "Published" : null,
  img.isArchived ? "Archived" : null,
]
  .filter(Boolean)
  .join(" · ");
```

with:

```tsx
const marker = img.isPublished ? "Published" : null;
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/app/studio/library/__tests__/library-grid.test.tsx`
Expected: PASS, including every pre-existing test in the file (select mode, bulk delete) — none of them reference `shown` directly, they query rendered tiles, so switching the render source to `visible` should not break them as long as `filter` defaults to `"all"`.

- [ ] **Step 8: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add src/app/studio/library/library-grid.tsx src/app/studio/library/__tests__/library-grid.test.tsx
git commit -m "My Designs: Active/All filter replaces the always-on Archived badge (#202)"
```

---

## Self-Review

**Spec coverage:** #202's stated fix direction — "a default view/filter, not more badges" — is Task 2 (filter toggle, Archived badge dropped). The issue's own "probably need separating" (conversation-idle vs. user-archived) is explicitly out of scope per Global Constraints, matching the issue's own framing of it as unresolved. The default-stays-"All" decision is a deliberate deviation from a naive reading of "filter by default" — justified by a real invariant found in the code (`user-designs.ts`'s doc comment + `order-fulfillment.ts:217` + the idle-sweep behavior), not a hedge. If Nico wants "Active" as the literal default despite that tradeoff, that's a one-line change to `useState<LibraryFilter>("all")` → `useState<LibraryFilter>("active")` after reading this reasoning — flag it back rather than silently deciding against the code's documented invariant.

**Placeholder scan:** none.

**Type consistency:** `LibraryFilter` and `filterLibraryImages` signatures match between Task 1's implementation and Task 2's import/usage. `visible` (Task 2) has the same `LibraryImage[]` type as `shown`, so `LibraryCell`'s existing `image={img}` prop typing is unaffected.
