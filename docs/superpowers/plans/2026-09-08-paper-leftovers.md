# Paper leftovers (#188) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear the four Paper-look leftovers the 2026-09-07 batch deferred: mono section labels in the shared size/colour pickers, an `ORDERS` mono masthead on `/orders`, a square hairline card on `/admin/published`, and a truthful `docs/design-system.md`.

**Architecture:** Presentation and documentation only. No server action, no guard, no data shape, no pricing math, no route changes. Three small class-string edits in three files, then a line-by-line correction pass over `docs/design-system.md` — every claim verified against code on this branch, not against `CLAUDE.md`.

**Tech Stack:** Next.js 16 App Router (server components + client islands), React 19, Tailwind v4 with the Paper tokens in `src/app/globals.css`, Vitest + Testing Library.

**Spec:** The controller brief reproduced verbatim below (§"Spec, verbatim"). Design authority: `docs/ux-design-review-2026-09.md` (Nico's answers), `docs/design-system.md` Part 1 (persona C, "The Clean Label"), `src/app/globals.css` (Paper tokens). Prior slice for shape and rulings: `docs/superpowers/plans/2026-09-07-paper-image-detail.md` (its **R7** explicitly defers task 1 of this plan to "a slice that legitimately owns `src/components/product-options.tsx`" — this is that slice).

## Global Constraints

- Work only inside the worktree `/Users/nico/src/prntd/.claude/worktrees/paper-leftovers` on branch `feat/paper-leftovers`. Never touch the main checkout or a sibling worktree. Use absolute paths.
- **File fence — the files you may change:**
  - `src/components/product-options.tsx` and `src/components/__tests__/product-options.test.tsx`
  - anything under `src/app/orders/` (including `__tests__/`)
  - anything under `src/app/admin/published/`
  - `docs/design-system.md`
  - anything under `docs/superpowers/`

  **Nothing else.** In particular: `src/components/ui/*` is frozen, `src/app/globals.css` is frozen, `src/lib/**` is frozen, `src/app/d/**`, `src/app/preview/**`, `src/app/studio/**`, `src/app/admin/page.tsx`, `src/app/admin/orders/**`, `src/app/shop/**`, `src/app/dashboard/**` are frozen. Two sibling slices are editing `src/app/studio/**`, `src/app/error.tsx` and `src/app/d/[imageId]/**` in parallel worktrees right now; a shared-file edit collides at merge. **If a task appears to need a change outside the fence, do not make it — record it in the ledger as deferred and continue.**
- **This is NOT the Next.js you know** (`AGENTS.md`). Do not invent App Router API from memory; copy call shapes from working code already in this repo. Consult `node_modules/next/dist/docs/` for anything you would otherwise guess.
- **Paper rules** (decided by Nico; do not re-litigate). Light only. Tokens: ground `--background`, ink `--foreground`, `--text-muted`, `--text-faint`, hairline `--border`, `--border-hover`, `--surface`, `--surface-well`, `--accent-rose`. Tailwind: `bg-background`, `text-foreground`, `border-border`, `text-text-muted`, `text-text-faint`, `bg-surface`, `bg-surface-well`, `font-mono`.
  - 1px ink/hairline borders. **No shadows.** No dark literals anywhere (`bg-black`, `text-white`, `bg-gray-*`, `bg-foreground/70`, hex darks) — a guard test forbids some of them already (`src/app/__tests__/globals-css.test.ts`, `src/app/__tests__/dark-literals.test.ts` if present).
  - `--accent-rose` is used ONLY on the wordmark and the Studio-composer/landing Generate. **Never on any file this plan touches.**
  - **Mono label class, used verbatim everywhere this plan says "the mono label class":**
    `font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted`
  - Body 14px (`text-sm`). Titles 14px/500 (`text-sm font-medium`). Links underlined: `underline underline-offset-[3px]`.
  - ONE primary action per screen: `Button` default `variant="primary"` (outlined ink). Everything else is `variant="secondary"`, `variant="ghost"`, or plain underlined text.
  - `disabled` already renders as a dotted border + muted text in the primitive. Do not add opacity hacks.
  - 44px minimum tap targets on phone (`min-h-11` / `w-11 h-11`). Check every layout at 390px.
  - AA contrast holds. `--text-faint` (#6f6d6a, 4.74:1 on the ground) is fine on `--background` and on `--surface-well`; do not put it on a coloured storefront backdrop.
- **No price ever.** No price, and no "From $X" string, may appear in this plan, in code, in a comment, in a doc line or in a UI string unless the buyer has already picked garment AND size. `src/lib/__tests__/no-preselection-price.test.ts` fails CI on any `From $` string or catalog-floor helper reference in product code, comments included. The `docs/design-system.md` Pricing rule at Part 3 (`/` Home item 6) is the statement of record and **must stay exactly as it is** — do not soften it, do not re-add a hero price line.
- Copy is persona C: plain, literal, no marketing sentence, no exclamation mark, no whimsy. Reuse existing strings; new copy is one short literal sentence and is recorded in the ledger.
- Vocabulary: call it **"the image detail page"**, never "/d" on its own (memory `feedback-image-detail-page`).
- Lint policy (`CLAUDE.md` → Tooling & CI): `@typescript-eslint/no-explicit-any` is an **error** in product code, off in tests. `catch (err)` unannotated, narrowed with `err instanceof Error ? err.message : String(err)`.
- Migration-free. If any step appears to need a schema change, STOP and report BLOCKED.
- Path alias `@` maps to `src/`. Single test file: `npx vitest run <path>`. Whole suite: `npm test`. **Do not run Playwright e2e locally.**
- Every commit message ends with exactly these two trailer lines:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_018gyyDkawjSPfsD7s4QeSsN
  ```

---

## Spec, verbatim (controller brief)

> ### Slice `paper-leftovers` (controller 2)
>
> Four small Paper-look leftovers from the 2026-09-07 batch (CLAUDE.md "Deferred from the batch"):
>
> a. `src/components/product-options.tsx` — the `Size` and `Color — {value}` labels render sans (`text-sm font-medium`) between mono labels on `/preview`, `/order` and the image detail page. Switch them to the mono label class (verbatim: `font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted`). Keep the `— {value}` suffix behaviour. This file is shared by three surfaces — read every call site (`grep -rn "SizePicker\|ColorPicker" src`) and check each still reads correctly.
> b. `/orders` page heading. `src/app/orders/orders-list.tsx` (check) still renders the pre-Paper h1 "My Orders" (or similar). Match the Shop page's mono masthead treatment (`src/app/shop/**` — read it, copy the exact classes) with the word `ORDERS`. Also `src/app/order/confirm/page.tsx` has two "View My Orders" buttons — leave the copy unless the design review says otherwise (it doesn't); record that as a ruling.
> c. `src/app/admin/published/page.tsx:57` still uses `rounded-md` on the grid cards; Paper is square, 1px hairline. Replace with the treatment the rest of `/admin` got in PR #223 (read `src/app/admin/page.tsx` / `orders/[id]` for the exact classes).
> d. `docs/design-system.md` — stale prose that still describes the pre-Paper look (dark ground, checkerboard, badge palette hues, "Fresh Prints", shadows, the hero price line — the price line MUST stay deleted). Read the doc fully, list every stale paragraph in the plan with line numbers, and rewrite each to describe what actually ships on main today (verify each claim against code, not against CLAUDE.md). Do not add new sections. Keep persona C voice.
>
> **File fence:** `src/components/product-options.tsx` (+ its test), `src/app/orders/**`, `src/app/admin/published/**`, `docs/design-system.md`, `docs/superpowers/**`. Nothing else. If (a) reveals a call site that needs a change outside the fence, record it as deferred and leave it.

---

## Controller rulings (binding — these resolve the spec's ambiguities)

### R1. `SizePicker`'s `label` prop stays a plain word; the mono casing is CSS, not content

`SizePicker` takes `label = "Size"` and `/preview` passes a computed `sizeLabel` (`src/app/preview/page.tsx:1087`). The mono label class carries `uppercase`, so `"Size"` renders as `SIZE` and any caller-supplied label renders uppercased too, for free. Do **not** change the default string to `"SIZE"` and do **not** touch any call site: the content stays sentence case, the presentation does the shouting. This is exactly how `src/app/shop/page.tsx` does its masthead (`<h1 class="… uppercase">Shop</h1>`) — one convention, two files.

Cost if wrong: a caller who passes an already-uppercased label gets the same rendered output either way, so effectively zero; the real cost of the alternative is a fence violation at `preview/page.tsx`.

### R2. `ColorPicker` keeps `Color — {value}` verbatim, including the em dash and the spaces

The brief says "keep the `— {value}` suffix behaviour". Under `uppercase` this renders `COLOR — BLACK`. That is the intended reading: the picker names the section and the current pick in one line, which is what the `/preview` and image-detail buy panels already rely on. Do not split it into a mono label plus a separate sans value row — that is a layout change, not a type change, and it is outside what the brief asked for.

Cost if wrong: colour names render uppercase where they were mixed case. They are catalogue names ("Vintage White", "Mustard"), still unambiguous uppercased.

### R3. The label `<label>` element and its `mb-2` stay; only the type classes change

Replace `block text-sm font-medium mb-2` with `block mb-2 ` + the mono label class. Keep `block` (the label must remain a block so `mb-2` separates it from the control row) and keep `mb-2` (spacing is not this slice's subject). Do not convert `<label>` to `<p>` or `<span>`; `<label>` is the correct element and the existing tests query by text.

Cost if wrong: 2px of vertical rhythm, or a needless accessibility regression from dropping `<label>`.

### R4. `/orders` gets a mono masthead reading `Orders`, matching `/shop`'s exact classes; the "New Design" button stays

`src/app/shop/page.tsx` renders:
`<h1 className="mb-8 font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted">Shop</h1>`

`/orders` copies that class string exactly, with the text `Orders` (rendering as `ORDERS` — the brief's word, produced by the same CSS as Shop's, per R1). The `mb-8` is Shop's own bottom margin; `/orders` keeps its existing `mb-6` row spacing because the masthead sits in a flex row with the "New Design" button, not above a grid — so the mono classes are copied and the margin is not.

The "New Design" button stays where it is, with its copy and its `/studio` target unchanged. PR #221's ruling stands: `/orders` sits behind `requireRealUser`, so its CTAs point at `/studio`, and `src/app/__tests__/maker-cta-hrefs.test.tsx` pins it. Do not retarget it.

Cost if wrong: a heading is 11px mono instead of 20px bold on a page four people see. Reverting is one line.

### R5. `/order/confirm`'s two "View My Orders" buttons keep their copy

The brief instructs this, and `docs/ux-design-review-2026-09.md` says nothing about the confirm page's button copy. `src/app/order/confirm/**` is also outside this slice's fence. **No change; recorded as a ruling only.** Note the resulting minor inconsistency for the ledger: the destination page is now titled `ORDERS` while the button that reaches it says "View My Orders". That is acceptable — the button names a destination in a sentence, the masthead is a section label — and a copy sweep of the confirm page belongs to whichever slice owns that file.

Cost if wrong: two button labels say "My Orders" while the page they open says "ORDERS". Cosmetic, and out of fence.

### R6. On `/admin/published`, only the **card container** loses its radius; small controls keep theirs

The prior slice's ruling R6 (`docs/superpowers/plans/2026-09-07-paper-image-detail.md`) says "Paper is not a sharp-corner rule" and froze the `rounded-md` `Button` / `rounded-lg` `Card` primitives. That ruling and this task are compatible, because `/admin` distinguishes **containers** from **controls**:

- Containers on `/admin` carry no radius: the financial summary is `border-t border-border` + `border-b border-border` rows (`src/app/admin/page.tsx:239,254`), the orders table is `border-b` / `divide-y` (`:303,335`). There is not a single rounded container on `/admin` or `/admin/orders/[id]`.
- Small controls and thumbnails keep `rounded`: the classification `<select>` (`admin/page.tsx:365`), the row thumbnail (`:411`), the order-detail thumbnail (`orders/[id]/page.tsx:283`), the status `<select>` (`:355`).

So: drop `rounded-md` from the grid card wrapper (`admin/published/page.tsx:57`) and change nothing else's radius. The `Input` and `Button` inside the card are frozen primitives and keep theirs.

Cost if wrong: four corners on a moderation card. Trivial either way; the value is that the file stops being the last rounded container in `/admin`.

### R7. The card's doubled hairline is fixed in the same edit: the inner `<Link>` becomes `border-b` only

`admin/published/page.tsx:57` wraps the card in `border …`, and the `<Link>` at `:63` immediately inside it adds `border border-border` on all four sides. Left, right and top therefore paint two adjacent 1px hairlines; only the bottom edge is doing real work as the divider between the image and the metadata panel. Under Paper — "1px borders are the only separator" — a doubled edge is a defect, and removing the radius makes the two lines sit flush and become visible. Change the `<Link>` to `border-b border-border`.

Do **not** also remove the outer `border`: it is the card's own hairline and it is what carries `border-negative` for a hidden image.

Cost if wrong: the image well loses a redundant 1px line on three sides. If it reads worse, restoring is one class.

### R8. `docs/design-system.md` is corrected in place, never restructured

The doc is a **record of decisions** (Part 1 has a `DECIDED 2026-07-19` block and preserves the rejected recommendation deliberately). Correct only claims that are false about the code on `main` today. Specifically:

- **Do not** delete or rewrite Part 1's three persona options, its "Recommendation" section, or the "Note on the hero copy" — those are the record of a decision, not descriptions of the UI.
- **Do not** delete the "Current live copy for reference (all on the landing shipped 2026-07-05)" paragraph — it is explicitly dated as historical reference.
- **Do not** add sections, headings, tables, or new gap items. Correcting a stale gap in place (adding a `~~struck~~ — RESOLVED <date>` line in the shape gaps 1 and 2 already use) is a correction, not a new section.
- **Do not** touch the Pricing rule at Part 3 `/` Home item 6, the token block, or the contrast table (all verified current).
- Every rewritten claim must be verified by opening the code. If a claim cannot be verified either way in the fence-visible code, leave it and note it in the ledger.

Cost if wrong: the one doc every future copy/design sweep is pointed at teaches the sweep to reinstate a retired look. That is exactly how "From $19.43" came back four times (`CLAUDE.md` → Conventions → Pricing) — the highest-cost item in this slice, and the reason task 4's reviewer must spot-check claims rather than trust the diff.

### R9. Stale claims about **retired but still-present** surfaces are marked retired, not deleted

`/dashboard`, `/shop/[slug]`, `/prints` and `/designs` still exist as files (`/prints` and `/designs` are 308 redirects; `/dashboard` and `/shop/[slug]` are behind `STORES_ENABLED`, which is removed from Vercel Production and Preview, per `CLAUDE.md` 2026-09-04/05 and PR #193). Their Part 3 sections stay, each gaining one line saying it is retired and what replaced it. Deleting them would lose the inventory of code that is still in the tree and still has to be dropped (composition slice 5, PR #201).

Cost if wrong: a few lines of inventory survive for code that is about to be deleted. Cheaper than an inventory that silently omits live files.

---

## File structure

Every path below is relative to the worktree root.

| File | Change | Responsibility after the change |
| --- | --- | --- |
| `src/components/product-options.tsx` | Modify | Shared `SizePicker` / `ColorPicker`. Section labels set in the mono label class; every other behaviour, prop and class unchanged. |
| `src/components/__tests__/product-options.test.tsx` | Modify | Adds two assertions pinning the mono label class on both pickers, alongside the existing behaviour tests. |
| `src/app/orders/orders-list.tsx` | Modify | `/orders` client list. `h1` becomes the mono masthead; everything else unchanged. |
| `src/app/orders/__tests__/orders-list.test.tsx` | Modify | Adds one assertion pinning the masthead text + classes. |
| `src/app/admin/published/page.tsx` | Modify | Moderation grid. Square hairline card, single hairline between image well and metadata. |
| `docs/design-system.md` | Modify | Truthful description of what ships on `main` today, in persona-C voice, same structure. |
| `docs/superpowers/plans/2026-09-08-paper-leftovers.md` | Create | This plan. |
| `docs/superpowers/ledgers/2026-09-08-paper-leftovers-progress.md` | Create (controller, at the end) | The SDD ledger, copied out of the git-ignored `.superpowers/` dir before the worktree dies. |

---

## Task 1: Mono section labels in the shared size/colour pickers

**Files:**
- Modify: `src/components/product-options.tsx` (the `<label>` at line 32 and the `<label>` at line 74)
- Modify: `src/components/__tests__/product-options.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing importable. The public props of `SizePicker` (`sizes`, `value`, `onChange`, `label`) and `ColorPicker` (`colors`, `value`, `onChange`, `note`) are **unchanged** — later tasks and every out-of-fence call site depend on that.

Context you need: this file is rendered by four call sites — `src/app/preview/page.tsx:1074,1087`, `src/app/d/[imageId]/buy-panel.tsx:324,330`, `src/app/shop/[slug]/[productId]/store-buy-panel.tsx:84,85`, `src/app/dashboard/products/compose-form.tsx:238,239`. The last two are retired surfaces behind `STORES_ENABLED` (off in Production and Preview). All four are **outside the fence** — read them, do not edit them. `/order` no longer has its own page (it 308-redirects to `/preview`, see `src/app/order/page.tsx`), so the brief's "three surfaces" are really `/preview`, the image detail page, and the two retired ones.

- [ ] **Step 1: Read the four call sites and confirm no edit is needed**

Run:
```bash
cd /Users/nico/src/prntd/.claude/worktrees/paper-leftovers
sed -n '1060,1095p' src/app/preview/page.tsx
sed -n '315,340p' 'src/app/d/[imageId]/buy-panel.tsx'
sed -n '78,90p' 'src/app/shop/[slug]/[productId]/store-buy-panel.tsx'
sed -n '232,245p' src/app/dashboard/products/compose-form.tsx
```

Expected: each call site renders the picker inside its own section; only `preview/page.tsx:1087` passes a custom `label`. Note in the ledger whether any of the four would read badly with an 11px mono uppercase label between its neighbours. If one would, that is a **deferred** item for a slice that owns the file — do not edit it.

- [ ] **Step 2: Write the failing tests**

Append to `src/components/__tests__/product-options.test.tsx`, inside the existing `describe("SizePicker", …)` block:

```tsx
  it("sets the section label in the Paper mono label type", () => {
    render(<SizePicker sizes={["S", "M"]} value={null} onChange={() => {}} />);
    const label = screen.getByText("Size");
    expect(label.className).toContain("font-mono");
    expect(label.className).toContain("text-[11px]");
    expect(label.className).toContain("tracking-[0.08em]");
    expect(label.className).toContain("uppercase");
    expect(label.className).toContain("text-text-muted");
    expect(label.className).not.toContain("text-sm");
    expect(label.className).not.toContain("font-medium");
  });

  it("keeps a caller-supplied label as given, letting CSS do the casing", () => {
    render(
      <SizePicker sizes={["S"]} value={null} onChange={() => {}} label="Size (US)" />
    );
    expect(screen.getByText("Size (US)").className).toContain("uppercase");
  });
```

And inside the existing `describe("ColorPicker", …)` block:

```tsx
  it("sets the section label in the Paper mono label type and keeps the value suffix", () => {
    render(<ColorPicker colors={COLORS} value="White" onChange={() => {}} />);
    const label = screen.getByText("Color — White");
    expect(label.className).toContain("font-mono");
    expect(label.className).toContain("text-[11px]");
    expect(label.className).toContain("tracking-[0.08em]");
    expect(label.className).toContain("uppercase");
    expect(label.className).toContain("text-text-muted");
    expect(label.className).not.toContain("font-medium");
  });
```

`COLORS` already exists in that test file (used at line 57). If its shape differs from what you need, read the file and reuse it as-is — do not redefine it.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/components/__tests__/product-options.test.tsx`
Expected: the three new tests FAIL on `expect(…).toContain("font-mono")` (received the current `block text-sm font-medium mb-2`). The pre-existing tests in the file PASS.

- [ ] **Step 4: Change the two label class strings**

In `src/components/product-options.tsx`, replace:

```tsx
      <label className="block text-sm font-medium mb-2">{label}</label>
```

with:

```tsx
      <label className="block mb-2 font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted">
        {label}
      </label>
```

and replace:

```tsx
      <label className="block text-sm font-medium mb-2">Color — {value}</label>
```

with:

```tsx
      <label className="block mb-2 font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted">
        Color — {value}
      </label>
```

Then update the file's top docblock. Its current second paragraph ends "Phone-first: 44px+ touch targets per the mobile-UX guidance." Add one sentence after it, exactly:

```
 * Section labels use the Paper mono label type (11px mono, tracked, caps) so
 * they read as peers of the mono labels their host panels set; the `uppercase`
 * is CSS, so `label` props and colour names stay sentence case in code.
```

Do not change any other class, prop, default, or the `if (colors.length <= 1) return null;` early return.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/components/__tests__/product-options.test.tsx`
Expected: PASS, all tests in the file.

- [ ] **Step 6: Verify no unrelated test read the old classes**

Run: `npx vitest run src/app/preview 'src/app/d/[imageId]' src/components`
Expected: PASS. If a test elsewhere asserted `text-sm font-medium` on these labels, it is inside the fence only if it lives in `src/components/__tests__/` — fix it there. If it lives outside the fence, STOP and report to the controller.

- [ ] **Step 7: Commit**

```bash
cd /Users/nico/src/prntd/.claude/worktrees/paper-leftovers
git add src/components/product-options.tsx src/components/__tests__/product-options.test.tsx
git commit -m "$(cat <<'EOF'
Paper: mono section labels in the shared size/colour pickers (#188)

The Size and Color — {value} labels rendered 14px sans between 11px mono
labels on /preview and the image detail page. PR #224 deferred them because
the file is shared and was outside that slice's fence (its ruling R7).

The uppercase is CSS, so call sites keep passing sentence-case labels and
colour names stay sentence case in code.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018gyyDkawjSPfsD7s4QeSsN
EOF
)"
```

---

## Task 2: `ORDERS` masthead and a square moderation card

**Files:**
- Modify: `src/app/orders/orders-list.tsx` (the `h1` at line 55)
- Modify: `src/app/orders/__tests__/orders-list.test.tsx`
- Modify: `src/app/admin/published/page.tsx` (the card wrapper at lines 55–60 and the `<Link>` at lines 61–64)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: nothing importable.

- [ ] **Step 1: Read the reference treatments**

Run:
```bash
cd /Users/nico/src/prntd/.claude/worktrees/paper-leftovers
sed -n '1,45p' src/app/shop/page.tsx
sed -n '236,260p' src/app/admin/page.tsx
```

Expected: `shop/page.tsx` has `<h1 className="mb-8 font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted">Shop</h1>`; `admin/page.tsx` has border-only, radius-free containers. These are the two treatments being copied (rulings R4 and R6).

- [ ] **Step 2: Write the failing test**

Add to `src/app/orders/__tests__/orders-list.test.tsx`. Read the file first and reuse its existing render helper and fixtures rather than writing new ones — it already renders `<OrdersList orders={…} />` with fixture orders.

```tsx
  it("renders the ORDERS masthead in the Paper mono label type", () => {
    render(<OrdersList orders={[]} />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("Orders");
    expect(heading.className).toContain("font-mono");
    expect(heading.className).toContain("text-[11px]");
    expect(heading.className).toContain("tracking-[0.08em]");
    expect(heading.className).toContain("uppercase");
    expect(heading.className).toContain("text-text-muted");
    expect(heading.className).not.toContain("font-bold");
  });
```

If the file's existing tests pass fixture orders through a local factory, call `render(<OrdersList orders={[]} />)` anyway — the heading renders in the empty state too (the empty state only replaces the list below it).

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/app/orders/__tests__/orders-list.test.tsx`
Expected: FAIL — the heading has text "My Orders" and class `text-xl sm:text-2xl font-bold`.

- [ ] **Step 4: Change the masthead**

In `src/app/orders/orders-list.tsx`, replace:

```tsx
          <h1 className="text-xl sm:text-2xl font-bold">My Orders</h1>
```

with:

```tsx
          {/* Mono masthead, same class string as /shop's (src/app/shop/page.tsx):
              a section label, not a display heading. `uppercase` does the
              casing, so the text stays sentence case in code. */}
          <h1 className="font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted">
            Orders
          </h1>
```

Do not change the wrapping `<div className="flex items-center justify-between mb-6">`, the "New Design" `<Link>`/`<Button>`, or anything below.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/app/orders/__tests__/orders-list.test.tsx`
Expected: PASS, all tests in the file.

- [ ] **Step 6: Square the moderation card**

In `src/app/admin/published/page.tsx`, replace lines 55–64:

```tsx
            <div
              key={img.imageId}
              className={`border rounded-md overflow-hidden ${
                img.isHidden ? "border-negative" : "border-border"
              }`}
            >
              <Link
                href={`/d/${img.imageId}`}
                className="relative block aspect-square bg-surface-well border border-border"
              >
```

with:

```tsx
            <div
              key={img.imageId}
              className={`border overflow-hidden ${
                img.isHidden ? "border-negative" : "border-border"
              }`}
            >
              {/* Paper: containers on /admin carry a hairline and no radius
                  (see the summary rows and orders table on /admin). The image
                  well only needs its bottom edge — a full border here doubled
                  the card's own hairline on three sides. */}
              <Link
                href={`/d/${img.imageId}`}
                className="relative block aspect-square bg-surface-well border-b border-border"
              >
```

Change nothing else in the file — not the `h1` (`/admin` and `/admin/orders/[id]` both keep `text-xl font-bold` h1s, so this page matches them already), not the `Input`, not the two `Button`s, not the forms or the server actions.

- [ ] **Step 7: Verify the whole fence still passes**

Run: `npx vitest run src/app/orders src/app/admin src/components`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
cd /Users/nico/src/prntd/.claude/worktrees/paper-leftovers
git add src/app/orders src/app/admin/published/page.tsx
git commit -m "$(cat <<'EOF'
Paper: ORDERS mono masthead, square moderation card (#188)

/orders kept the pre-Paper "My Orders" display heading; it now uses the
same mono label class string as /shop's masthead. /admin/published was the
last rounded container under /admin — radius dropped, and the image well's
four-sided border reduced to the one edge that separates it from the
metadata panel.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018gyyDkawjSPfsD7s4QeSsN
EOF
)"
```

---

## Task 3: `docs/design-system.md` Parts 1–2 — correct every stale claim

**Files:**
- Modify: `docs/design-system.md` (Parts 1 and 2 only: lines 1–508 in the pre-edit file)

**Interfaces:**
- Consumes: nothing.
- Produces: a corrected Parts 1–2. Task 4 edits Part 3 of the same file — do not touch anything at or after the `## Part 3 — Page inventory` heading.

**Method (binding).** For every numbered item below, open the code path named, read it, then write what is true. If the code says something different from what this plan predicts, **the code wins** — write what you found and record the divergence in the ledger. Ruling R8 governs what may and may not be edited.

Line numbers are against the file as it stands on this branch before any edit; they will drift as you go, so match on the quoted text, not the number.

- [ ] **Step 1: Verify the Part 2 "Direction" claims**

Read `src/app/globals.css` (the token block) and `src/components/ui/button.tsx`.

Then rewrite **line 246–251**, the paragraph beginning "PRNTD is a print shop. The interface is the shop counter: matte black, quiet, monochrome." Two claims are false: the ground is a warm off-white (`--background: oklch(0.97 0.008 80)`), not matte black; and "White is the accent; a primary action is an inversion (paper-on-ink)" is inverted — `Button`'s `primary` variant is `border border-foreground text-foreground bg-transparent`, an outlined ink button on the ground, and there is now exactly one filled accent (`--accent-rose`, the `generate` variant, scoped to the Studio composer submit and the landing hero).

Keep the paragraph's real point — the chrome claims no colour so the artwork can — and keep it to the same length. Suggested replacement, adjust to what you actually read:

```
PRNTD is a print shop. The interface is the counter: warm paper, quiet,
monochrome. The customer's artwork is the only colour on the screen — every
hue the chrome claims for itself competes with the design being made, so the
chrome claims almost none. A primary action is an outlined ink button on the
ground, not a filled one; the single filled accent is rose, and it means "the
render happens now" (wordmark and Generate only).
```

Then correct **line 252–254** ("This direction is Option A's visual half and survives unchanged under A or C. Option B amends it…"). Under Paper the visual direction is no longer "unchanged" — it was re-decided in 2026-09 (`docs/ux-design-review-2026-09.md`, variant PaperB "quieter", light only). Say that: the ink/paper principle survived, the polarity did not, and Options A/B's visual deltas are historical.

- [ ] **Step 2: Verify and correct the three principles (lines 256–267)**

- Principle 1 ends "(Current exception: status badge hues — see Gaps.)". Read `src/components/ui/badge.tsx`: the palette is neutral plus `--positive` / `--negative`, and gap 1 in this same doc is already marked RESOLVED. Replace the parenthetical with the current exceptions, which are: the status pair on badges, and `--accent-rose` on the wordmark and Generate.
- Principle 2 says "exactly one inverted (white) button" and "(Current violation: /design's composer offers Send / Draw it / Compare at equal-ish weight.)". Read `src/app/design/chat-panel.tsx` and confirm what the composer actually offers today (Compare was removed in #56; #174 made the composer one submit that generates, with chat keeping its own "Ask" tap). Rewrite: the primary is an outlined ink button (or the rose Generate on the composer), and state the current composer shape rather than the retired violation.
- Principle 3 (phone-first) — verify the parenthetical about "the Generations rail / the Sheet". `src/app/design/image-gallery.tsx`, `mobile-gallery-drawer.tsx` and `design-stage.tsx` all still exist; `design-stage.tsx` is the desktop-only stage added in #151. Correct the example if it names something that no longer exists.

- [ ] **Step 3: Verify and correct the Vocabulary block (lines 269–320)**

Check each against code. Known-suspect entries, each to be verified before you write:

- **Generation** — "(`design_image` row)". `design_image` was **dropped** (Model B slice 5, migration `0009`). Confirm with `grep -rn "designImage\|design_image" src/lib/schema.ts` (expect no table) and read `src/lib/schema.ts` for `image` / `conversationImage`. Write the real tables.
- **Print** — "(`published_at` on `design_image`.)" — same problem. Read `src/lib/schema.ts` for `listing` and the mirror `product` row (composition slices 2–4). Write what actually stores a published title/backdrop/feed rank today.
- **Studio** — "`/design`. Where designs are made." Under nav model A, Studio is `/studio` with Bench/Library/Archive tabs (`src/app/studio/`, `src/components/studio-tabs.tsx`); `/design` is a single conversation thread. Correct both this entry and any other line that equates Studio with `/design`.
- **Shop** — "Organizer stores are also shops: `/shop/[slug]`, each a self-contained storefront." Organizer storefronts are retired (`STORES_ENABLED` removed from Vercel; `src/app/dashboard/page.tsx` and `src/app/shop/[slug]/` still exist but are unreachable). Per R9, mark retired, do not delete.
- **Shelf** — "`/studio/library`, `/orders`" — verify both routes exist (they do) and that "the personal archive" is still the right gloss now that `/studio/archive` exists too.
- **Dashboard** — retired, per R9.
- **Drawing** state — "Copy is persona-dependent: A 'Drawing your design…' (current)". Read `src/app/design/chat-panel.tsx` / `src/app/studio/studio-client.tsx` for the string that actually ships. PR #79 collapsed this to a single static string. Write the shipped one.
- **Ready nudge** — "Draw it pops secondary→primary when the idea has subject + style. Never blocks." `assessReadiness` and `READINESS_SYSTEM_PROMPT` were **deleted** in #174; verify with `grep -rn "assessReadiness\|READINESS_SYSTEM_PROMPT" src` (expect nothing). Rewrite to describe what remains (readiness colours a hint, never the button) or strike the entry if nothing remains.

- [ ] **Step 4: Verify the Tokens block (lines 322–410) and change nothing that is correct**

Read `src/app/globals.css` and compare every value in the doc's four code fences and its contrast table. Per R8 the expectation is that this block is **already current** (it was written in #213). If every value matches, change nothing here and say so in the ledger. If a value has drifted, correct the doc to match the CSS — never the reverse.

- [ ] **Step 5: Verify and correct Type, Component grammar, Interaction grammar (lines 412–458)**

- "`text-3xl/5xl bold` — page hero (h1 on home, /prints)". `/prints` is a 308 to `/shop` (`src/app/prints/page.tsx`) and `/shop`'s h1 is an 11px mono masthead. Read `src/app/page.tsx` for what the home hero actually sets. Correct the role list, and add the mono label role if it is missing — the 11px mono label is now the most-used label type in the app and the doc does not name it.
- "**Badge** — pill, 11 status variants (see Gaps)." Read `src/components/ui/badge.tsx`: it is no longer a pill (no background, no radius), it is a mono uppercase text label; the variant *names* are still 1:1 with status strings but the palette is neutral + the status pair. Correct.
- "**Card** — `surface-raised` + border + rounded-lg." Read `src/components/ui/card.tsx` and write what it says.
- "**Modal** — black/90 scrim". Read `src/components/ui/modal.tsx`: the scrim is `bg-foreground/20`. Correct. (PR #207 also made the lightbox scrim opaque — mention only if `modal.tsx` shows it.)
- The five-primitive list is now wrong on count: `src/components/ui/` also holds `confirm-sheet.tsx`, `notice-sheet.tsx`, `inline-notice.tsx`, `empty-state.tsx`, `quick-reply.tsx`. `ls src/components/ui/` and write the real list with a one-line role each, in the same style. This is correcting an inventory, not adding a section.
- "Composites built from these: … `ComposeForm` (organizer product compose)." Verify each named composite still exists (`ls src/components/`); `MakerHero` does, `ComposeForm` is under the retired `/dashboard`. Mark per R9.
- Radius line: "`rounded-md` controls, `rounded-lg` cards/images, `rounded-full` chips/badges/FAB". Verify against `button.tsx` (`rounded-md`), `card.tsx` (`rounded-lg`), `badge.tsx` (no radius at all). Correct the badge/chip half, and add the container rule this slice just applied on `/admin/published` (containers on ruled surfaces carry a hairline and no radius) only if you can point at two live examples.
- Selection line: "accent ring/border (`border-accent` / `ring-accent`)". Verify these classes are still in use (`grep -rn "border-accent\|ring-accent" src`) and that `--accent` resolves to ink. Correct if not.
- Motion line: verify `animate-pulse` is still the loading motion (`grep -rn "animate-pulse" src`).

- [ ] **Step 6: Verify and correct the Gaps list (lines 460–507)**

Gaps 1 and 2 are already marked RESOLVED and are correct — leave both. For 3–7, verify each and, where resolved, strike it in the same shape gaps 1 and 2 use (`~~**Title**~~ — RESOLVED YYYY-MM-DD under <what>: <one sentence>.`). Do not renumber, do not delete, do not add a new gap.

- Gap 3 "Two empty-state implementations in the Studio (hero composer + an older in-thread variant in `chat-panel.tsx`)". Read `src/components/ui/empty-state.tsx` (its docblock claims it unified nine hand-rolled blocks, #213) and `src/app/design/chat-panel.tsx`. Resolve or restate with what is actually there.
- Gap 4 "'Selected image' is load-bearing but nearly invisible". The incident paragraph inside it is current and correct — keep it verbatim. Verify the gap's own claim (a 2px `border-accent` still decides the selection) with `grep -rn "border-accent" src` before restating.
- Gap 5 "Three composer actions at equal weight". #174 collapsed the composer to one submit that generates, with chat keeping a separate "Ask". Verify in `src/app/design/chat-panel.tsx` and `src/app/studio/studio-client.tsx`, then resolve or restate.
- Gap 6 "Accent = white means no brand color exists." False twice over: accent is ink, and `--accent-rose` exists. Rewrite as resolved, naming the One Mark rule.
- Gap 7 "Internals leak into customer copy — the Compare tooltip names generators". Compare was removed in #56. Verify (`grep -rn "Compare styles\|generator" src/app src/components`) and resolve or restate with whatever leak is actually left.

- [ ] **Step 7: Re-read your diff for the two forbidden regressions**

Run:
```bash
cd /Users/nico/src/prntd/.claude/worktrees/paper-leftovers
git diff docs/design-system.md | grep -nE '^\+.*(From \$|19\.43|minRetailPrice|Fresh Prints|matte black|checkerboard pattern)'
```
Expected: **no output**. Any hit is a regression this slice exists to prevent (a price string, a retired storefront name, or the retired dark look) — remove it. `.bg-checkerboard` may legitimately be named as a class that now resolves to the paper well; the grep above only flags the phrase "checkerboard pattern".

Then run: `npx vitest run src/lib/__tests__/no-preselection-price.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
cd /Users/nico/src/prntd/.claude/worktrees/paper-leftovers
git add docs/design-system.md
git commit -m "$(cat <<'EOF'
docs: design-system Parts 1–2 describe what actually ships (#188)

The doc still described the pre-Paper look — matte black ground, white
accent, an 11-hue badge pill, a black/90 modal scrim, five primitives, the
Compare button, design_image, Studio as /design. Every claim rechecked
against code on this branch; corrected in place. The persona record, the
dated live-copy reference, the token block and the Pricing rule are
untouched.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018gyyDkawjSPfsD7s4QeSsN
EOF
)"
```

---

## Task 4: `docs/design-system.md` Part 3 — correct the page inventory

**Files:**
- Modify: `docs/design-system.md` (Part 3 only: from `## Part 3 — Page inventory` to end of file)

**Interfaces:**
- Consumes: Task 3's corrected Parts 1–2 (in particular the corrected Studio/Shop/Dashboard vocabulary — Part 3 must use the same words).
- Produces: nothing.

**Method (binding).** Same as Task 3: open the code, then write. Ruling R8 governs what may be edited; ruling R9 governs retired-but-present surfaces. **`/` Home item 6 (the Pricing rule) must not change in any way** — not a word, not a link, not the issue numbers.

- [ ] **Step 1: Correct "Global chrome" (lines 519–531)**

Read `src/components/site-header.tsx` and `src/lib/funnel-routes.ts`.

- Item 1 SiteHeader claims the nav is "Studio / My Designs / Shop / Orders, Dashboard behind `STORES_ENABLED`". The real bar (PR #219, nav model A) is **Studio · Shop · Cart · hamburger**, with Orders / Feedback / build date / Sign out / Admin inside the account menu, Admin gated by `isAdmin` from `getHeaderState`. "My Designs" is the Studio's Library tab. Correct.
- Item 3 FeedbackLauncher: verify against `src/lib/funnel-routes.ts` — the launcher is hidden on `/design`, `/preview`, `/order`, `/cart`, `/studio`, `/d`, and the header menu item covers those. The parenthetical about competing with "/design's gallery FAB" needs checking: #89 replaced that FAB with a thumbnail strip. Correct or strike.
- Item 4 "Build-date stamp in header (desktop only)" — verify where it renders now (the account menu, per PR #92/#219).

- [ ] **Step 2: Correct "`/` Home" (lines 533–555)**

Read `src/app/page.tsx` and `src/components/maker-hero.tsx`.

- Item 1 MakerHero is described as the "signed-out hero". #82 made it the hero for **all** visitors and deleted `HomeHero`; PR #220 removed the signed-in `/`→`/studio` redirect, and `/` reads no session at all. Correct.
- Item 2 "**HomeHero** (`components/home-hero.tsx`)" — the file does not exist (`ls src/components/`). Delete the item and renumber the list.
- Item 3 "Proof strip" and item 4 "Shop teaser — `PublishedGrid` 12-card feed + 'See all' → /prints" — verify both against `src/app/page.tsx`; `/prints` is now `/shop`.
- Item 6 **Pricing line** — **do not touch.**

- [ ] **Step 3: Correct "`/design` Studio" (lines 557–582)**

Read `src/app/design/chat-panel.tsx`, `image-gallery.tsx`, `design-stage.tsx`, `mobile-gallery-drawer.tsx`, `mobile-gallery-strip.tsx`, `image-lightbox.tsx`.

Rename the section's gloss so it does not call `/design` "Studio" (Task 3 fixed the vocabulary: Studio is `/studio`; `/design` is one conversation thread). Then correct: the composer's actions (#174: one submit that generates, plus chat's own "Ask"; Compare gone since #56); the desktop layout (#151 added `DesignStage` — hero + generations strip + a fixed chat column — and dropped the Dark/Light backdrop toggle); the mobile strip (#89 replaced the numbered gallery FAB and removed the auto-open drawer); the empty state (the 8s chip-reveal delay was removed, chips are always visible, and only three example prompts render — #214); the lightbox actions ("Adopt generator" is gone with the multi-generator removal).

- [ ] **Step 4: Correct "`/preview`", "`/order`", "`/order/confirm`", "`/cart`" (lines 584–634)**

Read `src/app/preview/page.tsx`, `src/app/order/page.tsx`, `src/app/order/confirm/page.tsx`, `src/app/cart/page.tsx`.

- `/preview` item 1 names a `ProductSilhouette` fallback — deleted in #91; the instant layer is artwork on a shirt-colour square. Item 2 "**Use this design →** CTA (funnel exit to /order)" is wrong twice: the purchase screen collapsed onto `/preview` (#84), so there is no funnel exit to `/order`, and the CTA is the buy panel's own. Item 5's Front/Back toggle was retired for both-sides-at-once (#198). Verify each and correct.
- `/order` — the page is now a redirect to `/preview` (`src/app/order/page.tsx`). Per R9, keep the section heading, replace its body with one line saying so and pointing at `/preview`'s entry, and move nothing.
- `/order/confirm` — verify the three states listed are the three the file renders (PR #221 made it a server component). Correct if not.
- `/cart` — verify the item list and summary against the file.

- [ ] **Step 5: Correct "`/shop`", "`/shop/[slug]`", "`/dashboard`" (lines 636–660)**

- `/shop` item 2 "Header ('Shop' + one-liner, persona-dependent)" — the one-liner was deleted in the Paper Shop slice (#222); the header is a mono masthead. Correct. Item 1's card description should match `src/components/published-grid.tsx` (#222 gave cards a hairline frame, title, maker).
- `/shop/[slug]` and `/dashboard` — retired per R9: one line each saying retired (#191, `STORES_ENABLED` removed from Vercel Production and Preview, PR #193; tables and routes drop with composition slice 5, PR #201), body kept.

- [ ] **Step 6: Correct "`/d/[imageId]`", "`/designs`", "`/orders`", "Auth", the three admin sections (lines 662–743)**

- `/d/[imageId]` — PR #224 re-laid this page: mono `TITLE` / `DESIGNED BY` identity block, ONE primary "Order" (`data-testid="order-expand"`) that expands the picker stack in place, owner actions grouped under a mono `OWNER` label, ink-circle back arrow. The doc's "**Buy now**" and its price-breakdown claim are both stale — and per the Global Constraints, **no price string may be written here**. Read `src/app/d/[imageId]/page.tsx`, `identity-block.tsx`, `owner-actions.tsx`, `buy-hero.tsx` and correct.
- `/designs` — a 308 to `/studio/library` (`src/app/designs/page.tsx`); `designs-list.tsx` was deleted in #184. Per R9 keep the heading, replace the body with one line pointing at the Studio Library view, and describe Library from `src/app/studio/library/library-grid.tsx` only if you can do it in one line without a new section.
- `/orders` — item 1 is already correct (PR #221's ruled rows and mono Badge). Add nothing except the masthead change **this slice** just made in Task 2 (a mono `ORDERS` label, not a display heading) — you are describing your own diff, so verify it in `src/app/orders/orders-list.tsx`.
- Auth — item 3 "Error line (red)": PR #223 swept raw `text-red-*` off the auth pages onto the tokens. Verify in `src/app/(auth)/` and correct.
- `/admin`, `/admin/orders/[id]` — verify the component lists still match; PR #223 re-skinned them (mono column headers, ruled rows, no coloured links). Correct the visual claims, keep the functional inventory.
- `/admin/published` — item 1 says "hidden = red border + dimmed". Verify: the wrapper takes `border-negative` and there is a mono `Hidden` label; "dimmed" is not implemented. Correct, and record the card's new square hairline treatment from Task 2.

- [ ] **Step 7: Run the same two regression checks as Task 3, plus a whole-doc read**

Run:
```bash
cd /Users/nico/src/prntd/.claude/worktrees/paper-leftovers
git diff docs/design-system.md | grep -nE '^\+.*(From \$|19\.43|minRetailPrice|Fresh Prints|matte black|checkerboard pattern)'
npx vitest run src/lib/__tests__/no-preselection-price.test.ts
```
Expected: no grep output; the test PASSES.

Then read the whole edited `docs/design-system.md` top to bottom once, checking: no new section or heading was added, Part 1's persona record is intact, the token block and contrast table are intact, `/` Home item 6 is byte-identical to before, and every list you renumbered is still consecutive.

- [ ] **Step 8: Commit**

```bash
cd /Users/nico/src/prntd/.claude/worktrees/paper-leftovers
git add docs/design-system.md
git commit -m "$(cat <<'EOF'
docs: design-system Part 3 inventory matches the shipped routes (#188)

The page inventory still listed HomeHero (deleted), the /order purchase
screen (collapsed onto /preview), ProductSilhouette (deleted), the Compare
button, the old four-link nav, /prints, and "Buy now". Every section
rechecked against code; retired-but-present routes (/order, /designs,
/prints, /dashboard, /shop/[slug]) keep their entries with one line saying
what replaced them, so the inventory of code still in the tree survives.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018gyyDkawjSPfsD7s4QeSsN
EOF
)"
```

---

## Self-review notes

**Spec coverage.** Brief (a) → Task 1. Brief (b) → Task 2 steps 2–5 plus ruling R5 for the confirm-page copy. Brief (c) → Task 2 steps 6–7 plus rulings R6 and R7. Brief (d) → Tasks 3 and 4, split at the Part 2/Part 3 boundary so each is a reviewable unit; the brief's "list every stale paragraph with line numbers" is satisfied by the per-step lists, which cite the quoted text as well as the line number because the numbers drift as the file is edited.

**Deferred by construction.** `/order/confirm`'s "View My Orders" copy (R5, out of fence). Any call site of `SizePicker`/`ColorPicker` that reads badly with a mono label (Task 1 step 1 — record, do not edit). The Studio Library / bench / archive surfaces belong to a sibling slice this session and must not be touched even in the doc's code, only described.

**Not in scope.** No route changes, no server actions, no schema, no e2e, no new tests beyond the four assertions in Tasks 1–2, no `src/components/ui/*` edits.
