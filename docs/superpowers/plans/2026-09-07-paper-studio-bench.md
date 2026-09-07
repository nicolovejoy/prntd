# Paper Studio Bench (#188 slice 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-lay the Studio bench (`/studio`) to Nico's approved Paper mock — composer at the top in a bordered paper panel, lanes as ruled sections with a relative time and a ⋯ overflow, cells as bordered white squares with mono `#N` labels — without touching any of the optimistic/poll/cancel logic.

**Architecture:** Presentation-only. `src/app/studio/studio-client.tsx` is restructured (JSX + classes), `src/lib/studio-view.ts` gains no new time helper (`timeAgo` already produces the mock's exact strings — see Global Constraints) but gets tests pinning the mock's four outputs. The fixed-bottom composer is deleted; the composer panel renders as the first child of `<main>`, above the lanes. The select-mode toolbar keeps its bottom-docked position (thumb reach during a multi-lane selection) but the page only pays bottom padding for it while select mode is on. Every `data-testid` and every behavioural test in `src/app/studio/__tests__/studio-client.test.tsx` survives; only layout/class assertions are re-pointed.

**Tech Stack:** Next.js 16 App Router, React client component, Tailwind v4 with the Paper tokens in `src/app/globals.css`, Vitest + Testing Library.

**Spec:** the two mock artboards (read them; they are the spec):
- `/private/tmp/claude-501/-Users-nico-src-prntd/91f26897-89f5-4885-957d-9ad55d211691/scratchpad/mocks/BenchPaperLaptop.dc.html` (1440px)
- `/private/tmp/claude-501/-Users-nico-src-prntd/91f26897-89f5-4885-957d-9ad55d211691/scratchpad/mocks/BenchPaperPhone.dc.html` (390px)

plus `docs/ux-design-review-2026-09.md` ("The four screens to mock next", item 1) and `docs/design-system.md` Part 1 (persona C).

## Global Constraints

Every task's requirements implicitly include this section.

**Scope fence.** Touch ONLY: `src/app/studio/studio-client.tsx`, `src/app/studio/__tests__/studio-client.test.tsx`, `src/app/studio/layout.tsx`, `src/lib/studio-view.ts`, `src/lib/__tests__/studio-view.test.ts`, `docs/superpowers/**`. Other slices are editing orders/cart/admin/auth/`/d`/shop in parallel. Do NOT modify `src/components/ui/*` or `src/app/globals.css`.

**Migration-free.** No schema change. If you think you need one, stop and report.

**Logic is frozen.** `pollOnce`, `applyOptimistic`, `settleOptimistic`, `unseenOptimisticCount`, the `jobIdKnownAtMs` recency guard, `submit()`'s control flow, `cancelJob`, `closeLane`, `deleteLane`, `bulkDelete`, `toggleAnchor`, the anchor-survives-poll effect, the mount reconcile, and the wake handler all keep their current semantics byte-for-byte. You may move where their JSX renders and rename nothing. If you find a genuine bug in them, write it in the ledger and LEAVE IT.

**`timeAgo` is the relative-time helper — do not add a second one.** `timeAgo(date, nowMs)` in `src/lib/studio-view.ts` already returns exactly the mock's strings (`"just now"`, `"14m ago"`, `"2h ago"`, `"1d ago"`). Adding a `relativeTime(ms, now)` beside it would be duplicate logic with two drift surfaces. Task 4 pins the mock's four outputs as tests on `timeAgo` instead.

**Paper vocabulary (tokens only, no hex literals, no dark literals):**
- Panel / cell surface: `bg-surface border border-foreground`
- Hairline rules between lanes: `border-t border-border`
- Mono label: `font-mono text-[11px] leading-4 tracking-[0.08em] uppercase`
- Mono `#N` cell label: `font-mono text-[10px] leading-[14px] text-text-muted`
- Body 14px (`text-sm`), lane title `text-sm font-medium truncate`
- Muted `text-text-muted`, faint `text-text-faint`
- Links / Cancel: `underline underline-offset-[3px]`
- No shadows, no rounded pills, no `rounded-*` on the new cells and panel (the mock is square-cornered). Existing primitives (`Button`, `Input`) keep their own radius — do not fight them.
- 44px minimum tap target on every interactive control (`min-h-11`).
- Generate stays `<Button variant="generate">` (solid rose). The mock draws it outlined; **Nico's later "One Mark" decision (rose wordmark + solid rose Generate) wins over the mock's earlier drawing.** Ruled; do not re-litigate.

**Copy (persona C — plain, literal, no exclamation marks):**
- Composer mono label: `New design`
- Composer placeholder, unanchored: `Describe a design` (existing string, keep)
- Composer placeholder, anchored: `Describe the change` (existing string, keep)
- Composer hint line: `Each line starts a design. Tap a result to change it.`
- Lane generating pill: `Generating`
- Pending cell: `Generating…` (existing string with the ellipsis character, keep) and `Cancel`
- Empty state: `No open designs.` (existing string, keep). No CTA.
- Overflow control accessible name: `More`

**Verification before the PR (all four, in the worktree):** `npm run lint && npm run typecheck && npm test && npm run build`.

---

## File Structure

- `src/app/studio/studio-client.tsx` — modified. The `StudioClient` component's returned JSX is restructured (composer panel first, lanes below, select bar conditionally docked); `Lane` is restructured (ruled section, header row, overflow menu, new cell chrome). Two small new components live in this same file beside `Lane`, following its existing local-component pattern: `Composer` (the panel) and `LaneMenu` (the ⋯ popover). The file is already ~920 lines; it does not need splitting for this slice and splitting it would collide with the frozen logic.
- `src/app/studio/__tests__/studio-client.test.tsx` — modified. Behavioural tests keep their assertions; layout/class assertions are re-pointed; new tests cover the panel position, the overflow menu, and the cell chrome.
- `src/app/studio/layout.tsx` — modified, one line (top padding).
- `src/lib/__tests__/studio-view.test.ts` — modified. New tests pinning `timeAgo`'s four mock strings.

---

### Task 1: `timeAgo` pins the mock's four strings; the Studio frame loses its double top padding

**Files:**
- Modify: `src/lib/__tests__/studio-view.test.ts`
- Modify: `src/app/studio/layout.tsx:21`

**Interfaces:**
- Consumes: `timeAgo(date: Date, nowMs?: number): string` from `src/lib/studio-view.ts` (already exported).
- Produces: nothing new. Later tasks rely on `timeAgo` being the only relative-time helper.

**Context.** The bench's lane order is activity-desc (`laneLastActiveAt`); #187 point 3 says that reads as random without a visible time. The mock shows a mono relative time in every lane header. `timeAgo` already produces those strings; this task proves it against the mock's exact four so a future edit can't drift them. Separately, `layout.tsx` pays `pt-8` above the tab strip and `studio-client.tsx`'s `<main>` pays `py-8` below it — ~32px of dead space under the strip that the mock does not have (the mock's composer block is `padding: 24px 0` directly under the strip). The layout half is this task; the `<main>` half lands in Task 2 when that element is rewritten anyway.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/__tests__/studio-view.test.ts`, inside the existing `describe("timeAgo", ...)` block if there is one, otherwise as a new top-level `describe`:

```ts
describe("timeAgo — the Paper bench mock's four labels", () => {
  // The lane header in docs' BenchPaper{Laptop,Phone} artboards shows
  // exactly these strings. Pinned so a future edit to the scale cannot
  // silently change what a lane says it did last.
  const base = new Date("2026-09-07T12:00:00.000Z");
  const at = (msAgo: number) => timeAgo(new Date(base.getTime() - msAgo), base.getTime());

  it("renders 'just now' under a minute", () => {
    expect(at(0)).toBe("just now");
    expect(at(59_000)).toBe("just now");
  });

  it("renders minutes as '14m ago'", () => {
    expect(at(14 * 60_000)).toBe("14m ago");
  });

  it("renders hours as '2h ago'", () => {
    expect(at(2 * 60 * 60_000)).toBe("2h ago");
  });

  it("renders days as '1d ago'", () => {
    expect(at(24 * 60 * 60_000)).toBe("1d ago");
  });
});
```

If `timeAgo` is not already imported at the top of that file, add it to the existing import from `@/lib/studio-view`.

- [ ] **Step 2: Run the tests**

Run: `npx vitest run src/lib/__tests__/studio-view.test.ts`
Expected: PASS (these pin existing behaviour). If any FAIL, `timeAgo` has drifted from the mock — fix `timeAgo`, not the test, and note it in the ledger.

- [ ] **Step 3: Drop the layout's top padding above the tab strip**

In `src/app/studio/layout.tsx`, change the wrapper div's classes from:

```tsx
<div className="px-4 sm:px-6 pt-8 max-w-4xl mx-auto w-full">
```

to:

```tsx
<div className="px-4 sm:px-6 pt-6 max-w-4xl mx-auto w-full">
```

`pt-6` (24px) matches the mock's rhythm above the strip; the ~32px that read as dead space was `pt-8` stacking with `<main>`'s `py-8` BELOW the strip, and Task 2 removes that half.

- [ ] **Step 4: Run the studio suites**

Run: `npx vitest run src/lib/__tests__/studio-view.test.ts src/app/studio/__tests__/studio-client.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/__tests__/studio-view.test.ts src/app/studio/layout.tsx
git commit -m "studio: pin timeAgo's bench labels; trim the tab strip's top padding"
```

---

### Task 2: The composer moves to the top as a bordered paper panel

**Files:**
- Modify: `src/app/studio/studio-client.tsx` (the `StudioClient` return block, roughly lines 530–706; the module docstring at lines 37–79)
- Test: `src/app/studio/__tests__/studio-client.test.tsx`

**Interfaces:**
- Consumes: `timeAgo` (unchanged), `Button`, `EmptyState` from `@/components/ui`.
- Produces: a local `Composer` component in `studio-client.tsx` with this exact signature, which Task 3 and Task 4 do not touch:

```tsx
function Composer({
  text,
  anchor,
  atCap,
  capNotice,
  notice,
  onChangeText,
  onSubmit,
  onClearAnchor,
}: {
  text: string;
  anchor: Anchor | null;
  atCap: boolean;
  capNotice: string;
  notice: string | null;
  onChangeText: (value: string) => void;
  onSubmit: () => void;
  onClearAnchor: () => void;
}): React.ReactElement
```

**Context.** Today the composer is `fixed bottom-0 inset-x-0 …` and `<main>` pays `pb-40` for it. The mock puts it directly under the tab strip as a bordered paper panel — 640px wide on desktop, full width on phone — with a mono `New design` label, an underlined single-line field, a hint line and Generate on the right. The anchored ("Editing #N") state must survive functionally; it renders as a row inside the same panel, above the hint line. The select-mode toolbar stays docked at the bottom (thumb reach while picking lanes) but `<main>` now pays bottom padding for it ONLY while select mode is on.

The field is drawn as a bottom-hairline-only underlined input, not the `Input` primitive's bordered box — the primitive is off-limits this slice and its box is the wrong shape here, so this is a bare `<input>` with the panel's own classes. It keeps `data-testid="studio-composer"` and stays inside a `<form>` so the existing `fireEvent.submit(...closest("form"))` tests and Enter-to-submit both keep working.

- [ ] **Step 1: Write the failing tests**

Add to `src/app/studio/__tests__/studio-client.test.tsx`, as a new `describe` after the existing `describe("the composer", ...)`:

```tsx
describe("the composer panel (Paper bench)", () => {
  it("renders above the lanes, not docked to the bottom", () => {
    render(<StudioClient initialLanes={[laneWithCells()]} />);
    const composer = screen.getByTestId("studio-composer");
    const lane = screen.getByTestId("studio-lane");
    // Node.compareDocumentPosition: DOCUMENT_POSITION_FOLLOWING (4) means
    // `lane` comes after `composer` in document order.
    expect(composer.compareDocumentPosition(lane) & 4).toBe(4);
    const panel = screen.getByTestId("studio-composer-panel");
    expect(panel.className).not.toContain("fixed");
  });

  it("labels the panel and states what a line does", () => {
    render(<StudioClient initialLanes={[]} />);
    expect(screen.getByText("New design")).toBeTruthy();
    expect(
      screen.getByText("Each line starts a design. Tap a result to change it.")
    ).toBeTruthy();
  });

  it("shows the anchored image as a row inside the panel", () => {
    render(<StudioClient initialLanes={[laneWithCells()]} />);
    fireEvent.click(screen.getByTestId("studio-cell"));
    const chip = screen.getByTestId("anchor-chip");
    expect(screen.getByTestId("studio-composer-panel").contains(chip)).toBe(true);
  });

  it("pays no bottom padding for a composer that is no longer docked", () => {
    render(<StudioClient initialLanes={[laneWithCells()]} />);
    expect(screen.getByRole("main").className).not.toContain("pb-40");
  });
});
```

`laneWithCells()` — reuse whatever lane factory the existing tests already use in this file (they build `StudioLane` fixtures near the top). Do NOT invent a new factory; call the existing one and adjust its arguments if needed.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/studio/__tests__/studio-client.test.tsx -t "composer panel"`
Expected: FAIL — no `studio-composer-panel` test id, the composer sits after the lanes, `pb-40` present.

- [ ] **Step 3: Extract the `Composer` component**

Add this beside `Lane` at the bottom of `src/app/studio/studio-client.tsx`:

```tsx
/**
 * The bench's one submit control, at the top of the page (Paper bench,
 * #188 slice 3). It was a fixed bottom bar; the mock puts it under the tab
 * strip as a bordered paper panel, so the page has no fixed chrome and
 * `main` pays no standing bottom padding.
 *
 * The field is a bare underlined input rather than the `Input` primitive:
 * the primitive draws a bordered box, and the panel already owns the box.
 * It keeps `data-testid="studio-composer"` and stays inside a form so Enter
 * submits and the existing submit tests keep working.
 */
function Composer({
  text,
  anchor,
  atCap,
  capNotice,
  notice,
  onChangeText,
  onSubmit,
  onClearAnchor,
}: {
  text: string;
  anchor: Anchor | null;
  atCap: boolean;
  capNotice: string;
  notice: string | null;
  onChangeText: (value: string) => void;
  onSubmit: () => void;
  onClearAnchor: () => void;
}) {
  return (
    <div
      data-testid="studio-composer-panel"
      className="w-full max-w-[640px] bg-surface border border-foreground p-5 flex flex-col gap-3.5"
    >
      <span className="font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted">
        New design
      </span>
      <form
        className="contents"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <input
          type="text"
          value={text}
          onChange={(e) => onChangeText(e.target.value)}
          placeholder={anchor ? "Describe the change" : "Describe a design"}
          className="min-h-11 w-full py-2.5 bg-transparent border-0 border-b border-text-faint text-[17px] leading-6 text-foreground placeholder:text-text-faint focus:outline-none focus:border-foreground"
          data-testid="studio-composer"
        />
        {anchor && (
          <div
            className="flex items-center gap-2 min-w-0"
            data-testid="anchor-chip"
          >
            <div className="relative w-8 h-8 overflow-hidden bg-surface-well shrink-0 border border-border">
              <Image
                src={anchor.imageUrl}
                alt=""
                fill
                sizes="32px"
                className="object-cover"
              />
            </div>
            <span className="font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted truncate">
              Editing · {anchor.title ?? "Untitled"}
            </span>
            <button
              type="button"
              aria-label="Clear anchor"
              onClick={onClearAnchor}
              className="shrink-0 min-h-11 px-2 text-text-muted hover:text-foreground"
            >
              ✕
            </button>
          </div>
        )}
        {atCap && (
          <p className="text-xs text-text-muted" data-testid="cap-notice">
            {capNotice}
          </p>
        )}
        {notice && <p className="text-xs text-text-muted">{notice}</p>}
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs leading-4 text-text-muted">
            Each line starts a design. Tap a result to change it.
          </span>
          <Button
            type="submit"
            variant="generate"
            disabled={!text.trim() || atCap}
            className="shrink-0 min-h-11 px-4 font-mono text-[11px] leading-4 tracking-[0.08em] uppercase"
            data-testid="studio-generate"
          >
            Generate
          </Button>
        </div>
      </form>
    </div>
  );
}
```

`className="contents"` on the form keeps the panel's own flex column layout while still giving the input a real form ancestor.

- [ ] **Step 4: Rewrite `StudioClient`'s return block to use it**

Replace the whole `return ( <> … </> )` at the end of `StudioClient` with:

```tsx
  return (
    <>
      {confirmSheet}
      <main
        className={`flex-1 px-4 sm:px-6 pb-8 max-w-4xl mx-auto w-full ${
          selectMode ? "pb-40" : ""
        }`}
      >
        <div className="py-6">
          {selectMode ? null : (
            <Composer
              text={text}
              anchor={anchor}
              atCap={atCap}
              capNotice={AT_CAP_COPY}
              notice={notice}
              onChangeText={setText}
              onSubmit={() => void submit()}
              onClearAnchor={() => setAnchor(null)}
            />
          )}
        </div>

        {renderedLanes.length === 0 ? (
          <EmptyState message="No open designs." />
        ) : (
          renderedLanes.map((lane) => (
            <Lane
              key={lane.designId}
              lane={lane}
              nowMs={nowMs}
              anchoredImageId={anchor?.imageId ?? null}
              selectMode={selectMode}
              selected={selected.has(lane.designId)}
              onTapCell={toggleAnchor}
              onToggleSelect={toggleSelected}
              onClose={closeLane}
              onDelete={deleteLane}
              onCancel={cancelJob}
              onEnterSelectMode={enterSelectMode}
              unresolvedCellIds={unresolvedCellIds}
              reveal={lane.designId === revealDesignId}
            />
          ))
        )}
      </main>

      {selectMode && (
        <div
          className="fixed bottom-0 inset-x-0 border-t border-foreground bg-surface px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
          data-testid="select-bar"
        >
          <div className="max-w-4xl mx-auto space-y-2">
            {notice && <p className="text-xs text-text-muted">{notice}</p>}
            <div className="flex items-center gap-3">
              <span
                className="text-sm tabular-nums min-w-0 flex-1 truncate"
                data-testid="selected-count"
              >
                {selected.size} selected
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={selectAll}
                disabled={
                  selectableIds.length === 0 ||
                  selected.size === selectableIds.length
                }
                className="min-h-11"
                data-testid="select-all"
              >
                Select all
              </Button>
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={() => void bulkDelete()}
                disabled={selected.size === 0 || bulkDeleting}
                className="min-h-11"
                data-testid="bulk-delete"
              >
                Delete
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={exitSelectMode}
                disabled={bulkDeleting}
                className="min-h-11"
                data-testid="select-done"
              >
                Done
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
```

Three things changed and each is deliberate:
1. The old page-level `<div className="flex items-baseline justify-end gap-3 mb-6">` holding the "Select" control is GONE — Task 3 moves that control into each lane's ⋯ menu. `enterSelectMode` is now passed to `Lane` as `onEnterSelectMode`; add that prop to `Lane`'s signature in this task as a plain pass-through it does not yet render (Task 3 wires it), typed `onEnterSelectMode: () => void`.
2. `EmptyState` loses its Shop action — see Task 4's ruling. Keep the `Link` import only if something else still uses it; if the import goes unused, remove it or lint will fail.
3. `Input` may now be unused in this file. If so, drop it from the `@/components/ui` import.

- [ ] **Step 5: Update the module docstring**

The docstring at the top of `studio-client.tsx` asserts invariants this task just changed. Rewrite these two claims:
- "…and one **docked** composer is the only submit control" → "…and one composer at the top of the page is the only submit control."
- "Three decisions are settled (plan, slice 3): the composer stays **docked**, …" → "…the composer sits at the top of the bench (Paper mock, #188 slice 3), …"
- In the "Select mode (#189)" paragraph, "swaps the composer for a bar" is still true (the bar replaces the panel while select mode is on) — leave it, but add: "The bar is the one piece of fixed chrome left; `main` pays bottom padding for it only while selecting."

Read the whole docstring and fix any OTHER sentence that the move falsified.

- [ ] **Step 6: Re-point the existing composer tests**

Two existing tests reference the old chrome:
- `describe("the empty state…")`'s `"shows the empty state with a Shop path when there are no lanes"` — Task 4 owns this. If it fails now, leave it failing and say so in your report; do not delete it.
- Any assertion on `screen.getByTestId("studio-composer")` still works unchanged.

Run: `npx vitest run src/app/studio/__tests__/studio-client.test.tsx`
Expected: the four new "composer panel" tests PASS; the Shop-link empty-state test FAILS (Task 4's); everything else PASSES.

- [ ] **Step 7: Commit**

```bash
git add src/app/studio/studio-client.tsx src/app/studio/__tests__/studio-client.test.tsx
git commit -m "studio: composer moves to the top as a bordered paper panel"
```

---

### Task 3: Lanes become ruled sections with a relative time and a ⋯ overflow

**Files:**
- Modify: `src/app/studio/studio-client.tsx` (the `Lane` component, roughly lines 709–836)
- Test: `src/app/studio/__tests__/studio-client.test.tsx`

**Interfaces:**
- Consumes: `Lane`'s existing props plus `onEnterSelectMode: () => void` added in Task 2.
- Produces: a local `LaneMenu` component in `studio-client.tsx`:

```tsx
function LaneMenu({ children }: { children: React.ReactNode }): React.ReactElement
```

It renders the ⋯ trigger (`aria-label="More"`, `aria-expanded`, `aria-haspopup="menu"`) and, while open, a panel containing `children`. It closes on outside click, on Escape, and when any child is clicked.

**Context.** The mock's lane is a ruled section: `border-t` hairline, a 44px header row holding the title (still a link to the thread), a bordered mono `Generating` pill only while generating, a mono relative time, and a 46px-wide ⋯ control. Today Close and Delete are inline text buttons in that row and "Select" is a page-level control above the lanes; all three move into the ⋯ menu. Every `data-testid` survives: `studio-close-lane`, `studio-delete-lane`, `select-mode`.

Close and Delete stay hidden while generating (closing or deleting mid-render lands the image in a thread that just left the bench — the existing reason). If ALL of a lane's menu items are hidden, render no trigger at all rather than an empty menu.

- [ ] **Step 1: Write the failing tests**

Add to `src/app/studio/__tests__/studio-client.test.tsx`:

```tsx
describe("the lane row (Paper bench)", () => {
  it("shows a relative time and keeps the title a link to the thread", () => {
    const lane = laneWithCells();
    lane.lastActiveAt = new Date(Date.now() - 14 * 60_000);
    render(<StudioClient initialLanes={[lane]} />);
    expect(screen.getByText("14m ago")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: lane.title! }).getAttribute("href")
    ).toBe(`/design?id=${lane.designId}`);
  });

  it("marks a generating lane with a status pill", () => {
    render(<StudioClient initialLanes={[laneWithPending()]} />);
    expect(screen.getByTestId("lane-generating")).toBeTruthy();
  });

  it("holds Close, Delete and Select behind the overflow control", () => {
    render(<StudioClient initialLanes={[laneWithCells()]} />);
    expect(screen.queryByTestId("studio-close-lane")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByTestId("studio-close-lane")).toBeTruthy();
    expect(screen.getByTestId("studio-delete-lane")).toBeTruthy();
    expect(screen.getByTestId("select-mode")).toBeTruthy();
  });

  it("closes the overflow on Escape", () => {
    render(<StudioClient initialLanes={[laneWithCells()]} />);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("studio-close-lane")).toBeNull();
  });

  it("offers no overflow at all while a generation is running", () => {
    render(<StudioClient initialLanes={[laneWithPending()]} />);
    expect(screen.queryByRole("button", { name: "More" })).toBeNull();
  });
});
```

`laneWithPending()` — again, reuse the existing fixture helper in this file for a lane with a pending cell; the existing tests already build one for `describe("cancelling a pending generation (#187)")`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/app/studio/__tests__/studio-client.test.tsx -t "lane row"`
Expected: FAIL — no "More" control, `studio-close-lane` is present without opening a menu, no `lane-generating`.

- [ ] **Step 3: Add `LaneMenu`**

Beside `Lane` in `studio-client.tsx`:

```tsx
/**
 * The per-lane overflow (Paper bench, #188 slice 3). The actions that used
 * to sit as inline text links in the lane header — Close, Delete, and the
 * page-level Select — live behind one 46px control so the row reads as a
 * title, a state and a time, which is what makes activity-desc ordering
 * legible (#187 point 3).
 *
 * Closes on outside click, on Escape, and on any click inside (every item
 * is a terminal action, so there is nothing to keep it open for).
 */
function LaneMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        aria-label="More"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="w-[46px] min-h-11 -mr-3 flex items-center justify-center text-foreground"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          onClick={() => setOpen(false)}
          className="absolute right-0 top-full z-10 min-w-[9rem] bg-surface border border-foreground flex flex-col"
        >
          {children}
        </div>
      )}
    </div>
  );
}
```

Note the Escape handler: `StudioClient` also listens for Escape to leave select mode, but only while `selectMode` is true, and the menu is not rendered in select mode (see Step 4), so the two never both fire.

- [ ] **Step 4: Restructure `Lane`'s header**

Replace `Lane`'s `<section>` opening and header `<div>` (everything from `<section ref={sectionRef} …>` down to the closing `</div>` before `<div ref={scrollRef} …>`) with:

```tsx
    <section
      ref={sectionRef}
      className="border-t border-border pt-2 pb-4 flex flex-col gap-2"
      data-testid="studio-lane"
      data-selected={selectMode ? selected : undefined}
    >
      <div
        className={`flex items-center gap-3 min-h-11 ${
          selectable ? "cursor-pointer" : ""
        }`}
        onClick={selectable ? () => onToggleSelect(lane.designId) : undefined}
      >
        {selectMode && (
          <label
            className={`flex items-center justify-center shrink-0 w-11 h-11 -ml-2 ${
              generating ? "opacity-30" : "cursor-pointer"
            }`}
            onClick={(e) => e.stopPropagation()}
            title={generating ? "Generating" : undefined}
          >
            <input
              type="checkbox"
              checked={selected}
              disabled={generating}
              onChange={() => onToggleSelect(lane.designId)}
              aria-label={`Select ${lane.title ?? "Untitled"}`}
              className="w-5 h-5 accent-accent"
              data-testid="lane-checkbox"
            />
          </label>
        )}
        {selectMode ? (
          <h2 className="min-w-0 flex-1 text-sm font-medium truncate">
            {lane.title ?? "Untitled"}
          </h2>
        ) : (
          <Link
            href={`/design?id=${lane.designId}`}
            className="min-w-0 flex-1 hover:underline"
          >
            <h2 className="text-sm font-medium truncate">
              {lane.title ?? "Untitled"}
            </h2>
          </Link>
        )}
        {generating && (
          <span
            data-testid="lane-generating"
            className="shrink-0 font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-foreground border border-foreground px-2 py-0.5"
          >
            Generating
          </span>
        )}
        <span className="shrink-0 font-mono text-[11px] leading-4 text-text-faint">
          {timeAgo(lane.lastActiveAt, nowMs)}
        </span>
        {/* Close and Delete are absent while generating (closing or deleting
            mid-render would land the image in a thread that just vanished
            from the bench) and in select mode (the bar's Delete is the one
            verb there). With every item gone there is nothing to open, so
            the trigger goes too. */}
        {!generating && !selectMode && (
          <LaneMenu>
            <button
              type="button"
              role="menuitem"
              onClick={() => onClose(lane)}
              className="min-h-11 px-4 text-left text-sm text-text-muted hover:text-foreground hover:bg-surface-well"
              data-testid="studio-close-lane"
            >
              Close
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => onDelete(lane)}
              className="min-h-11 px-4 text-left text-sm text-text-muted hover:text-foreground hover:bg-surface-well"
              data-testid="studio-delete-lane"
            >
              Delete
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={onEnterSelectMode}
              className="min-h-11 px-4 text-left text-sm text-text-muted hover:text-foreground hover:bg-surface-well"
              data-testid="select-mode"
            >
              Select
            </button>
          </LaneMenu>
        )}
      </div>
```

The `mb-8` that used to separate lanes is replaced by the section's own `border-t … pt-2 pb-4`, which is the mock's rule-and-rhythm. The "Generating" text that used to replace the timestamp in select mode is now a real pill shown independently of select mode; keep BOTH — the pill covers generating, the time always shows.

`timeAgo` must be imported in this file already (it is). `useState`/`useEffect`/`useRef` are already imported.

Update `Lane`'s props type to accept `onEnterSelectMode: () => void` (added as a pass-through in Task 2) and document it in the destructure.

- [ ] **Step 5: Verify**

Run: `npx vitest run src/app/studio/__tests__/studio-client.test.tsx`
Expected: the five new "lane row" tests PASS. Several EXISTING tests will now fail because they click Close/Delete/Select without opening the menu first — for each, insert `fireEvent.click(screen.getByRole("button", { name: "More" }));` before the click, and DO NOT weaken any assertion. The affected tests are in `describe("closing a lane")`, `describe("deleting a lane (slice 5 review, F1)")` and `describe("select mode (#189)")`. The tests asserting Close/Delete are ABSENT while generating (`"offers no Close while a generation is running"`, `"offers no Delete while a generation is running"`) still pass as written and should be left alone.

The `"is offered only when there are lanes"` select-mode test asserted `select-mode` exists when lanes exist and is absent when they don't — with the control now per-lane that is still literally true, but it must open the menu first. Re-point it, keep its strength.

- [ ] **Step 6: Commit**

```bash
git add src/app/studio/studio-client.tsx src/app/studio/__tests__/studio-client.test.tsx
git commit -m "studio: lanes are ruled rows with a relative time and a ⋯ overflow"
```

---

### Task 4: Cells, the pending cell and the empty state take the Paper treatment

**Files:**
- Modify: `src/app/studio/studio-client.tsx` (`Lane`'s cell strip, roughly lines 838–916; the empty state in `StudioClient`)
- Test: `src/app/studio/__tests__/studio-client.test.tsx`

**Interfaces:**
- Consumes: everything Tasks 2 and 3 produced.
- Produces: nothing later tasks depend on. This is the last task.

**Context.** The mock's cell is a bordered white square — 144px on desktop, 112px on phone — with the artwork `object-contain` inside a 6px inset and a mono `#N` in the top-left. `#N` is the cell's position in `lane.cells`, creation-ordered, matching the `/design` strip's convention (#151: "`#N` labels are creation-ordered"). The anchored/selected cell takes a 2px ink border. The old `rounded-md bg-checkerboard` wells and the `ring-2 ring-accent ring-offset-2` anchor indicator are gone (checkerboard is dropped everywhere per the design review; the ring is not in the Paper vocabulary).

The pending cell is the same square with a dashed ink border and paper fill, holding a pulsing mono `Generating…`, the tabular elapsed clock, and an underlined `Cancel`. Its logic — `unresolvedCellIds`, the reserved invisible slot, both test ids — is unchanged.

The empty state loses "Browse the Shop": the bench is the making surface and its composer is now the first thing on the page, so a shopping CTA on a maker screen is the wrong offer. That reverses a decision made when `/` redirected signed-in users to `/studio` — a redirect #220 removed, so the premise is gone.

- [ ] **Step 1: Write the failing tests**

```tsx
describe("cells (Paper bench)", () => {
  it("numbers cells in creation order", () => {
    render(<StudioClient initialLanes={[laneWithCells()]} />);
    expect(screen.getByText("#1")).toBeTruthy();
    expect(screen.getByText("#2")).toBeTruthy();
  });

  it("marks the anchored cell with an ink border, not a ring", () => {
    render(<StudioClient initialLanes={[laneWithCells()]} />);
    const cell = screen.getAllByTestId("studio-cell")[0];
    fireEvent.click(cell);
    expect(cell.className).toContain("border-2");
    expect(cell.className).not.toContain("ring-2");
  });

  it("draws the pending cell as a dashed square with elapsed time and Cancel", () => {
    render(<StudioClient initialLanes={[laneWithPending()]} />);
    const pending = screen.getByTestId("studio-pending-cell");
    expect(pending.className).toContain("border-dashed");
    expect(pending.textContent).toContain("Generating…");
    expect(screen.getByTestId("cancel-generation")).toBeTruthy();
  });
});

describe("the empty bench", () => {
  it("offers the composer and one line, and no Shop path", () => {
    render(<StudioClient initialLanes={[]} />);
    expect(screen.getByTestId("studio-composer-panel")).toBeTruthy();
    expect(screen.getByText("No open designs.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Browse the Shop" })).toBeNull();
  });
});
```

Delete the old `"shows the empty state with a Shop path when there are no lanes"` test — it asserts the behaviour this task deliberately reverses, and the new test above covers the same surface with the new contract. Say so in the ledger.

Also re-point `"renders a lane's cells with the primary marked"`: it asserts `cells[1].className` contains `border-accent`. `--accent` is `var(--foreground)`, so `border-accent` and the new `border-foreground` are the same colour with different class names. Change the assertion to check the primary cell has `border-2` and the non-primary does not, keeping the same strength (it still distinguishes exactly one cell).

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/app/studio/__tests__/studio-client.test.tsx -t "Paper bench"`
Expected: FAIL — no `#1` label, ring classes present, pending cell not dashed.

- [ ] **Step 3: Rewrite the cell strip**

Replace the `<div ref={scrollRef} …>` block and its two `.map`s with:

```tsx
      <div ref={scrollRef} className="flex gap-2 overflow-x-auto pb-1">
        {lane.cells.map((cell, index) => {
          const anchored = cell.imageId === anchoredImageId;
          // Creation order, same convention as the /design strip (#151):
          // #1 is the lane's first image, and a later generation never
          // renumbers an earlier one.
          const label = `#${index + 1}`;
          return (
            <button
              key={cell.imageId}
              type="button"
              data-testid="studio-cell"
              aria-pressed={anchored}
              onClick={() => {
                onTapCell(lane, cell);
                sectionRef.current?.scrollIntoView({ block: "nearest" });
              }}
              className={`relative shrink-0 w-28 h-28 sm:w-36 sm:h-36 overflow-hidden bg-surface ${
                anchored || cell.isPrimary
                  ? "border-2 border-foreground"
                  : "border border-foreground"
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
              <span className="absolute top-1 left-1.5 font-mono text-[10px] leading-[14px] text-text-muted">
                {label}
              </span>
              {cell.isPrimary && <span className="sr-only">Primary</span>}
              {anchored && <span className="sr-only">Editing</span>}
            </button>
          );
        })}

        {lane.pending.map((job) => {
          const unresolved = unresolvedCellIds.has(job.jobId);
          return (
            <div
              key={job.jobId}
              data-testid="studio-pending-cell"
              className="shrink-0 w-28 h-28 sm:w-36 sm:h-36 border border-dashed border-foreground bg-surface flex flex-col items-center justify-center gap-1.5"
            >
              <span className="font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted animate-pulse">
                Generating…
              </span>
              <span className="font-mono text-xs leading-4 text-text-faint tabular-nums">
                {formatElapsed(nowMs - job.startedAt.getTime())}
              </span>
              {/* The space is reserved from the start: the control renders
                  inert and invisible until the jobId lands, so the label and
                  elapsed time don't shift under the user when it appears. */}
              <button
                type="button"
                disabled={unresolved}
                aria-hidden={unresolved || undefined}
                tabIndex={unresolved ? -1 : undefined}
                onClick={
                  unresolved ? undefined : () => onCancel(lane, job.jobId)
                }
                className={`text-xs leading-4 text-foreground underline underline-offset-[3px] min-h-7 px-3 ${
                  unresolved ? "invisible" : ""
                }`}
                data-testid={
                  unresolved
                    ? "cancel-generation-placeholder"
                    : "cancel-generation"
                }
              >
                Cancel
              </button>
            </div>
          );
        })}
      </div>
```

Two deliberate departures from the "44px tap targets" rule, both matching the mock: `Cancel` is `min-h-7` (28px) because it lives inside a 112px cell that already has two lines of text above it — a 44px target would not fit and the whole cell is not itself tappable, so nothing is mis-hit. Note this in the ledger. The cells themselves are 112px, comfortably over 44.

- [ ] **Step 4: Confirm the empty state**

Task 2 already replaced the empty state with `<EmptyState message="No open designs." />`. Verify no `Link`/`href="/shop"` remains in this file and that `Link` is still imported only if the lane title still uses it (it does).

- [ ] **Step 5: Run everything**

Run: `npx vitest run src/app/studio/__tests__/studio-client.test.tsx src/lib/__tests__/studio-view.test.ts`
Expected: PASS, all of it.

- [ ] **Step 6: Full verification**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: all green. Record the test count.

- [ ] **Step 7: Commit**

```bash
git add src/app/studio/studio-client.tsx src/app/studio/__tests__/studio-client.test.tsx
git commit -m "studio: paper cells, dashed pending cell, composer-only empty bench"
```

---

## Deferred (do not do in this slice)

- The layout's `<h1>Studio</h1>` is not in either artboard (the mock goes header → tab strip → composer). Removing it would also change `/studio/library` and `/studio/archive`, which this slice has no mock for. Left in place; raise it with the next Paper slice that mocks those two views.
- The select-mode toolbar has no mock. It keeps its current bottom-docked shape and its Paper-primitive buttons; only its border is upgraded hairline → ink to match the panel vocabulary.
- Horizontal scroll affordance on a lane wider than the phone (no fade, no arrows) — the mock shows a bare `overflow-x: auto`.
