# Studio Cell Lightbox Affordance + Type Scale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the Studio bench (`/studio`), give each generated-image cell a way to open the shared lightbox and reach that image's detail page, without disturbing the existing tap-to-anchor interaction; separately, converge two undersized labels onto the site's established 11px mono standard.

**Architecture:** Studio's cell tap already means "anchor this image for editing" (`onTapCell`) — that's the redesigned bench's core fast-iterate loop and must not change. Add a second, small, explicit affordance per cell: a corner icon button (sibling of the anchor button, not nested inside it — browsers don't allow `<button>` inside `<button>`) that opens the existing shared `ImageLightbox` component (`src/app/design/image-lightbox.tsx`), scoped to that lane's cells, with an "Open" action that links to `/d/[imageId]`. This is the same pattern the image detail page's "Other images from this design" strip already uses (`src/app/d/[imageId]/conversation-images.tsx`) — copy its shape, don't invent a new one.

**Tech Stack:** Next.js App Router, React (client component), Tailwind, Vitest + Testing Library.

**Spec:** GitHub issue #236 (`gh issue view 236`) — filed 2026-09-09 from a live phone smoke of the Studio bench.

## Global Constraints

- Do not change what a plain tap on a cell does (`onTapCell` stays the anchor toggle). The icon is an additional, separate tap target.
- Reuse `ImageLightbox` (`src/app/design/image-lightbox.tsx`) as-is — do not fork it or add new props unless a step below says to. It already supports `images`, `currentIndex`, `onClose`, `onNavigate`, and a free-form `actions` slot.
- No nested interactive elements: the icon button must be a DOM sibling of the existing cell `<button>`, absolutely positioned on top of it, never a descendant.
- Keep the existing Paper mono-label convention (`font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted`, used at `studio-client.tsx:707,742,1074,1182`) — the type-scale task converges two 10px outliers onto this standard, it does not invent a new size.
- Run `npm run lint`, `npm run typecheck`, and the relevant vitest file after every task.

---

### Task 1: Per-cell lightbox affordance on the Studio bench

**Files:**
- Modify: `src/app/studio/studio-client.tsx` (the `Lane` component, currently `function Lane({...})` starting at line 955; the cell-rendering block is inside its returned JSX, roughly lines 1115–1170)
- Test: `src/app/studio/__tests__/studio-client.test.tsx`

**Interfaces:**
- Consumes: `ImageLightbox` and `LightboxImage` from `@/app/design/image-lightbox` (existing, unchanged) — `ImageLightbox({ images: LightboxImage[], currentIndex: number, onClose: () => void, onNavigate: (index: number) => void, actions?: ReactNode, ... })`. `LightboxImage = { id: string; number: number; url: string; publishedAt?: Date | null; role?: "output" | "seed" }`.
- Consumes: `StudioLane["cells"]` entries have shape `{ imageId: string; imageUrl: string; isPrimary: boolean; createdAt: Date }` (from `src/lib/studio.ts`).
- Produces: no new exports. `data-testid="studio-cell-expand"` on the new icon button, and the lightbox renders with its existing `data-testid="image-lightbox"` (already defined in `image-lightbox.tsx:95`) when open.

- [ ] **Step 1: Write the failing test**

Add to `src/app/studio/__tests__/studio-client.test.tsx`, inside (or as a new) `describe("cells (Paper bench)", ...)` block — this file already has `lane()` and `cell()` factories and a working `render(<StudioClient initialLanes={[...]} />)` pattern (see the existing "numbers cells in creation order" test around line 131 for the exact shape):

```tsx
it("opens the lightbox from a cell's expand icon, with an Open link to the detail page", () => {
  render(
    <StudioClient
      initialLanes={[
        lane({
          designId: "design-1",
          cells: [cell("img-1"), cell("img-2")],
        }),
      ]}
    />
  );

  const expandButtons = screen.getAllByTestId("studio-cell-expand");
  fireEvent.click(expandButtons[1]); // open on the second cell

  const lightbox = screen.getByTestId("image-lightbox");
  expect(lightbox).toBeTruthy();

  const openLink = within(lightbox).getByRole("link", { name: "Open" });
  expect(openLink.getAttribute("href")).toBe("/d/img-2");
});

it("tapping a cell still anchors it — the expand icon doesn't change that", () => {
  render(
    <StudioClient
      initialLanes={[lane({ designId: "design-1", cells: [cell("img-1")] })]}
    />
  );

  fireEvent.click(screen.getByTestId("studio-cell"));
  expect(screen.getByTestId("studio-cell").getAttribute("aria-pressed")).toBe(
    "true"
  );
  // The expand icon must not have triggered anchoring on its own click.
  expect(screen.queryByTestId("image-lightbox")).toBeNull();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/studio/__tests__/studio-client.test.tsx -t "expand"`
