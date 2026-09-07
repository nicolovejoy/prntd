# Paper slice 5 — image detail page re-lay (#188) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-lay the image detail page (`/d/[imageId]`) to the Paper look: one ink-bordered hero, a mono-labelled TITLE / DESIGNED BY / PRICE identity block, exactly one primary action ("Order"), and every other action as small underlined text — with the owner's actions grouped under a mono `OWNER` label.

**Architecture:** Presentation only. No server action, no guard, no pricing math, no `?front=`/back-pin plumbing changes. The page keeps its current component graph (`page.tsx` → `BuyHero` → `PublishedImageView` | `SideMockup` + `BuyPanel`, with `ConversationImages` below). Three things move: the title/attribution block becomes a mono-labelled definition list computed in the server page; the owner's scattered links (Publish / Un-publish / Open conversation / Delete conversation) collect into one row under a mono `OWNER` label rendered after the buy area; and `StartFromImage` stops being a second full-width button so only "Order" reads as primary.

**Tech Stack:** Next.js 16 App Router (server components + client islands), React 19, Tailwind v4 with the Paper tokens in `src/app/globals.css`, Vitest + Testing Library.

**Spec:** `docs/ux-design-review-2026-09.md` — the `**/d/[imageId]` image page**` verdict (line ~148) and "The four screens to mock next" item 3 (line ~308). There is no mock for this page; the verdict text plus the controller brief reproduced verbatim below is the whole spec. Paper tokens and rules: `docs/design-system.md` Part 1 (persona C, "The Clean Label"), `src/app/globals.css`.

## Global Constraints

- Work only inside the worktree `/Users/nico/src/prntd/.claude/worktrees/paper-image-detail` on branch `feat/188-paper-image-detail`. Never touch the main checkout or a sibling worktree. Use absolute paths.
- **Files you may change:** anything under `src/app/d/[imageId]/` (including new files and `__tests__/`) and `docs/superpowers/`. **Nothing else.** In particular: `src/components/ui/*` is frozen, `src/components/product-options.tsx` is shared with `/order` and frozen, `src/components/side-mockup.tsx` is shared with `/preview` and frozen, `src/app/globals.css` is frozen, `src/lib/**` is frozen. Other slices are editing studio/orders/cart/admin/auth/shop in parallel; a shared-file edit collides.
- **This is NOT the Next.js you know** (`AGENTS.md`). Do not invent App Router API from memory; copy call shapes from working code already in this repo.
- Vocabulary: call it **"the image detail page"** in every commit message, comment and doc line. Never "/d" on its own (memory `feedback-image-detail-page`).
- **Paper rules** (decided by Nico; do not re-litigate). Light only. Tokens: ground `--background`, ink `--foreground`, `--text-muted`, `--text-faint`, hairline `--border`, `--border-hover`, `--surface`, `--surface-well`, `--accent-rose`. Tailwind: `bg-background`, `text-foreground`, `border-border`, `text-text-muted`, `text-text-faint`, `bg-surface`, `bg-surface-well`, `font-mono`.
  - 1px ink/hairline borders. **No shadows.** No dark literals anywhere (`bg-black`, `text-white`, `bg-gray-*`, `bg-foreground/70`, hex darks) — a guard test forbids some of them already.
  - `--accent-rose` is used ONLY on the wordmark and the Studio-composer/landing Generate. **Never on this page.**
  - Mono label class, used verbatim everywhere this plan says "mono label":
    `font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted`
  - Body 14px (`text-sm`). Titles 14px/500 (`text-sm font-medium`). Links underlined: `underline underline-offset-[3px]`.
  - ONE primary action per screen: `Button` default `variant="primary"` (outlined ink). Everything else is `variant="secondary"`, `variant="ghost"`, or plain underlined text.
  - `disabled` already renders as a dotted border + muted text in the primitive. Do not add opacity hacks.
  - 44px minimum tap targets on phone (`min-h-11` / `w-11 h-11`). Check every layout at 390px.
  - AA contrast holds. `--text-faint` (#6f6d6a, 4.74:1 on the ground) is fine on `--background` and on `--surface-well`; do not put it on a coloured storefront backdrop.
- Copy is persona C: plain, literal, no marketing sentence, no exclamation mark, no whimsy. Reuse existing strings; new copy is short and literal.
- Lint policy (`CLAUDE.md` → Tooling & CI): `@typescript-eslint/no-explicit-any` is an **error** in product code, off in tests. `catch (err)` unannotated, narrowed with `err instanceof Error ? err.message : String(err)`.
- Migration-free. If any step appears to need a schema change, STOP and report.
- Path alias `@` maps to `src/`. Single test file: `npx vitest run <path>`. Whole suite: `npm test`.
- Every commit message ends with exactly these two trailer lines:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_018gyyDkawjSPfsD7s4QeSsN
  ```

## Spec, verbatim (controller brief)

> **Goal** — Paper rollout slice 5 (#188): re-lay the image detail page `/d/[imageId]` per `docs/ux-design-review-2026-09.md` — route verdict: "Keep, re-lay: title/designer/price as one mono-labelled block, Order primary, everything else in a small-text action row. Paper: the storefront backdrop stays a real fill (it is the buyer's colour choice); the back-arrow button (`bg-black/45`) becomes an ink circle."
>
> 1. **Hero**: artwork on the listing's pinned backdrop (real fill, unchanged) inside a 1px ink-bordered card; the floating ← back arrow becomes a 44px ink-bordered circle on paper (no `bg-black/45`, no scrim); on phone the image stays capped at ~40vh as today. The both-sides hero from #198 (front hero + back tile) is unchanged in behaviour.
> 2. **Identity block** directly under the hero: one mono-labelled block — `TITLE` (existing title, 14px/500 ink), `DESIGNED BY` (attribution, existing rule), `PRICE` ("From $X" via the existing pricing helper — reuse whatever the expanded panel computes; the collapsed CTA stays plain "Order" per PR #131's ruling — do not put a price on the button). Labels mono caps muted, values 14px ink, hairline rules between.
> 3. **Actions**: ONE primary = "Order" (existing `data-testid="order-expand"`, expands the unchanged picker stack in place, buy still size-gated). "New design from this image", "Add to cart" (inside the expanded panel as today), Publish/Unpublish, "Open conversation", Delete, "Use this one"/siblings strip (#199 lightbox untouched), "Forked from…" all become a small-text underlined action row / owner row grouped under a mono `OWNER` label when the viewer owns it. Keep every action, every guard, every test id. The publish modal, background picker, ConfirmSheet/NoticeSheet, InlineNotice wiring (#200/#218) are untouched.
> 4. **Expanded buy panel** (`buy-panel.tsx`): section labels mono caps ("SIZE", "COLOR", "BACK"), swatches keep 44px targets, the 5-swatch + "+N more" collapse from #130 stays, the sticky bottom bar keeps the computed total and the size gate; `bg-checkerboard` wells → `bg-surface-well` bordered squares. Do not change any state logic, `addToCart`/`buyPublishedDesign` calls, or the `?front=`/back pin plumbing (#164/#198) — presentation only. If the Feedback launcher still floats over the sticky bar, check `isFunnelRoute` — #219 already took Feedback off `/d`; verify and pin with a test if none.
> 5. `conversation-images.tsx` strip: cells as bordered white squares with mono `#N`, no checkerboard.

---

## Controller rulings (binding — these resolve the spec's ambiguities)

### R1. `PRICE` is the item-price floor, `From $19.43`, and the word "shipped" must never be added

`minRetailPrice()` (`src/lib/pricing.ts:144`) is the minimum of `computePrice(0, blank, size).total` across every active blank and size — the same family as the expanded panel's "Design" line (`buy-panel.tsx:188`). It is currently called from nowhere (the landing hero dropped it in PR #214), so this page adopts it unchanged.

The value shown is **item price only**, i.e. `From $19.43`. Shipping is a separate Stripe line (`FLAT_SHIPPING_USD` $4.69) and stays broken out in the expanded panel (Design / Shipping / Total). PR #214 deleted the landing line "From $19.43, shipped." because the word *shipped* claimed the flat shipping was included when it was not — **the number was never the defect, the claim was.** A shop price that excludes shipping is ordinary commerce; a shop price that claims delivery is included is false. So: `From $19.43`, no "shipped", no "delivered", no "+ shipping" tail. This ruling is restated as a comment at the call site so a future sweep does not re-add the word.

Cost if wrong: a buyer reads $19.43 and pays $24.12 at checkout, having seen the $4.69 shipping line on the very same screen one tap earlier. Cheap.

### R2. Both the published branch and the owner's unpublished branch get the same identity block

`PRICE` is a catalogue floor, not a listing property, so it is true on unpublished work too (that branch's Order goes to `/preview`, which prices from the same blanks). One block, computed once, rendered in both branches — which is what `page.tsx` already does with `metaBlock`.

### R3. "Forked from …" is provenance, not an action — it becomes a `FORKED FROM` row inside the identity block

The brief lists it among the things that "become a small-text underlined action row / owner row", but it is not an action, it is public (not owner-gated), and it is historical only (fork was removed from the product on 2026-05-30; only legacy chains exist). Putting it in the OWNER row would owner-gate a public attribution line. It becomes a conditional fourth row of the identity block with the mono label `FORKED FROM`, links still underlined.

Cost if wrong: one line sits 40px higher than someone imagined, on data that exists for a handful of legacy images.

### R4. Un-publish moves out of `PublishedImageView` into the OWNER row; the background picker stays put

The brief's item 3 names "Publish/Unpublish" as part of the owner row. Un-publish currently lives inside `published-image-view.tsx` next to the backdrop picker — and `PublishedImageView` only renders while the hero is **collapsed**, so today Un-publish silently disappears the moment the buyer taps Order. Moving it into the OWNER row (rendered outside `BuyHero`) makes it always reachable and puts all four owner actions in one place.

The `BackgroundPicker` does **not** move: its docblock's reason still holds — picking a backdrop is direct manipulation and you want it beside the artwork it recolours — and the brief's item 1 keeps the backdrop as a real fill on the hero.

Cost if wrong: the owner sees Un-publish in a row instead of under the picker. No permission, no data, no money changes; `unpublishImage` and its confirm copy are moved verbatim.

### R5. Media wells are `bg-surface-well`, in the strip too — not white

The brief says `bg-surface-well` for the panel wells (item 4) and "bordered white squares" for the strip (item 5). Use `bg-surface-well` (#e6e3dd) for both. The design review's own summary point 4 is that artwork on the wrong ground is a live defect and that "under Paper the inverse bites white-ink art" — a pure-white cell is exactly that ground. `--surface-well` is the token #213 introduced *as* the media well, and `.bg-checkerboard` already resolves to it, so this is a rename to the honest class plus an explicit `border border-border` (the `.bg-checkerboard` rule deliberately carries no border — see the docblock in `globals.css`, and the guard test `src/app/__tests__/globals-css.test.ts`).

Cost if wrong: media cells are one shade warmer than a mock nobody drew.

### R6. Corner radii stay as they are

Paper is "1px ink-bordered cards with no shadow"; it is not a sharp-corner rule. `Button` is `rounded-md` and `Card` is `rounded-lg` in the primitives, which are frozen. Keeping `rounded-md` / `rounded-lg` on this page keeps it consistent with the primitives it sits next to. Do not convert anything to square corners, and do not add radii where there are none.

### R7. `SizePicker` / `ColorPicker` labels are NOT converted to mono in this slice

The brief's item 4 asks for mono caps "SIZE" and "COLOR". Both labels are rendered inside `src/components/product-options.tsx` (`text-sm font-medium`), which is shared with `/order` and is outside this slice's file boundary. Passing `label="SIZE"` through the existing prop would yield uppercase text in the wrong typeface — a half-measure that reads as a mistake — and `ColorPicker`'s label is not configurable at all.

So: this slice gives mono labels to the sections it owns (`PRODUCT`, `BACK`, `PRICE` in the breakdown, `OWNER`, and the identity block). `SizePicker`/`ColorPicker` keep their current labels, and the PR body carries this as an explicit **Deferred** item to be swept when a slice legitimately owns `src/components/product-options.tsx`.

Cost if wrong: two labels in the expanded panel are 14px sans while their neighbours are 11px mono, for one slice. The alternative cost — a shared-component edit colliding with a parallel worktree, or two different label typefaces on `/order` — is worse.

### R8. The Feedback launcher is already off this page; verify, don't change

`src/lib/funnel-routes.ts` gained the `/d` prefix in PR #219 and `src/lib/__tests__/funnel-routes.test.ts` already asserts `isFunnelRoute("/d/abc123") === true`. That is exactly the guard the brief asks to "verify and pin with a test if none" — there is one. No code change, no new test; it goes in the PR body as verified.

---

## File structure

Every path below is relative to the worktree root.

| File | Change | Responsibility after the change |
| --- | --- | --- |
| `src/app/d/[imageId]/page.tsx` | Modify | Server page. Builds the mono identity block (TITLE / DESIGNED BY / PRICE / FORKED FROM), renders the hero branch, then the OWNER row, then the siblings strip. |
| `src/app/d/[imageId]/identity-block.tsx` | **Create** | Server component. The mono-labelled definition list + the shared `MONO_LABEL` class constant used across the segment. |
| `src/app/d/[imageId]/owner-actions.tsx` | **Create** | Server component. The `OWNER` mono label + the one-row group holding publish/un-publish and the conversation actions. |
| `src/app/d/[imageId]/unpublish-action.tsx` | **Create** | Client island. The Un-publish button + its confirm, moved verbatim out of `published-image-view.tsx`. |
| `src/app/d/[imageId]/published-image-view.tsx` | Modify | Artwork on its pinned backdrop inside a 1px-bordered card + (owner) the background picker. No longer owns Un-publish. |
| `src/app/d/[imageId]/editable-naming.tsx` | Modify | The title value inside the identity block: 14px/500 ink `h1` + the owner's Edit affordance. |
| `src/app/d/[imageId]/buy-hero.tsx` | Modify | Ink-circle back arrow; otherwise unchanged behaviour. |
| `src/app/d/[imageId]/buy-panel.tsx` | Modify | Mono section labels for the sections it owns, `bg-surface-well` wells, price breakdown under a mono label. **No state/action changes.** |
| `src/app/d/[imageId]/start-from-image.tsx` | Modify | Underlined small-text action instead of a full-width secondary button. |
| `src/app/d/[imageId]/conversation-actions.tsx` | Modify | Two underlined small-text actions that lay out inside the OWNER row. |
| `src/app/d/[imageId]/publish-cta.tsx` | Modify | Small-text Publish affordance sized for the OWNER row. |
| `src/app/d/[imageId]/conversation-images.tsx` | Modify | Strip cells as bordered `bg-surface-well` squares with a mono `#N` caption; mono section label. |
| `src/app/d/[imageId]/__tests__/*` | Modify / create | Behavioural coverage for each of the above. |

---

## Task 1: Identity block, hero card, ink back arrow

**Files:**
- Create: `src/app/d/[imageId]/identity-block.tsx`
- Create: `src/app/d/[imageId]/__tests__/identity-block.test.tsx`
- Modify: `src/app/d/[imageId]/page.tsx` (replace the `metaBlock` JSX at lines 89–134 and the mobile back arrow at 161–170)
- Modify: `src/app/d/[imageId]/editable-naming.tsx` (the non-editing branch, lines 24–41, and the input's type scale)
- Modify: `src/app/d/[imageId]/published-image-view.tsx` (the image card wrapper only)
- Modify: `src/app/d/[imageId]/buy-hero.tsx` (the `backArrow` const, lines 246–254)

**Interfaces:**
- Produces, consumed by Tasks 2–4:
  ```ts
  // src/app/d/[imageId]/identity-block.tsx
  export const MONO_LABEL: string; // the mono label class string, verbatim from Global Constraints

  export function IdentityBlock(props: {
    imageId: string;
    title: string | null;
    canEditTitle: boolean;
    designerName: string;
    priceFloor: number;                 // dollars, from minRetailPrice()
    forkChain: { imageId: string; title: string | null; designerName: string }[];
  }): React.ReactElement;
  ```
- Consumes: `minRetailPrice` from `@/lib/pricing`; `EditableNaming` from `./editable-naming` (unchanged props: `imageId`, `title`, `canEdit`).

### Steps

- [ ] **Step 1: Write the failing test**

Create `src/app/d/[imageId]/__tests__/identity-block.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { IdentityBlock } from "../identity-block";

// EditableNaming is a client island with a router dependency; the block's own
// job is the labelled rows, so the title value is stubbed to a plain heading.
vi.mock("../editable-naming", () => ({
  EditableNaming: ({ title }: { title: string | null }) => (
    <h1>{title ?? "Untitled"}</h1>
  ),
}));

describe("IdentityBlock", () => {
  it("labels title, designer and price", () => {
    render(
      <IdentityBlock
        imageId="img-1"
        title="Dapper Whale"
        canEditTitle={false}
        designerName="Nico"
        priceFloor={19.43}
        forkChain={[]}
      />
    );
    expect(screen.getByText("Title")).toBeInTheDocument();
    expect(screen.getByText("Designed by")).toBeInTheDocument();
    expect(screen.getByText("Price")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Dapper Whale" })
    ).toBeInTheDocument();
    expect(screen.getByText("Nico")).toBeInTheDocument();
    // Item price floor only — never "shipped" (ruling R1).
    expect(screen.getByText("From $19.43")).toBeInTheDocument();
    expect(screen.queryByText(/shipped/i)).not.toBeInTheDocument();
  });

  it("omits the fork row when there is no fork chain", () => {
    render(
      <IdentityBlock
        imageId="img-1"
        title="Dapper Whale"
        canEditTitle={false}
        designerName="Nico"
        priceFloor={19.43}
        forkChain={[]}
      />
    );
    expect(screen.queryByText("Forked from")).not.toBeInTheDocument();
  });

  it("renders the fork chain as links when present", () => {
    render(
      <IdentityBlock
        imageId="img-2"
        title="Remix"
        canEditTitle={false}
        designerName="Ada"
        priceFloor={19.43}
        forkChain={[
          { imageId: "img-1", title: "Original", designerName: "Nico" },
        ]}
      />
    );
    expect(screen.getByText("Forked from")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Original" });
    expect(link).toHaveAttribute("href", "/d/img-1");
    expect(screen.getByText(/by Nico/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run "src/app/d/[imageId]/__tests__/identity-block.test.tsx"`
Expected: FAIL — `Failed to resolve import "../identity-block"`.

- [ ] **Step 3: Create the identity block**

Create `src/app/d/[imageId]/identity-block.tsx`:

```tsx
import Link from "next/link";
import { EditableNaming } from "./editable-naming";

/**
 * The mono label used across the image detail page for section and row
 * labels (Paper slice 5, #188). Defined once here so the page, the buy
 * panel, the owner row and the siblings strip cannot drift apart.
 */
