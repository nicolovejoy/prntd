# Studio lane overflow menu — keyboard, focus, flip-up, tab-strip gap — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Studio lane's ⋯ overflow menu keep the WAI-ARIA menu-button promise its `role="menu"` already makes (focus enters on open, arrow keys move, Escape returns focus to the trigger), stop the last lane's panel opening below the fold, and settle who owns the gap under the Studio tab strip.

**Architecture:** Presentation + accessibility only, all inside `LaneMenu` (`src/app/studio/studio-client.tsx:781–828`) plus a one-line padding edit in each of the three Studio views. `LaneMenu` keeps its `children`-as-`role="menuitem"`-buttons API: the items stay declared in `Lane`, and `LaneMenu` learns to (1) clone them to carry a roving `tabIndex`, (2) drive focus through them from a panel-level `onKeyDown`, and (3) flip itself above the trigger when it would overflow the viewport. Nothing else in `studio-client.tsx` is touched — polling, optimistic lanes, cancel, select mode and bulk delete stay byte-identical.

**Tech Stack:** Next.js 16 App Router (client component), React 19, Tailwind v4 with the Paper tokens in `src/app/globals.css`, Vitest + Testing Library (jsdom).

**Spec:** the controller brief reproduced verbatim below, which is itself drawn from `docs/superpowers/ledgers/2026-09-07-paper-studio-bench-progress.md` (the two Task-3 "minor (deferred)" lines ~205–210 and the M7 deferral ~272) and `CLAUDE.md`'s "Deferred from the batch" list. Paper tokens and rules: `docs/design-system.md` Part 1 (persona C, "The Clean Label"), `src/app/globals.css`.

## Global Constraints