Expected: FAIL — `getAllByTestId("studio-cell-expand")` finds no elements.

- [ ] **Step 3: Add the `ImageLightbox` import and per-lane lightbox state**

In `src/app/studio/studio-client.tsx`, add the import near the top (after the existing `Link`/`Image` imports):

```tsx
import { ImageLightbox, type LightboxImage } from "@/app/design/image-lightbox";
```

Inside `function Lane({ ... })`, right after the existing `const sectionRef = useRef<HTMLElement>(null);` / `const scrollRef = ...` block (around line 989-991), add:

```tsx
const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
```

(`useState` is already imported in this file's top-level React import block.)

- [ ] **Step 4: Restructure the cell markup — wrapper `div` + sibling icon button**

Replace the cell-rendering block (the `lane.cells.map((cell, index) => { ... })` currently starting at line 1116) with:

```tsx
{lane.cells.map((cell, index) => {
  const anchored = cell.imageId === anchoredImageId;
  // Creation order, same convention as the /design strip (#151):
  // #1 is the lane's first image, and a later generation never
  // renumbers an earlier one.
  const label = `#${index + 1}`;
  return (
    <div
      key={cell.imageId}
      className="relative shrink-0 w-28 h-28 sm:w-36 sm:h-36"
    >
      <button
        type="button"
        data-testid="studio-cell"
        aria-pressed={anchored}
        onClick={() => {
          onTapCell(lane, cell);
          // Anchoring scrolls its lane into view (plan, slice 3): the
          // keyboard takes half the phone, and the lane being edited
          // should survive that.
          sectionRef.current?.scrollIntoView({ block: "nearest" });
        }}
        className={`absolute inset-0 overflow-hidden bg-surface ${
          anchored ? "border-2 border-foreground" : "border border-foreground"
        }`}
      >
        <span className="absolute inset-1.5">
          <Image
            src={cell.imageUrl}
            alt=""
            fill
            sizes="(min-width: 640px) 144px, 112px"
            className="object-contain"
          />
        </span>
        <span className="absolute top-1 left-1.5 font-mono text-[11px] leading-4 text-text-muted">
          {label}
        </span>
        {/* Anchored (2px ink border) and primary (this mono label) are
            orthogonal signals, not two weights of the same one — a
            non-primary cell being edited must not read as "the lead
            image", and the lead image must stay identifiable while
            something else is being edited. Same offsets as the #N
            label, mirrored to the bottom. */}
        {cell.isPrimary && (
          <span className="absolute bottom-1 left-1.5 font-mono text-[11px] leading-4 uppercase tracking-[0.08em] text-text-muted">
            Primary
          </span>
        )}
        {/* No sr-only echo for "Primary": the visible label above IS
            real text in the accessibility tree, so a second sr-only
            span would announce it twice. "Editing" gets one because
            its only signal is the 2px border — a colour/width change
            with no text of its own, and otherwise unannounceable. */}
        {anchored && <span className="sr-only">Editing</span>}
      </button>
      {/* Sibling of the anchor button, not nested inside it — a <button>
          cannot contain another <button>. Absolutely positioned on top
          so it captures its own corner without stopping propagation
          (sibling clicks never bubble to each other). Opens the shared
          lightbox scoped to this lane; anchoring stays a plain tap on
          the rest of the cell (#236). */}
      <button
        type="button"
        aria-label="View image"
        data-testid="studio-cell-expand"
        onClick={() => setLightboxIndex(index)}
        className="absolute top-1 right-1 z-10 w-6 h-6 flex items-center justify-center bg-surface/80 text-foreground border border-foreground"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
        </svg>
      </button>
    </div>
  );
})}
```

- [ ] **Step 5: Render the lightbox below the cells row**

Immediately after the closing `</div>` of the cells-scroll row (the `<div ref={scrollRef} ...>` block), add:

```tsx
{lightboxIndex !== null && (
  <ImageLightbox
    images={lane.cells.map(
      (c, i): LightboxImage => ({ id: c.imageId, number: i + 1, url: c.imageUrl })
    )}
    currentIndex={lightboxIndex}
    onClose={() => setLightboxIndex(null)}
    onNavigate={setLightboxIndex}
    actions={
      <Link
        href={`/d/${lane.cells[lightboxIndex].imageId}`}
        className="self-center text-sm underline text-text-muted hover:text-foreground"
      >
        Open
      </Link>
    }
  />
)}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/app/studio/__tests__/studio-client.test.tsx`
Expected: PASS (both new tests, and no regressions in the existing suite — the cell restructuring must not break any test that queries `data-testid="studio-cell"` or the anchor/aria-pressed behavior).

- [ ] **Step 7: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/app/studio/studio-client.tsx src/app/studio/__tests__/studio-client.test.tsx
git commit -m "Studio bench: per-cell lightbox affordance opening the image detail page (#236)"
```