export const MONO_LABEL =
  "font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted";

type ForkLink = {
  imageId: string;
  title: string | null;
  designerName: string;
};

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border py-2.5 sm:flex-row sm:gap-4 sm:py-2">
      <dt className={`${MONO_LABEL} sm:w-32 sm:shrink-0 sm:pt-0.5`}>{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  );
}

/**
 * Title, designer and price as one labelled block (design review,
 * "/d/[imageId] image page": "title/designer/price as one mono-labelled
 * block"). Server component — the only client island inside it is the
 * owner's title editor.
 *
 * `priceFloor` is the ITEM price floor (minRetailPrice), so the value reads
 * "From $19.43" and says nothing about delivery: flat shipping is a separate
 * Stripe line and is broken out in the expanded buy panel. PR #214 deleted
 * the landing's "From $19.43, shipped." for claiming otherwise — do not add
 * "shipped", "delivered" or a shipping tail here.
 */
export function IdentityBlock({
  imageId,
  title,
  canEditTitle,
  designerName,
  priceFloor,
  forkChain,
}: {
  imageId: string;
  title: string | null;
  canEditTitle: boolean;
  designerName: string;
  priceFloor: number;
  forkChain: ForkLink[];
}) {
  return (
    <dl className="border-t border-border">
      <Row label="Title">
        <EditableNaming imageId={imageId} title={title} canEdit={canEditTitle} />
      </Row>
      <Row label="Designed by">{designerName}</Row>
      <Row label="Price">From ${priceFloor.toFixed(2)}</Row>
      {forkChain.length > 0 && (
        <Row label="Forked from">
          <span className="text-text-muted">
            {forkChain.map((link, i) => (
              <span key={link.imageId}>
                {i > 0 && " ← "}
                <Link
                  href={`/d/${link.imageId}`}
                  className="underline underline-offset-[3px] text-foreground hover:text-text-muted"
                >
                  {link.title ?? "an earlier design"}
                </Link>{" "}
                by {link.designerName}
              </span>
            ))}
          </span>
        </Row>
      )}
    </dl>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run "src/app/d/[imageId]/__tests__/identity-block.test.tsx"`
Expected: PASS (3 tests).

- [ ] **Step 5: Retype the title in `editable-naming.tsx`**

In the non-editing branch replace

```tsx
          <div className="flex items-baseline gap-3">
            <h1 className="text-xl sm:text-2xl font-bold">{title ?? "Untitled"}</h1>
            {canEdit && (
              <button
                onClick={() => setEditing(true)}
                className="text-xs text-text-muted underline hover:no-underline"
              >
                Edit
              </button>
            )}
          </div>
```

with

```tsx
          <div className="flex items-baseline gap-3">
            {/* 14px/500 ink: the title is a value inside the identity block
                now, not a page-scale headline (Paper slice 5, #188). It stays
                the page's h1. */}
            <h1 className="text-sm font-medium text-foreground">
              {title ?? "Untitled"}
            </h1>
            {canEdit && (
              <button
                onClick={() => setEditing(true)}
                className="min-h-11 text-xs text-text-muted underline underline-offset-[3px] hover:no-underline sm:min-h-0"
              >
                Edit
              </button>
            )}
          </div>
```

and in the editing branch drop the display-scale type off the input:

```tsx
        className="w-full bg-surface border border-border rounded px-3 py-2 text-sm"
```

(the previous value was `... px-3 py-2 text-2xl font-bold`).

- [ ] **Step 6: Wire the block into `page.tsx`**

Replace the whole `metaBlock` const (lines 89–134) with:

```tsx
  // Title/attribution/price as one mono-labelled block, identical for both
  // branches below (design review, "/d/[imageId] image page"). The owner's
  // actions are NOT here — they collect under the OWNER row further down.
  const identityBlock = (
    <IdentityBlock
      imageId={img.imageId}
      title={img.title}
      canEditTitle={isOwner && isPublished}
      designerName={img.designerName}
      priceFloor={minRetailPrice()}
      forkChain={img.forkChain}
    />
  );
```

Add the imports:

```tsx
import { minRetailPrice } from "@/lib/pricing";
import { IdentityBlock } from "./identity-block";
```

and replace both `{metaBlock}` / `>{metaBlock}<` usages with `identityBlock`. Delete the now-unused `Link`-based fork markup, the `EditableNaming` import, the `PublishCta` import and the `ConversationActions` import **only if** nothing else in the file still uses them — Task 2 re-adds `PublishCta` and `ConversationActions` via the owner row, so leave those two imports in place for now and let lint/typecheck tell you. Run `npm run lint` at the end of this task and fix whatever it names.

- [ ] **Step 7: Ink back arrow, both copies**

`page.tsx` line ~166 and `buy-hero.tsx` line ~250 carry the same `className`. Replace both occurrences of

```
"sm:hidden absolute top-2 left-2 z-10 inline-flex items-center justify-center w-10 h-10 rounded-full bg-foreground/70 text-accent-fg backdrop-blur-sm"
```

with

```
"sm:hidden absolute top-2 left-2 z-10 inline-flex h-11 w-11 items-center justify-center rounded-full border border-foreground bg-background text-foreground"
```

(44px tap target, ink circle on paper, no scrim, no blur — the review's "the back-arrow button becomes an ink circle".)

- [ ] **Step 8: Border the hero card**

In `published-image-view.tsx`, the image wrapper is already `rounded-lg overflow-hidden border border-border`. Leave the classes as they are — the card is already a 1px hairline-bordered card — and add one comment above it:

```tsx
      {/* 1px bordered card on paper; the fill inside is the listing's pinned
          backdrop, which stays a real colour because it is the buyer's
          garment-colour choice (design review, Paper note). */}
```

- [ ] **Step 9: Run lint, typecheck and the segment's tests**

Run:
```
npm run lint && npm run typecheck && npx vitest run "src/app/d/[imageId]"
```
Expected: lint 0 errors, typecheck clean, all segment tests pass. Fix any test that broke because the title is no longer `text-2xl` — re-point it at behaviour (role/name), never weaken an assertion.

- [ ] **Step 10: Commit**

```bash
git add "src/app/d/[imageId]" && git commit -m "$(cat <<'EOF'
Image detail page: mono-labelled identity block + ink back arrow

Title, designer and the item-price floor become one mono-labelled block
under the hero (design review verdict for the image detail page). The
mobile back arrow loses its bg-foreground/70 scrim for a 44px ink circle
on paper.

Price is the item floor from minRetailPrice() and says nothing about
delivery: flat shipping is a separate Stripe line, broken out one tap
away in the expanded panel. PR #214 deleted the landing's "…, shipped."
for exactly that claim.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018gyyDkawjSPfsD7s4QeSsN
EOF
)"
```

---

## Task 2: One primary action, and the owner row

**Files:**
- Create: `src/app/d/[imageId]/unpublish-action.tsx`
- Create: `src/app/d/[imageId]/owner-actions.tsx`
- Create: `src/app/d/[imageId]/__tests__/unpublish-action.test.tsx`
- Create: `src/app/d/[imageId]/__tests__/owner-actions.test.tsx`
- Modify: `src/app/d/[imageId]/published-image-view.tsx` (remove Un-publish + its confirm)
- Modify: `src/app/d/[imageId]/start-from-image.tsx`
- Modify: `src/app/d/[imageId]/publish-cta.tsx`
- Modify: `src/app/d/[imageId]/conversation-actions.tsx`
- Modify: `src/app/d/[imageId]/page.tsx`
- Modify: `src/app/d/[imageId]/__tests__/start-from-image.test.tsx` (if its selectors break)

**Interfaces:**
- Consumes: `MONO_LABEL` from `./identity-block` (Task 1).
- Produces:
  ```ts
  // src/app/d/[imageId]/unpublish-action.tsx  ("use client")
  export function UnpublishAction(props: { imageId: string }): React.ReactElement;

  // src/app/d/[imageId]/owner-actions.tsx  (server component)
  export function OwnerActions(props: {
    imageId: string;
    imageUrl: string;
    isPublished: boolean;
    canPublish: boolean;              // real (non-anonymous) session
    sourceDesignId: string | null;    // null when the conversation is gone
    conversationArchived: boolean;
  }): React.ReactElement | null;
  ```

### Steps

- [ ] **Step 1: Write the failing tests**

Create `src/app/d/[imageId]/__tests__/unpublish-action.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("@/app/designs/actions", () => ({
  unpublishImage: vi.fn(async () => {}),
  updatePublishedNaming: vi.fn(async () => {}),
}));

import { unpublishImage } from "@/app/designs/actions";
import { UnpublishAction } from "../unpublish-action";

describe("UnpublishAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("confirms before un-publishing, then sends the owner to their library", async () => {
    render(<UnpublishAction imageId="img-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Un-publish" }));
    // The confirm sheet, not window.confirm (#200).
    expect(
      screen.getByText("Take this design down from the storefront?")
    ).toBeInTheDocument();
    expect(unpublishImage).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole("button", { name: "Un-publish" })[1]);
    await waitFor(() => expect(unpublishImage).toHaveBeenCalledWith("img-1"));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/studio/library"));
  });

  it("does nothing when the confirm is dismissed", async () => {
    render(<UnpublishAction imageId="img-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Un-publish" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(
        screen.queryByText("Take this design down from the storefront?")
      ).not.toBeInTheDocument()
    );
    expect(unpublishImage).not.toHaveBeenCalled();
  });
});
```

Create `src/app/d/[imageId]/__tests__/owner-actions.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../unpublish-action", () => ({
  UnpublishAction: () => <button>Un-publish</button>,
}));
vi.mock("../publish-cta", () => ({
  PublishCta: () => <button>Publish</button>,
}));
vi.mock("../conversation-actions", () => ({
  ConversationActions: () => <button>Open conversation</button>,
}));