- Work only inside the worktree `/Users/nico/src/prntd/.claude/worktrees/studio-lane-menu` on branch `feat/studio-lane-menu`. Never touch the main checkout or a sibling worktree. Use absolute paths.
- **File fence — the files you may change:** anything under `src/app/studio/` (including `src/app/studio/__tests__/`), `src/components/studio-tabs.tsx` **only if Task 3 turns out to need it**, and `docs/superpowers/`. **Nothing else.** Two sibling slices are editing `src/components/product-options.tsx`, `src/app/orders/**`, `src/app/admin/published/**`, `docs/design-system.md`, `src/app/error.tsx`, `src/app/d/[imageId]/**` and `src/lib/action-copy.ts` in parallel right now; any edit there collides. `src/components/ui/*`, `src/app/globals.css` and `src/lib/**` are frozen.
- **Inside `src/app/studio/studio-client.tsx`, only the `LaneMenu` component (lines 781–828) and the one `<main>`/composer padding string named in Task 3 may change.** Polling (`pollOnce`, `pollNonce`, the wake/visibility effects, `MOUNT_RECONCILE_DELAY_MS`), optimistic-lane state (`optimistic`, `applyOptimistic`, `settleOptimistic`, `restoreOptimistic`), cancel, select mode, bulk delete, the anchor model and the `Lane` cell rendering must stay byte-identical. If a step seems to require touching them, STOP and report.
- **This is NOT the Next.js you know** (`AGENTS.md`). Do not invent App Router or React API from memory; copy call shapes from working code already in this repo.
- **Paper rules** (decided by Nico; do not re-litigate). Light only. Tokens: ground `--background`, ink `--foreground`, `--text-muted`, `--text-faint`, hairline `--border`, `--border-hover`, `--surface`, `--surface-well`, `--accent-rose`. Tailwind: `bg-background`, `text-foreground`, `border-border`, `text-text-muted`, `text-text-faint`, `bg-surface`, `bg-surface-well`, `font-mono`.
  - 1px ink/hairline borders. **No shadows.** No dark literals anywhere (`bg-black`, `text-white`, `bg-gray-*`, `bg-foreground/70`, hex darks) — a guard test forbids some of them already.
  - `--accent-rose` is used ONLY on the wordmark and the Studio-composer/landing Generate. **Never in this menu.**
  - Mono label class, used verbatim everywhere this plan says "mono label":
    `font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted`
  - Body 14px (`text-sm`). Titles 14px/500 (`text-sm font-medium`). Links underlined: `underline underline-offset-[3px]`.
  - ONE primary action per screen: `Button` default `variant="primary"` (outlined ink). Everything else is `variant="secondary"`, `variant="ghost"`, or plain underlined text.
  - `disabled` already renders as a dotted border + muted text in the primitive. Do not add opacity hacks.
  - 44px minimum tap targets on phone (`min-h-11` / `w-11 h-11`). Check every layout at 390px.
  - AA contrast holds. `--text-faint` (#6f6d6a, 4.74:1 on the ground) is fine on `--background` and on `--surface-well`; do not put it on a coloured storefront backdrop.
- Copy is persona C: plain, literal, no marketing sentence, no exclamation mark, no whimsy. **This slice adds no new user-visible copy at all** — "Close", "Delete", "Select" and the `aria-label="More"` are unchanged. If you find yourself writing a new string, STOP and report.
- **No price** may appear in this plan, in code, or in a test. `src/lib/__tests__/no-preselection-price.test.ts` fails CI on any `From $` string or catalog-floor helper in product code.
- Lint policy (`CLAUDE.md` → Tooling & CI): `@typescript-eslint/no-explicit-any` is an **error** in product code, off in tests. `catch (err)` unannotated, narrowed with `err instanceof Error ? err.message : String(err)`.
- Migration-free. If any step appears to need a schema change, STOP and report.
- Path alias `@` maps to `src/`. Single test file: `npx vitest run src/app/studio/__tests__/studio-client.test.tsx`. Whole suite: `npm test`. **Do not run Playwright/e2e.**
- Every commit message ends with exactly these two trailer lines:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_018gyyDkawjSPfsD7s4QeSsN
  ```

## Spec, verbatim (controller brief)

> **a. LaneMenu keyboard + focus management.** `LaneMenu` lives in `src/app/studio/studio-client.tsx`. Today: focus does not enter the panel on open, does not return to the ⋯ trigger on close, and `role="menu"`/`role="menuitem"` promise WAI-ARIA menu behaviour (arrow keys, roving tabindex, Home/End) that is not implemented. Decide ONE of: implement the menu pattern properly (focus first item on open, Arrow Up/Down wrap, Home/End, Escape closes and returns focus to the trigger, Tab closes) OR drop the menu roles for a plain disclosure (`aria-expanded` on the trigger, buttons in Tab order, Escape closes + restores focus). Ruling recommended: implement the real menu pattern — three items is small, and the existing Escape/outside-click logic already exists. Record the ruling.
>
> **b. Flip-up when low.** The last lane's ⋯ panel opens below the fold. Measure on open with `getBoundingClientRect` and flip the panel above the trigger when there is not enough room below (`window.innerHeight`). Test with jsdom by stubbing `innerHeight` and `getBoundingClientRect`.
>
> **c. Studio tab strip top padding.** CLAUDE.md notes "~32px extra top padding under the Studio tab strip (eyeball on phone)". `src/app/studio/layout.tsx` wraps pages with `pt-6`; check what `studio-client.tsx` (bench), `library/`, and `archive/` pages ALSO add at their top. If a page adds its own top padding/margin on top of the layout's, remove the duplicate so exactly one source owns the gap; if there is no duplicate, record a ruling that the note was wrong and change nothing.
>
> Polling, optimistic-lane, cancel, select-mode and bulk-delete logic in `studio-client.tsx` must stay byte-identical outside the LaneMenu component and the padding edit.

---

## Controller rulings (binding — these resolve the spec's ambiguities)

### R1. Implement the real WAI-ARIA menu pattern; keep `role="menu"`/`role="menuitem"`

The brief's recommended ruling is taken. Three items, one panel, and the Escape + outside-click machinery already exists — the gap is focus, not architecture. Dropping to a disclosure would mean editing all three `role="menuitem"` attributes in `Lane` plus the `aria-haspopup="menu"` on the trigger, i.e. more churn in the file this slice is under orders to leave otherwise byte-identical, and it would leave a screen-reader user Tab-ing through three buttons that the trigger's own `aria-expanded` is the only cue for.

Cost if wrong: a keyboard user gets arrow keys where they expected Tab. Both patterns are conformant; only one of them is already half-declared in the markup.

### R2. `LaneMenu` keeps its `children` API — items stay declared in `Lane`

The alternative (an `items: {label, onSelect, testId}[]` prop) would move three `data-testid`s and three class strings out of `Lane`, touching code this slice must not disturb, and would fix the item shape at exactly the moment a fourth item type is plausible. `LaneMenu` instead reads its items from the DOM (`panelRef.current.querySelectorAll('[role="menuitem"]')`) for focus, and clones them with `React.Children.map` only to inject a roving `tabIndex`.

Cost if wrong: an item added later without `role="menuitem"` is skipped by the arrow keys. Mitigated by a comment on the `MENUITEM_SELECTOR` constant saying exactly that.

### R3. Focus returns to the trigger on **Escape only** — not on outside click, not on Tab, not on activation

Escape is the one close that means "put me back where I was", and it is the one WAI-ARIA names. Outside click already moved the user's focus/pointer somewhere deliberate; yanking it back to a ⋯ button would be focus theft. Tab is a deliberate move onward. And on **activation** the trigger usually does not survive: Close and Delete remove the lane, and Select enters select mode, which hides every ⋯ trigger on the page (see the ledger's "select mode is unreachable while your only lane is generating" ruling) — so a restore would either throw or focus a detached node.

Implementation consequence: the restore lives in the Escape branch, guarded by `triggerRef.current?.isConnected`, never in a generic "on close" effect.

Cost if wrong: after clicking outside, the keyboard user's next Tab starts from the body rather than from the ⋯ button.

### R4. Tab closes the menu but does not preventDefault

The browser's own Tab handling then moves focus to the next tabbable element after the panel in DOM order — which, with every item at `tabIndex={-1}` except the active one, and the panel unmounting in the same tick, is the natural next control. Calling `preventDefault` here would trap focus in a menu that is disappearing.

Cost if wrong: Tab lands one control earlier or later than a purist would draw it.

### R5. The flip is measured after the panel renders, in `useLayoutEffect`, from real rects — no hard-coded panel height

Open renders the panel at its default `top-full`; a layout effect (before paint, so no visible jump) then measures the trigger's rect and the panel's own rect and sets `dropUp` when `trigger.bottom + panel.height > window.innerHeight`. No margin constant, no estimated height: the panel is three 44px rows and will change.

`dropUp` resets to `false` every time the menu opens, so a menu that flipped once does not stay flipped after the page scrolls.

Cost if wrong: on a viewport where the panel exactly grazes the fold it opens upward one pixel early.

### R6. Task 3 (tab-strip gap): there is no duplicate; the three views disagree, and they are unified at 24px

Verified by reading all four files. `src/app/studio/layout.tsx` contributes `pt-6` **above the `<h1>Studio</h1>`**, then the strip, and then renders `{children}` directly — it contributes **nothing below the strip**. Each view owns its own top gap and they disagree:

- bench (`studio-client.tsx`): `<main>` has no top padding; the composer sits in an inner `div.py-6` → **24px**
- `library/page.tsx`: `<main className="… py-8 …">` → **32px**
- `archive/page.tsx`: `<main className="… py-8 …">` → **32px**

So Nico's "~32px extra top padding under the Studio tab strip" is real on Library and Archive (32px is exactly `py-8`) and is not a duplicate — it is two of three views being 8px looser than the bench. The fix is to unify on the bench's 24px rather than to delete anything: `py-8` → `pt-6 pb-8` on both pages, preserving their bottom padding. The layout stays as it is, and `studio-tabs.tsx` is not touched (so the fence's conditional file stays unused).

Cost if wrong: the gap is still 24px too tall for Nico's eye on all three views and he asks for one more number. Nothing else in the page moves.

### R7. No `useId`, no focus trap, no portal

The panel is a sibling of its trigger inside `div.relative`, and it is not modal — WAI-ARIA's menu button does not trap focus, and moving the panel to a portal would break `ref.current?.contains(e.target)`, the outside-click test the existing behaviour depends on.

Cost if wrong: nil; this is a statement of what is deliberately absent.

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `src/app/studio/studio-client.tsx` | Studio bench client. **Only** the `LaneMenu` function (currently lines 781–828) changes, in Tasks 1 and 2. | Modify |
| `src/app/studio/__tests__/studio-client.test.tsx` | Existing render/interaction suite; owns the mocks and the `lane()`/`cell()`/`pendingJob()` helpers. Gains one new `describe` block per task. | Modify |
| `src/app/studio/library/page.tsx` | Library view. One class string. | Modify (Task 3) |
| `src/app/studio/archive/page.tsx` | Archive view. One class string. | Modify (Task 3) |
| `src/app/studio/layout.tsx` | Studio frame. **Unchanged** — R6. | — |
| `src/components/studio-tabs.tsx` | Tab strip. **Unchanged** — R6. | — |

New tests go in the existing `studio-client.test.tsx` rather than a new file: `LaneMenu` is not exported, every existing test drives it through `StudioClient`, and the mocks (`../actions`, `@/app/design/actions`, `@/app/designs/actions`) plus the `lane()`/`cell()`/`pendingJob()` factories all live there. A new file would duplicate ~50 lines of mock setup to test a private component.

---

## Task 1: LaneMenu keyboard + focus management

**Files:**
- Modify: `src/app/studio/studio-client.tsx:781-828` (the `LaneMenu` function only)
- Test: `src/app/studio/__tests__/studio-client.test.tsx` (append a new `describe` block)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `LaneMenu` keeps its exact existing signature `function LaneMenu({ children }: { children: React.ReactNode })`. Task 2 adds a `dropUp` state to the same function and relies on these names existing after this task: `open`, `setOpen`, `ref` (the outer `div`), `triggerRef` (the ⋯ `button`), `panelRef` (the `role="menu"` `div`), `MENUITEM_SELECTOR`, `menuItems()`.

- [ ] **Step 1: Write the failing tests**

Append this `describe` block to the very end of `src/app/studio/__tests__/studio-client.test.tsx`. It uses the file's existing `lane()`, `cell()` and `pendingJob()` helpers and the already-imported `render, screen, fireEvent, within` from Testing Library — do not re-import them.

```tsx
describe("lane overflow menu keyboard + focus (WAI-ARIA menu button)", () => {
  function openMenu() {
    render(
      <StudioClient
        initialLanes={[lane({ cells: [cell("a"), cell("b")] })]}
      />
    );
    const trigger = screen.getByRole("button", { name: "More" });
    fireEvent.click(trigger);
    return { trigger, panel: screen.getByRole("menu") };
  }

  it("moves focus to the first item when the menu opens", () => {
    openMenu();
    expect(document.activeElement).toBe(screen.getByTestId("studio-close-lane"));
  });

  it("gives the focused item the only tabIndex of 0", () => {
    openMenu();
    expect(screen.getByTestId("studio-close-lane").getAttribute("tabindex")).toBe("0");
    expect(screen.getByTestId("studio-delete-lane").getAttribute("tabindex")).toBe("-1");
    expect(screen.getByTestId("select-mode").getAttribute("tabindex")).toBe("-1");
  });

  it("ArrowDown walks the items and wraps to the first", () => {
    const { panel } = openMenu();
    fireEvent.keyDown(panel, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByTestId("studio-delete-lane"));
    fireEvent.keyDown(panel, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByTestId("select-mode"));
    fireEvent.keyDown(panel, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByTestId("studio-close-lane"));
  });

  it("ArrowUp from the first item wraps to the last", () => {
    const { panel } = openMenu();
    fireEvent.keyDown(panel, { key: "ArrowUp" });
    expect(document.activeElement).toBe(screen.getByTestId("select-mode"));
  });

  it("Home and End jump to the first and last item", () => {
    const { panel } = openMenu();
    fireEvent.keyDown(panel, { key: "End" });
    expect(document.activeElement).toBe(screen.getByTestId("select-mode"));
    fireEvent.keyDown(panel, { key: "Home" });
    expect(document.activeElement).toBe(screen.getByTestId("studio-close-lane"));
  });

  it("Escape closes the menu and returns focus to the trigger", () => {
    const { trigger } = openMenu();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("Tab closes the menu without stealing focus back to the trigger", () => {
    const { panel, trigger } = openMenu();
    fireEvent.keyDown(panel, { key: "Tab" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).not.toBe(trigger);
  });

  it("an outside click closes the menu without pulling focus back to the trigger", () => {
    const { trigger } = openMenu();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).not.toBe(trigger);
  });

  it("still closes on Escape when a second lane's menu is the open one", () => {
    render(
      <StudioClient
        initialLanes={[
          lane({ designId: "design-1", cells: [cell("a")] }),
          lane({ designId: "design-2", title: "second", cells: [cell("c")] }),
        ]}
      />
    );
    const triggers = screen.getAllByRole("button", { name: "More" });
    fireEvent.click(triggers[1]);
    expect(document.activeElement).toBe(screen.getByTestId("studio-close-lane"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(triggers[1]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/studio/__tests__/studio-client.test.tsx -t "WAI-ARIA menu button"`
Expected: FAIL. The first test fails on `document.activeElement` being `<body>` (or the trigger), the tabIndex test fails because no `tabindex` attribute exists, the arrow tests fail because nothing moves focus, and the Escape test fails on focus not returning.

- [ ] **Step 3: Replace the `LaneMenu` function**

Replace the whole of `LaneMenu` (`src/app/studio/studio-client.tsx`, currently lines 781–828) with exactly this. Nothing above line 781 and nothing below line 828 changes.

```tsx
/** Items are found in the DOM rather than passed as data, so `Lane` keeps
 * owning their labels, handlers and test ids. An item added without this
 * role is invisible to the arrow keys — that is the contract. */
const MENUITEM_SELECTOR = '[role="menuitem"]';

/**
 * The lane's ⋯ overflow: a WAI-ARIA menu button, not a disclosure. The
 * markup already declared `aria-haspopup="menu"` / `role="menu"` /
 * `role="menuitem"`, which promises arrow-key navigation and roving
 * tabindex; this implements that promise rather than retracting it.
 *
 * Focus returns to the trigger on Escape ONLY. An outside click has already
 * put the user's attention somewhere deliberate, Tab is a deliberate move
 * onward, and on activation the trigger usually does not survive — Close and
 * Delete remove the lane, and Select hides every ⋯ on the page — so a
 * generic on-close restore would focus a detached node.
 */
function LaneMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const menuItems = useCallback(
    () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(MENUITEM_SELECTOR) ?? []
      ),
    []
  );

  const focusItem = useCallback(
    (index: number) => {
      const items = menuItems();
      if (items.length === 0) return;
      const next = ((index % items.length) + items.length) % items.length;
      setActiveIndex(next);
      items[next]?.focus();
    },
    [menuItems]
  );

  // Focus enters the panel on open. Layout effect, so it lands before paint
  // and a screen reader announces the item rather than the button again.
  useLayoutEffect(() => {
    if (!open) return;
    setActiveIndex(0);
    menuItems()[0]?.focus();
  }, [open, menuItems]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpen(false);
      // isConnected: Escape can race a poll that removed this lane.
      if (triggerRef.current?.isConnected) triggerRef.current.focus();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function onPanelKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusItem(activeIndex + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusItem(activeIndex - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusItem(0);
    } else if (e.key === "End") {
      e.preventDefault();
      focusItem(menuItems().length - 1);
    } else if (e.key === "Tab") {
      // No preventDefault (ruling R4): the browser moves focus onward and
      // the panel unmounts in the same tick.
      setOpen(false);
    }
  }

  // Roving tabindex: exactly one item is in the Tab order at a time.
  const items = Children.map(children, (child, index) =>
    isValidElement<{ tabIndex?: number }>(child)
      ? cloneElement(child, { tabIndex: index === activeIndex ? 0 : -1 })
      : child
  );

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        ref={triggerRef}
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
          ref={panelRef}
          role="menu"
          onClick={() => setOpen(false)}
          onKeyDown={onPanelKeyDown}
          className="absolute right-0 top-full z-10 min-w-[9rem] bg-surface border border-foreground flex flex-col"
        >
          {items}
        </div>
      )}
    </div>
  );
}
```

Then extend line 5 of `src/app/studio/studio-client.tsx`, which currently reads

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
```

to

```tsx
import {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
```

Do **not** add a default or namespace `React` import. The file has none today and still writes `React.ReactNode` and `React.KeyboardEvent<HTMLDivElement>` — those are type positions, where the UMD global is legal; `Children` / `cloneElement` / `isValidElement` are values, where it is not, which is why they come in as named imports.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/studio/__tests__/studio-client.test.tsx`
Expected: PASS, whole file — the ~9 new tests **and** every pre-existing test in the file, including "closes the overflow on Escape", "holds Close, Delete and Select behind the overflow control", and every select-mode/bulk-delete test that clicks `More` then `select-mode`.

Then run: `npm run lint && npm run typecheck`
Expected: lint 0 errors (pre-existing warnings are fine), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/studio/studio-client.tsx src/app/studio/__tests__/studio-client.test.tsx
git commit -m "$(cat <<'EOF'
Studio lane menu: implement the WAI-ARIA menu pattern it already declared

Focus enters the panel on open, Arrow Up/Down wrap, Home/End jump, roving
tabindex keeps one item in the Tab order, and Escape closes and returns
focus to the trigger. Outside click and Tab close without pulling focus
back — the trigger often does not survive an activation.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018gyyDkawjSPfsD7s4QeSsN
EOF
)"
```

---

## Task 2: Flip the overflow panel up when it would open below the fold

**Files:**
- Modify: `src/app/studio/studio-client.tsx` (the `LaneMenu` function only, as left by Task 1)
- Test: `src/app/studio/__tests__/studio-client.test.tsx` (append a second new `describe` block)

**Interfaces:**
- Consumes: Task 1's `LaneMenu` internals — `open`, `triggerRef`, `panelRef`, and the panel's `className` string `"absolute right-0 top-full z-10 min-w-[9rem] bg-surface border border-foreground flex flex-col"`.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing tests**

Append this `describe` block to the end of `src/app/studio/__tests__/studio-client.test.tsx` (after Task 1's block). The stub keys off `role` so the trigger and the panel get different rects — that is what makes the assertion mean something.

```tsx
describe("lane overflow menu placement (flip-up near the fold)", () => {
  const realInnerHeight = window.innerHeight;
  const realRect = window.HTMLElement.prototype.getBoundingClientRect;

  function stubGeometry({ triggerBottom }: { triggerBottom: number }) {
    window.HTMLElement.prototype.getBoundingClientRect = function (
      this: HTMLElement
    ) {
      const menu = this.getAttribute("role") === "menu";
      const height = menu ? 132 : 44;
      const bottom = menu ? triggerBottom + height : triggerBottom;
      return {
        x: 0,
        y: bottom - height,
        top: bottom - height,
        left: 0,
        right: 144,
        bottom,
        width: 144,
        height,
        toJSON: () => ({}),
      } as DOMRect;
    };
  }

  afterEach(() => {
    window.HTMLElement.prototype.getBoundingClientRect = realRect;
    Object.defineProperty(window, "innerHeight", {
      value: realInnerHeight,
      configurable: true,
      writable: true,
    });
  });

  function renderAndOpen() {
    render(<StudioClient initialLanes={[lane({ cells: [cell("a")] })]} />);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    return screen.getByRole("menu");
  }

  it("opens below the trigger when there is room", () => {
    Object.defineProperty(window, "innerHeight", {
      value: 800,
      configurable: true,
      writable: true,
    });
    stubGeometry({ triggerBottom: 200 });
    const panel = renderAndOpen();
    expect(panel.className).toContain("top-full");
    expect(panel.className).not.toContain("bottom-full");
  });

  it("flips above the trigger when the panel would fall below the fold", () => {
    Object.defineProperty(window, "innerHeight", {
      value: 800,
      configurable: true,
      writable: true,
    });
    stubGeometry({ triggerBottom: 760 });
    const panel = renderAndOpen();
    expect(panel.className).toContain("bottom-full");
    expect(panel.className).not.toContain("top-full");
  });

  it("re-measures on each open rather than staying flipped", () => {
    Object.defineProperty(window, "innerHeight", {
      value: 800,
      configurable: true,
      writable: true,
    });
    stubGeometry({ triggerBottom: 760 });
    const trigger = (() => {
      render(<StudioClient initialLanes={[lane({ cells: [cell("a")] })]} />);
      return screen.getByRole("button", { name: "More" });
    })();
    fireEvent.click(trigger);
    expect(screen.getByRole("menu").className).toContain("bottom-full");
    fireEvent.click(trigger);
    stubGeometry({ triggerBottom: 100 });
    fireEvent.click(trigger);
    expect(screen.getByRole("menu").className).toContain("top-full");
  });
});
```

Add `afterEach` to the Testing-Library/vitest import line at the top of the file if it is not already imported (the file currently imports `describe, it, expect, vi, beforeEach` from `vitest` — extend that list).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/studio/__tests__/studio-client.test.tsx -t "flip-up near the fold"`
Expected: FAIL — the flip test finds `top-full` and no `bottom-full`, because the panel is unconditionally `top-full` today.

- [ ] **Step 3: Add the measurement**

Inside `LaneMenu`, add the state next to the others:

```tsx
  const [dropUp, setDropUp] = useState(false);
```

Add this layout effect immediately after the open-focus layout effect from Task 1:

```tsx
  // The last lane sits at the bottom of a scrolling page, where a panel
  // anchored to `top-full` opens below the fold. Measured from real rects
  // after the panel renders — no estimated height, because the panel is
  // three rows today and may not be tomorrow. Re-run on every open so a
  // menu that flipped once does not stay flipped after a scroll.
  useLayoutEffect(() => {
    if (!open) {
      setDropUp(false);
      return;
    }
    const trigger = triggerRef.current?.getBoundingClientRect();
    const panel = panelRef.current?.getBoundingClientRect();
    if (!trigger || !panel) return;
    setDropUp(trigger.bottom + panel.height > window.innerHeight);
  }, [open]);
```

And make the panel's vertical anchor conditional — this is the only change to the panel element:

```tsx
          className={`absolute right-0 ${
            dropUp ? "bottom-full" : "top-full"
          } z-10 min-w-[9rem] bg-surface border border-foreground flex flex-col`}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/studio/__tests__/studio-client.test.tsx`
Expected: PASS, whole file. Task 1's focus tests must still pass — the panel now renders twice on open (once at `top-full`, once flipped) and the focus effect must not re-fire or move focus on the second pass. If a Task 1 test regresses, that is a real defect: report it rather than loosening the test.

Then run: `npm run lint && npm run typecheck`
Expected: lint 0 errors, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/studio/studio-client.tsx src/app/studio/__tests__/studio-client.test.tsx
git commit -m "$(cat <<'EOF'
Studio lane menu: flip the overflow panel up when it would open below the fold

Measured after render from the trigger's and the panel's own rects against
window.innerHeight, re-measured on every open so a flip does not persist
across a scroll.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018gyyDkawjSPfsD7s4QeSsN
EOF
)"
```

---

## Task 3: Unify the gap under the Studio tab strip at 24px

**Files:**
- Modify: `src/app/studio/library/page.tsx` (the `<main>` className)
- Modify: `src/app/studio/archive/page.tsx` (the `<main>` className)
- Not modified: `src/app/studio/layout.tsx`, `src/components/studio-tabs.tsx`, `src/app/studio/studio-client.tsx` — see ruling R6.
- Test: `src/app/studio/__tests__/studio-client.test.tsx` — **no test.** These are two server components with no branch; asserting a Tailwind class string in a test would pin a number the next design pass is entitled to change, and there is no behaviour to protect. Recorded here so the reviewer knows it was a decision, not an omission.

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Verify the diagnosis before changing anything**

Run:

```bash
grep -n 'className' /Users/nico/src/prntd/.claude/worktrees/studio-lane-menu/src/app/studio/layout.tsx
grep -n '<main' -A 1 /Users/nico/src/prntd/.claude/worktrees/studio-lane-menu/src/app/studio/library/page.tsx
grep -n '<main' -A 1 /Users/nico/src/prntd/.claude/worktrees/studio-lane-menu/src/app/studio/archive/page.tsx
grep -n 'flex-1 px-4' -A 12 /Users/nico/src/prntd/.claude/worktrees/studio-lane-menu/src/app/studio/studio-client.tsx
```

Expected, and required before you proceed: the layout's `pt-6` is on the block **containing** the `<h1>` and `<StudioTabs />`, and `{children}` is rendered as a direct sibling with no wrapper; `library` and `archive` each carry `py-8` on their `<main>`; the bench's `<main>` has `px-4 sm:px-6` and a `pb-*` but **no** top padding, with an inner `div.py-6` around the composer. If any of that does not hold, STOP and report — ruling R6 is built on it.

- [ ] **Step 2: Make the two edits**

In `src/app/studio/library/page.tsx`, change the `<main>` class from

```
"px-4 sm:px-6 py-8 max-w-4xl mx-auto w-full"
```

to

```
"px-4 sm:px-6 pt-6 pb-8 max-w-4xl mx-auto w-full"
```

In `src/app/studio/archive/page.tsx`, make the identical change to its `<main>` class.

Add this comment directly above the `<main>` in **each** file:

```tsx
      {/* 24px under the tab strip, the same gap the bench's composer sits
          behind. The layout contributes nothing below the strip, so each
          view owns this number; they used to disagree (24 / 32 / 32). */}
```

- [ ] **Step 3: Verify nothing else moved**

Run: `git diff --stat`
Expected: exactly two files changed, a handful of lines each. If `layout.tsx`, `studio-tabs.tsx` or `studio-client.tsx` appear in this diff, revert them.

Run: `npm run lint && npm run typecheck && npx vitest run src/app/studio`
Expected: lint 0 errors, typecheck clean, all Studio tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/app/studio/library/page.tsx src/app/studio/archive/page.tsx
git commit -m "$(cat <<'EOF'
Studio: one gap under the tab strip, 24px on all three views

The layout contributes nothing below the strip, so each view owned its own
top gap and they disagreed — the bench 24px, Library and Archive 32px.
Unified on the bench's 24px; bottom padding unchanged.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018gyyDkawjSPfsD7s4QeSsN
EOF
)"
```

---

## Self-review (run by the plan author)

**Spec coverage.** (a) keyboard + focus → Task 1, ruling R1–R4. (b) flip-up → Task 2, ruling R5. (c) tab-strip padding → Task 3, ruling R6. The "byte-identical outside LaneMenu and the padding edit" constraint is in Global Constraints and re-checked by Task 3 Step 3's `git diff --stat`.

**Placeholders.** None: every code step carries the literal code, every test step carries the literal test, every run step carries the literal command and its expected result.

**Type consistency.** `triggerRef`/`panelRef`/`menuItems()`/`focusItem()`/`activeIndex` are introduced in Task 1 and used under the same names in Task 2; `dropUp` is Task 2's alone. `MENUITEM_SELECTOR` is module-scoped, declared once, above `LaneMenu`.