---

### Task 2: Converge the two undersized cell labels onto the 11px mono standard

**Files:**
- Modify: `src/app/studio/studio-client.tsx` (the `#N` and `Primary` labels — already touched in Task 1's Step 4, since the cell block was rewritten there)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new — purely a class-name change.

Note: if Task 1 already landed, its Step 4 rewrite already applied this change inline (the two labels above are written at `text-[11px] leading-4`, not the original `text-[10px] leading-[14px]`). This task exists as a standalone unit only if Task 1 is skipped or reverted — in that case, apply the same two class-name edits directly to the pre-existing (un-restructured) cell markup:

- [ ] **Step 1: Confirm current sizes**

Run: `grep -n "text-\[10px\]" src/app/studio/studio-client.tsx`
Expected (pre-Task-1): two matches, the `#N` label and the `Primary` label, both `font-mono text-[10px] leading-[14px] ...`.

- [ ] **Step 2: Bump both to the site's 11px mono convention**

Change `font-mono text-[10px] leading-[14px] text-text-muted` (the `#N` label) to `font-mono text-[11px] leading-4 text-text-muted`.

Change `font-mono text-[10px] leading-[14px] uppercase tracking-[0.08em] text-text-muted` (the `Primary` label) to `font-mono text-[11px] leading-4 uppercase tracking-[0.08em] text-text-muted`.

This matches the already-established convention elsewhere in the same file (`studio-client.tsx:707,742,1074,1182`: `font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted`).

- [ ] **Step 3: Run the test suite**

Run: `npx vitest run src/app/studio/__tests__/studio-client.test.tsx`
Expected: PASS — no test asserts on the literal `text-[10px]` class, so this is a safe visual-only change.

- [ ] **Step 4: Commit**

```bash
git add src/app/studio/studio-client.tsx
git commit -m "Studio bench: converge #N/Primary cell labels onto the 11px mono standard (#236)"
```

**Deliberately out of scope:** a broader "everything on Studio reads too small" pass. The only two labels below the site's established 11px mono floor are these two; the lane title (`text-sm`/14px), the composer input (17px, already bumped per the Paper mock), and every other label on the page are already at or above the house scale. If Nico's "looks a little empty" impression persists after these two land, that needs a fresh screenshot-driven look, not a blind further bump — flag it back as a new issue rather than guessing at sizes in this plan.

---

## Self-Review

**Spec coverage:** #236 asks for (a) a per-cell lightbox affordance reaching the detail page without disturbing anchor-on-tap — Task 1. (b) A type-scale bump — Task 2, scoped to the two labels actually below the house standard, with the broader complaint explicitly deferred (see note above) rather than guessed at.

**Placeholder scan:** none — every step has real code.

**Type consistency:** `LightboxImage` fields (`id`, `number`, `url`) match what Task 1's Step 5 constructs; `cell.imageId`/`cell.imageUrl` match `StudioCell`'s real fields (verified against `src/lib/studio.ts`). `data-testid="studio-cell-expand"` is used consistently between Step 1's test and Step 4's markup.