import { OwnerActions } from "../owner-actions";

describe("OwnerActions", () => {
  it("labels the group and offers Un-publish for a published image", () => {
    render(
      <OwnerActions
        imageId="img-1"
        imageUrl="https://img.example/1.png"
        isPublished
        canPublish
        sourceDesignId="design-1"
        conversationArchived={false}
      />
    );
    expect(screen.getByText("Owner")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Un-publish" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open conversation" })
    ).toBeInTheDocument();
  });

  it("states unpublished status and offers Publish", () => {
    render(
      <OwnerActions
        imageId="img-1"
        imageUrl="https://img.example/1.png"
        isPublished={false}
        canPublish
        sourceDesignId="design-1"
        conversationArchived={false}
      />
    );
    expect(screen.getByText("Not published")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish" })).toBeInTheDocument();
  });

  it("omits the conversation actions when the conversation is gone", () => {
    render(
      <OwnerActions
        imageId="img-1"
        imageUrl="https://img.example/1.png"
        isPublished
        canPublish
        sourceDesignId={null}
        conversationArchived={false}
      />
    );
    expect(
      screen.queryByRole("button", { name: "Open conversation" })
    ).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run both tests to verify they fail**

Run: `npx vitest run "src/app/d/[imageId]/__tests__/unpublish-action.test.tsx" "src/app/d/[imageId]/__tests__/owner-actions.test.tsx"`
Expected: FAIL — both modules unresolved.

- [ ] **Step 3: Extract `UnpublishAction`**

Create `src/app/d/[imageId]/unpublish-action.tsx` (the logic is moved verbatim from `published-image-view.tsx`; only the trigger's presentation changes):

```tsx
"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { unpublishImage } from "@/app/designs/actions";
import { useConfirm } from "@/components/ui";

/**
 * Take a published design back down (#? reversible un-publish). Lifted out of
 * published-image-view.tsx in Paper slice 5 (#188): that component only
 * renders while the hero is collapsed, so Un-publish used to vanish the
 * moment the buyer tapped Order. It belongs with the owner's other actions.
 *
 * The confirm copy and the post-action redirect are unchanged.
 */
export function UnpublishAction({ imageId }: { imageId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { confirm, element: confirmSheet } = useConfirm();

  async function unpublish() {
    const ok = await confirm({
      title: "Take this design down from the storefront?",
      body: "You can re-publish it later.",
      confirmLabel: "Un-publish",
      danger: true,
    });
    if (!ok) return;
    startTransition(async () => {
      await unpublishImage(imageId);
      // The page is no longer public — send the owner back to their library.
      router.push("/studio/library");
    });
  }

  return (
    <>
      {confirmSheet}
      <button
        type="button"
        onClick={unpublish}
        disabled={pending}
        className="inline-flex min-h-11 items-center text-sm text-text-muted underline underline-offset-[3px] hover:no-underline disabled:cursor-not-allowed disabled:text-text-faint disabled:no-underline sm:min-h-0"
      >
        {pending ? "Un-publishing…" : "Un-publish"}
      </button>
    </>
  );
}
```

- [ ] **Step 4: Strip Un-publish out of `published-image-view.tsx`**

Delete the `unpublish` function, the `useConfirm` call, the `{confirmSheet}` node, the `Button`/`useConfirm` imports, the `unpublishImage` import and the `useRouter`-driven `router.push` inside it — but keep `useRouter` itself (the backdrop picker still calls `router.refresh()`). The owner block becomes just:

```tsx
      {canEdit && (
        <BackgroundPicker value={bg} onChange={pick} disabled={pending} />
      )}
```

Update the component docblock: drop the sentence about un-publishing if one appears, and note that the owner's non-visual actions now live in the OWNER row.

- [ ] **Step 5: Build `OwnerActions`**

Create `src/app/d/[imageId]/owner-actions.tsx`:

```tsx
import { MONO_LABEL } from "./identity-block";
import { PublishCta } from "./publish-cta";
import { UnpublishAction } from "./unpublish-action";
import { ConversationActions } from "./conversation-actions";

/**
 * The owner's actions in one labelled group (design review: "the owner
 * branch stacks seven small links … with no grouping"; the verdict is
 * "everything else in a small-text action row"). Server component; each
 * action inside is its own client island so the page stays mostly static.
 *
 * The publish state is stated as a value ("Not published") rather than
 * inferred from which button is present.
 */
export function OwnerActions({
  imageId,
  imageUrl,
  isPublished,
  canPublish,
  sourceDesignId,
  conversationArchived,
}: {
  imageId: string;
  imageUrl: string;
  isPublished: boolean;
  /** A real (non-anonymous) session; publishImage rejects guests server-side too. */
  canPublish: boolean;
  /** Null when the conversation this image came from no longer resolves — an
   * image pinned by an order or a seed outlives its thread. */
  sourceDesignId: string | null;
  conversationArchived: boolean;
}) {
  return (
    <section className="border-t border-border pt-3">
      <h2 className={MONO_LABEL}>Owner</h2>
      <div className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-1">
        {isPublished ? (
          <UnpublishAction imageId={imageId} />
        ) : (
          <>
            <span className="text-sm text-text-faint">Not published</span>
            <PublishCta
              imageId={imageId}
              imageUrl={imageUrl}
              canPublish={canPublish}
            />
          </>
        )}
        {sourceDesignId && (
          <ConversationActions
            designId={sourceDesignId}
            archived={conversationArchived}
          />
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 6: Make `ConversationActions` lay out inside that row**

Its outer wrapper currently forces its own block layout. Replace

```tsx
    <div className="space-y-2 pt-1">
      {confirmSheet}
      <div className="flex flex-wrap items-center gap-4">
```

with

```tsx
    // `contents` so the two buttons become direct children of the OWNER row's
    // flex container and align with its other actions instead of forming a
    // nested block (Paper slice 5, #188).
    <div className="contents">
      {confirmSheet}
```

then close the extra `</div>` that the removed inner flex leaves behind, and move the error line so it still renders — put it after the two buttons as a `<div className="basis-full">{error && <InlineNotice message={error} />}</div>` so it wraps onto its own line inside the flex row. Restyle the two buttons to the shared action look:

```tsx
          className="inline-flex min-h-11 items-center text-sm text-text-muted underline underline-offset-[3px] hover:no-underline disabled:cursor-not-allowed disabled:text-text-faint disabled:no-underline sm:min-h-0"
```

for both (the Delete button keeps its distinct label; do **not** colour it — `--negative` is reserved for status, and the ConfirmSheet already carries `danger`). Keep `data-testid="open-conversation"`. Keep the archived hint span exactly as it is.

- [ ] **Step 7: Size `PublishCta` for the row**

Change its `Button` to a text action so the row has one visual language:

```tsx
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center text-sm text-text-muted underline underline-offset-[3px] hover:no-underline sm:min-h-0"
      >
        Publish
      </button>
```

Drop the now-unused `Button` import. The sign-in fallback link keeps its text but gains the shared underline offset and tap target:

```tsx
        className="inline-flex min-h-11 items-center text-sm text-text-muted underline underline-offset-[3px] hover:no-underline sm:min-h-0"
```

- [ ] **Step 8: Demote `StartFromImage` from a second full-width button**

This is the "two visually identical full-width buttons" the review names. Replace the `Button` with a text action, keeping the testid, the disabled state, the error notice and the action call untouched:

```tsx
  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={start}
        disabled={starting}
        data-testid="start-from-image"
        className="inline-flex min-h-11 items-center text-sm text-text-muted underline underline-offset-[3px] hover:no-underline disabled:cursor-not-allowed disabled:text-text-faint disabled:no-underline"
      >
        {starting ? "Starting…" : "New design from this image"}
      </button>
      {error && <InlineNotice message={error} />}
    </div>
  );
```

Drop the `Button` import if nothing else in the file uses it. Update the docblock's last sentence to say it renders as a small text action beside the one primary "Order".

- [ ] **Step 9: Render the owner row from `page.tsx`**

In both branches, after the hero/buy area and before the siblings strip, render:

```tsx
          {isOwner && (
            <OwnerActions
              imageId={img.imageId}
              imageUrl={img.imageUrl}
              isPublished={isPublished}
              canPublish={isLoggedIn}
              // The conversation may be gone even when the image names one —
              // an image pinned by an order or a seed survives its thread's
              // delete — so the row is gated on the design row resolving.
              sourceDesignId={
                img.sourceDesignId && img.hasSourceConversation
                  ? img.sourceDesignId
                  : null
              }
              conversationArchived={img.sourceConversationArchived}
            />
          )}
```

Import `OwnerActions` from `./owner-actions`; remove the `PublishCta` and `ConversationActions` imports from `page.tsx` (they are `OwnerActions`' dependencies now).

- [ ] **Step 10: Run the tests**

Run: `npx vitest run "src/app/d/[imageId]"`
Expected: PASS. `start-from-image.test.tsx` should still pass — the control is still a `button` with the same accessible name and testid. If a selector broke, re-point it at role/name; never weaken it.

- [ ] **Step 11: Lint, typecheck, commit**

```bash
npm run lint && npm run typecheck
```

```bash
git add "src/app/d/[imageId]" && git commit -m "$(cat <<'EOF'
Image detail page: one primary action, owner actions in one labelled row

"New design from this image" stops being a second full-width button — the
review's "two visually identical full-width buttons" — and becomes a small
underlined action beside the one primary Order. Publish/Un-publish, Open
conversation and Delete conversation collect under a mono OWNER label.

Un-publish moves out of published-image-view.tsx, which only renders while
the hero is collapsed: today the control disappears the moment the buyer
taps Order. Its confirm copy and redirect are unchanged.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018gyyDkawjSPfsD7s4QeSsN
EOF
)"
```

---

## Task 3: Paper pass on the expanded buy panel

**Files:**
- Modify: `src/app/d/[imageId]/buy-panel.tsx`
- Modify: `src/app/d/[imageId]/__tests__/buy-panel.test.tsx`

**Interfaces:**
- Consumes: `MONO_LABEL` from `./identity-block` (Task 1).
- Produces: nothing new. `BuyPanel`'s props, `BuyPanelHandle`, `BackPick`, every `data-testid` and every action call stay byte-identical.

**Hard boundary for this task:** presentation only. Do not touch `handleBuy`, `handleAddToCart`, `handleProduct`, the price computation (`frontPrice` / `computeOrderTotal` / `sizeForPrice`), the report effects, `useImperativeHandle`, the size gate (`disabled={… || !size}`), the sticky bottom bar's existence, or `SizePicker` / `ColorPicker` (ruling R7 — those labels are deferred).

### Steps

- [ ] **Step 1: Write the failing test**

Append to `src/app/d/[imageId]/__tests__/buy-panel.test.tsx`:

```tsx
describe("BuyPanel Paper pass (#188)", () => {
  it("expanded: still renders the size picker, the total and Add to cart", () => {
    render(<BuyPanel imageId="img-1" isLoggedIn cartEnabled />);
    expand();
    // The money surface survives the re-skin: a size gate, a computed total,
    // and the cart path. The nightly Stripe e2e buys via the cart, not via
    // this page, so this is the guard for the panel's own rendering.
    const blank = getBlankOrThrow("bella-canvas-3001");
    expect(screen.getByRole("button", { name: blank.sizes[0] })).toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
    expect(screen.getByTestId("add-to-cart")).toBeInTheDocument();
    // Size gate still closed until a pick.
    expect(screen.getByTestId("add-to-cart")).toBeDisabled();
  });

  it("expanded: labels the sections it owns in mono caps", () => {
    render(<BuyPanel imageId="img-1" isLoggedIn backEnabled />);
    expand();
    expect(screen.getByText("Product")).toBeInTheDocument();
    expect(screen.getByText("Back")).toBeInTheDocument();
    expect(screen.getByText("Price")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run "src/app/d/[imageId]/__tests__/buy-panel.test.tsx" -t "Paper pass"`
Expected: FAIL on the second test — "Back" and "Price" are not rendered as labels today (the Product label is `Product`, which may already pass; the Back section has no label and the price block has no heading).

- [ ] **Step 3: Mono-label the sections the panel owns**

Import the constant:

```tsx
import { MONO_LABEL } from "./identity-block";
```

Product section label — replace `className="block text-sm font-medium mb-2"` with `className={`block ${MONO_LABEL} mb-2`}` and keep the text `Product`.

Wrap the back-design section in a labelled group. The `{backEnabled && (<div>` opener becomes:

```tsx
      {backEnabled && (
        <div>
          <p className={`${MONO_LABEL} mb-2`}>Back</p>
```

(everything inside is unchanged).

Give the price breakdown a label. Replace

```tsx
      <div className="space-y-2 text-sm border-t border-border pt-4">
```

with

```tsx
      <div className="border-t border-border pt-4">
        <p className={`${MONO_LABEL} mb-2`}>Price</p>
        <div className="space-y-2 text-sm">
```

and close the extra `</div>` after the Total row. The Total row keeps `font-bold`? No — replace `font-bold` with `font-medium` (Paper: 500, not 700):

```tsx
        <div className="flex justify-between font-medium border-t border-border pt-2">
```

- [ ] **Step 4: Wells to `bg-surface-well`, bordered**

Three `bg-checkerboard` sites in this file. The class already resolves to `--surface-well`, but it carries no border by design (`globals.css` docblock + the guard test), so each site names its own edge.

The picked-back thumbnail:

```tsx
                className="w-11 h-11 rounded-md border border-border bg-surface-well object-contain"
```

The back-picker grid cells:

```tsx
                          className={`aspect-square min-h-11 rounded-md overflow-hidden border-2 bg-surface-well ${
                            s.id === back?.id
                              ? "border-accent"
                              : "border-border hover:border-accent"
                          }`}
```

The picker group heading (`text-xs font-medium uppercase tracking-wide text-text-muted`) becomes the shared mono label:

```tsx
                    <h3 className={`${MONO_LABEL} mb-1.5`}>{group.label}</h3>
```

The picker's spinner uses `border-accent`, which is ink on paper — leave it.

- [ ] **Step 5: Sticky bar and product chips on paper**

The mobile sticky bar keeps `border-t border-border bg-surface` — correct on paper (a clean surface over the warm ground, with a hairline edge). Leave it, and leave the `md:hidden` / `hidden md:block` split and the `env(safe-area-inset-bottom)` padding exactly as they are.

The product chips' selected state is `border-accent bg-accent text-accent-fg` — ink fill with ground-coloured text, which is the primitive's own inversion and matches `SizePicker`'s selected chip. Leave it so the two rows agree.

- [ ] **Step 6: Run the panel's tests**

Run: `npx vitest run "src/app/d/[imageId]/__tests__/buy-panel.test.tsx"`
Expected: PASS, including the pre-existing tests. If a pre-existing test asserted on the removed `font-bold` or the old heading classes, re-point it at text/role.

- [ ] **Step 7: Lint, typecheck, commit**

```bash
npm run lint && npm run typecheck && npx vitest run "src/app/d/[imageId]"
```

```bash
git add "src/app/d/[imageId]" && git commit -m "$(cat <<'EOF'
Image detail page: Paper pass on the expanded buy panel

Mono caps on the sections this panel owns (Product, Back, Price), the
media wells named bg-surface-well with their own hairline edge, Total at
500 instead of 700. No state, no action call, no size gate, no sticky-bar
behaviour changed.

SizePicker/ColorPicker labels stay as they are: they live in the shared
src/components/product-options.tsx, which /order also renders, and which
this slice does not own. Deferred to whichever slice does.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018gyyDkawjSPfsD7s4QeSsN
EOF
)"
```

---

## Task 4: Siblings strip on paper

**Files:**
- Modify: `src/app/d/[imageId]/conversation-images.tsx`
- Modify: `src/app/d/[imageId]/__tests__/conversation-images.test.tsx`

**Interfaces:**
- Consumes: `MONO_LABEL` from `./identity-block` (Task 1).
- Produces: nothing new. The `#199` lightbox wiring (`ImageLightbox`, `images`, `currentIndex`, `onNavigate`, `actions`) and `setPrimaryImage` are untouched.

### Steps

- [ ] **Step 1: Write the failing test**

Append to `src/app/d/[imageId]/__tests__/conversation-images.test.tsx` (reuse whatever render helper the file already defines; if it renders inline, copy that shape):

```tsx
  it("captions each strip cell with its position in the conversation", () => {
    render(
      <ConversationImages
        designId="design-1"
        currentImageId="img-2"
        images={[
          { imageId: "img-1", imageUrl: "https://img.example/1.png" },
          { imageId: "img-2", imageUrl: "https://img.example/2.png" },
          { imageId: "img-3", imageUrl: "https://img.example/3.png" },
        ]}
        initialPrimaryImageId="img-1"
      />
    );
    // #N is the position in the full seed-inclusive list — the same numbering
    // the /design thread uses — so the current image's own number is skipped.
    expect(screen.getByText("#1")).toBeInTheDocument();
    expect(screen.getByText("#3")).toBeInTheDocument();
    expect(screen.queryByText("#2")).not.toBeInTheDocument();
  });
```

Match the `SiblingImage` shape the existing tests in this file already use — read them first and copy the fixture shape verbatim rather than inventing fields.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run "src/app/d/[imageId]/__tests__/conversation-images.test.tsx" -t "captions each strip cell"`
Expected: FAIL — no `#N` text is rendered today (the number is only in `aria-label`).

- [ ] **Step 3: Re-skin the strip**

Import the label constant:

```tsx
import { MONO_LABEL } from "./identity-block";
```

Section heading:

```tsx
          <h2 className={`${MONO_LABEL} mb-2`}>Other images from this design</h2>
```

Each cell becomes a bordered `bg-surface-well` square with a mono caption underneath. Replace the `<button>` in the `others.map` with:

```tsx
                <div key={img.imageId} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => showInLightbox(index)}
                    aria-label={`Image #${index + 1}`}
                    aria-current={isCurrent ? "true" : undefined}
                    title={isCurrent ? "Current image" : undefined}
                    data-testid="conversation-image-thumb"
                    className={`relative block w-[88px] aspect-square rounded-md overflow-hidden border-2 bg-surface-well ${
                      isCurrent ? "border-accent" : "border-border"
                    }`}
                  >
                    <Image
                      src={img.imageUrl}
                      alt="Other version of this design"
                      fill
                      sizes={STRIP_SIZES}
                      loading="lazy"
                      decoding="async"
                      className="object-contain"
                    />
                  </button>
                  <p className={`${MONO_LABEL} mt-1`} aria-hidden>
                    #{index + 1}
                  </p>
                </div>
```

The caption sits **below** the artwork rather than over it: an overlay would need a scrim, and the review's complaint about `#N` labels on `bg-black/70` in the design stage is exactly that pattern.

`aria-hidden` on the caption because the button's `aria-label` already announces "Image #N" — without it a screen reader reads the number twice.

- [ ] **Step 4: The "Use this one" row and the "current image" line**

`Button variant="secondary" size="sm"` for "Use this one" is correct (secondary is the non-primary primitive; this page's one primary is Order). Leave it. Leave `InlineNotice`, `ImageLightbox` and its `actions` slot untouched.

The container's `space-y-3 pt-2 border-t border-border` already matches the ruled-row idiom. Leave it.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run "src/app/d/[imageId]/__tests__/conversation-images.test.tsx"`
Expected: PASS, all pre-existing tests included. If a test queried the thumb by its old `rounded-lg`/`bg-checkerboard` class, re-point at `data-testid="conversation-image-thumb"`.

- [ ] **Step 6: Full verification**

Run:
```
npm run lint && npm run typecheck && npm test && npm run build
```
Expected: lint 0 errors, typecheck clean, whole suite green, build succeeds. Record the four numbers (error count, suite pass count, build result) — they go in the PR body.

- [ ] **Step 7: Commit**

```bash
git add "src/app/d/[imageId]" && git commit -m "$(cat <<'EOF'
Image detail page: siblings strip on paper

Cells become bordered surface-well squares with the conversation position
as a mono caption below the artwork — not over it, which would need the
same scrim the design review flagged on the stage strip. Section heading
takes the shared mono label. Lightbox wiring untouched.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018gyyDkawjSPfsD7s4QeSsN
EOF
)"
```

---

## Self-review

**Spec coverage.**

| Spec item | Task |
| --- | --- |
| 1 — hero in a 1px bordered card; back arrow → 44px ink circle; 40vh phone cap kept; #198 both-sides hero unchanged | Task 1 steps 7–8 (the `max-h-[40vh]` and the `SideMockup` layout are deliberately untouched) |
| 2 — mono TITLE / DESIGNED BY / PRICE, hairline rules, no price on the collapsed CTA | Task 1 (ruling R1 for the price; the collapsed CTA is not touched in any task) |
| 3 — one primary "Order"; everything else small underlined text; owner row under a mono OWNER label; every action, guard and testid kept | Task 2 (+ rulings R3, R4) |
| 4 — mono section labels, 44px targets, #130 collapse kept, sticky bar total + size gate kept, wells → `bg-surface-well`, Feedback check | Task 3 (+ rulings R5, R7; Feedback = ruling R8, verified, no change) |
| 5 — strip cells bordered squares with mono `#N`, no checkerboard | Task 4 (+ ruling R5) |
| Money-adjacent: keep `buy-panel` tests green, add a rendering test for size picker + total + Add to cart | Task 3 step 1 |

**Placeholder scan.** No "TBD", no "add error handling", no "similar to Task N". Every code step carries the literal code. Two steps deliberately say "read the existing fixture shape and copy it" (Task 4 step 1) and "let lint tell you which import is now unused" (Task 1 step 6) — both are verification instructions with an exact command, not deferred design decisions.

**Type consistency.** `MONO_LABEL` is defined once in Task 1 and imported by name in Tasks 2, 3 and 4. `IdentityBlock`'s and `OwnerActions`' prop names match their call sites in `page.tsx`. `UnpublishAction` takes `imageId` only, which is what `OwnerActions` passes. `ConversationActions`' existing `{ designId, archived }` signature is unchanged and `OwnerActions` passes exactly those.

**Known risk.** Tasks 1 and 2 both edit `page.tsx`, and Task 2 removes imports Task 1 leaves in place. They must run in order, and Task 2's implementer must run `npm run lint` before committing (step 11) so an orphaned import is caught rather than shipped.
