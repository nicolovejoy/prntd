# Paper slice 6 — Shop feed card anatomy (#188) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `/shop` and the homepage Shop teaser onto the Paper look, and make a shop card say what it sells — art on its backdrop inside a hairline border that goes ink on hover, then title, then a mono `From $19.43 · Classic Tee` line, then the maker. Drop the page's centred `text-3xl` masthead and the sub-line "Designs published by other makers.", which asserts the opposite of the composition decision (the Shop sells shirts, not art).

**Architecture:** Three seams, in dependency order.

1. **Pure pricing** (`src/lib/pricing.ts`, additive only): a `cardPriceLine(blankId)` helper that turns a composition's garment identity into `{ amount, garment, text }`. It is pure and catalog-driven — no DB, no React — so the one place that decides what a shop card claims about price is unit-testable and cannot drift from `computePrice`, which is what checkout actually charges.
2. **Feed read path** (`src/lib/discover-feed.ts` → `src/app/d/actions.ts`): the mirror `product` row already carries `blank_id`; the feed simply stops dropping it. Read-only, no schema change, no new join — `getPublishedFeed` already selects from `product`.
3. **Presentation** (`src/components/published-grid.tsx`, `src/app/shop/page.tsx`, the teaser section of `src/app/page.tsx`): card anatomy, grid density, page masthead.

**Tech Stack:** Next.js 16 App Router (server components), React 19, Tailwind v4 (Paper tokens in `src/app/globals.css`), Drizzle/libSQL, Vitest + Testing Library.

**Spec:** `docs/ux-design-review-2026-09.md` — the `/prints` community-feed route verdict (lines ~183-190) and "The four screens to mock next" item 4. There is **no mock**; the verdict plus the batch brief's Paper rules are the spec, reproduced verbatim below. Owner decisions that bind: `docs/object-model-composition.md` + `docs/composition-first-class-plan.md` (the Shop sells shirts; sellable fields live on the mirror `product` row and are read via `src/lib/composition-reads.ts`).

## Global Constraints

- Work only inside the worktree `/Users/nico/src/prntd/.claude/worktrees/paper-shop-feed` on branch `feat/188-paper-shop-feed`. Never touch the main checkout or a sibling worktree. Use absolute paths.
- **This is NOT the Next.js you know** (`AGENTS.md`). If unsure about an API, read `node_modules/next/dist/docs/`. Do not invent `next/image` semantics — copy the call shape already in `published-grid.tsx`.
- **Migration-free and read-only against the schema.** `product.blank_id` already exists (`src/lib/db/schema.ts:270`). If some part of this slice appears to need DDL, stop that part, ship the rest, and report.
- **Do not touch:** `src/components/ui/*` primitives, `src/app/globals.css` tokens, `src/components/maker-hero.tsx`, the hero copy (`PRiNT your brAIn` / `Type it — See it — Wear it` is the owner's verbatim copy and is protected), `src/app/shop/[slug]/**` (the mothballed organizer storefront), `e2e/*.spec.ts`, `src/lib/model-b-writes.ts` or any `listing` writer (composition slice 5 drops are held in PR #201), `src/app/d/[imageId]/**`, `/studio`, `/orders`, `/cart`, `/admin`, auth. Other slices own those in parallel.
- Lint policy (`CLAUDE.md` → Tooling & CI): `@typescript-eslint/no-explicit-any` is an **error** in product code, off in tests. `catch (err)` with no annotation, narrowed via `err instanceof Error ? err.message : String(err)`.
- Path alias `@` maps to `src/`.
- Single test file: `npx vitest run <path>`. Whole suite: `npm test`.
- Every commit message ends with exactly these two trailer lines:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_018gyyDkawjSPfsD7s4QeSsN
  ```

## Spec, verbatim (controller brief)

> 1. **Page header**: no centred `text-3xl`; a mono caps label `SHOP` (or the existing heading string re-styled small, left-aligned) and drop the sub-line "Designs published by other makers." — it says the opposite of the composition decision. No replacement sentence.
> 2. **Card anatomy** (`PublishedGrid` card): artwork on its pinned backdrop (a real fill from the mirror product's backdrop; legacy null → White per #76), inside a 1px hairline border that goes ink on hover/focus (no `rounded-md`, no accent border, no shadow); under it a two-line block: line 1 = title (14px/500 ink, truncate; untitled → the existing fallback); line 2 = mono muted `From $X · Classic Tee` where `$X` is the item price for the garment: if the composition has a fixed `blankId` use that blank's retail price and its display name; if `blankId` is null (buyer picks) use `minRetailPrice()` from `src/lib/pricing.ts` and the default garment's name — write the pure `cardPriceLine(product/blank inputs)` helper with tests (unit) and thread the fields through the feed reader (`getDiscoverFeed` / `dedupeFeedByDesign` in `src/lib/design-publish.ts` or wherever the feed row is shaped — keep the one-card-per-design dedupe rule). Maker line: keep "by you"/designer attribution only if the current card shows it; do not add "made by makers" copy.
> 3. **Grid density**: 2 columns at 390px, 3 at `sm:`, 4 at `lg:`; `next/image` with `loading="lazy"`/`sizes` as today (#134/#144 — do not regress the lazy attributes; there is a test or add one).
> 4. **Homepage teaser** (`src/app/page.tsx` uses `PublishedGrid` + "See all" link): inherits the card; the section heading becomes the same mono label style; "See all →" underlined text. Do NOT touch `MakerHero`, the hero copy, or `e2e/landing.spec.ts` structural testids — read the spec before editing `page.tsx` and keep every `data-testid`.
> 5. Empty state via `EmptyState`, plain copy.

Paper rules that apply here (batch brief): light only; 1px hairline `border-border` resting, ink `border-border-hover` on hover/focus; no shadows; no rounded pills unless already a primitive; mono labels `font-mono text-[11px] leading-4 tracking-[0.08em] uppercase`; body 14px; titles 14px/500; links underlined (`underline underline-offset-[3px]`); 44px tap targets on phone; persona C copy (plain, literal, no marketing sentence, no exclamation marks).

## Ruling 1: `cardPriceLine` takes only the garment identity, not a price override

`product.price` is the organizer price override. It is **always null on a Shop mirror row** (`buildMirrorProductRow` in `src/lib/model-b-writes.ts:299-324` hard-codes `price: null` and `blankId: null`), and organizer products cannot reach this feed at all: `isShopMirror()` requires `design_id IS NULL`, which `store-service.createProduct` never produces. So a `price` branch in this helper would be code no row can exercise, verified by nothing, on the surface that tells a customer what a shirt costs.

The helper therefore has one input — the blank id — and derives the amount from `computePrice`, the same function checkout charges through. When compositions become first-class and start carrying a price, the helper gains that argument then, with a row that proves it.

Cost if wrong: one extra argument and one branch, added later, in a pure function with full unit coverage. Cheap. The opposite mistake — an untested price branch on a customer-facing money surface — is the class of bug this repo has a whole money-path test suite to avoid.

## Ruling 2: "From $X" for the fixed-blank case too, and the garment name comes from the blank the price came from

Two sub-rulings.

**(a) Always "From".** A blank's price varies by size (Classic Tee is $19.43 on S–XL and $21.43 on 2XL; Box Tee spans $26.18–$35.18). A card shows no size, so a bare `$19.43` would be false for a 2XL buyer. `From $X` is true in both the fixed-blank and buyer-picks cases, and one string shape means one code path.

**(b) Name the blank the amount came from.** The brief says buyer-picks uses `minRetailPrice()` and "the default garment's name". Today those agree by coincidence: `minRetailPrice()` is 19.43, which is Classic Tee's floor, and `DEFAULT_BLANK_ID` is Classic Tee. They are not the same fact. If a cheaper blank is ever added, `minRetailPrice()` drops while `DEFAULT_BLANK_ID` does not, and the card would read `From $18.00 · Classic Tee` — a price no Classic Tee is sold at.

So this plan adds `cheapestActiveBlank()` next to `minRetailPrice()`, returning `{ blankId, price }`, and has `minRetailPrice()` delegate to it. Today it returns `bella-canvas-3001` / `19.43` — byte-identical output to the current behaviour, which the existing `minRetailPrice` tests pin. Ties break toward `DEFAULT_BLANK_ID`, then catalog order, so the current card copy is stable.

Cost if wrong: ~12 lines of pure code that today returns exactly what the brief asked for anyway.

## Ruling 3: `blankId` is optional on `PublishedImage`

`PublishedImage` (`src/app/d/actions.ts:42`) is also the base of `ImagePage` (`= Omit<PublishedImage, "publishedAt"> & {...}`), which `getImagePage` builds for the image detail page — a file a sibling slice owns this session. Making `blankId` required would force an edit there for no user-visible gain (the detail page has a real buy panel with real per-size prices; it does not render a card price line).

So: `blankId?: string | null` on `PublishedImage`, set by `getDiscoverFeed`, absent elsewhere. `undefined` and `null` mean the same thing to `cardPriceLine` — "no fixed garment, buyer picks" — which is the literal truth for every mirror row in production today. This must be said in the type's docblock so nobody later reads the optionality as an oversight.

Cost if wrong: a future producer forgets to set it and its cards read the buyer-picks line, which is the correct line for a null blank anyway. No failure mode.

## Ruling 4: `md:` → `lg:` for the fourth column, and `sizes` moves with it

The brief specifies 2 / `sm:`3 / `lg:`4; the grid is 2 / `sm:`3 / `md:`4 today. `GRID_SIZES` encodes the breakpoints as media queries (`(max-width: 767px) 33vw` = the `md` boundary) precisely so the browser fetches the right width. Changing the columns without changing `sizes` makes every image between 768px and 1023px request a 25vw source for a 33vw slot — a visible softness regression on exactly the laptop widths #144 was about. The two change together, and the comment above `GRID_SIZES` says so.

## Ruling 5: no `e2e` edits; `data-testid="published-grid"` is load-bearing

`.github/workflows/prod-smoke.yml:99` probes `/shop` for `data-testid="published-grid"` as its DB canary — it only reaches the HTML when the server-side feed query returned rows. That attribute stays on the same element. `e2e/landing.spec.ts` asserts nothing about the teaser section (it is anchored on `maker-hero`, its textbox, submit button and `example-chip`s), so no spec changes and no merge-commit CI dance is needed. Verify both claims by reading the files before editing, not from this plan.

## Grounding spike (already run by the controller — do not redo)

`next/image` renders in this repo's jsdom + Vitest setup with no mock: a `PublishedGrid` render produced `<img alt="Wolf" loading="lazy" decoding="async" sizes="(max-width: 639px) 50vw, ..." srcset="/_next/image?...">` in the DOM. So the lazy-attribute regression test asserts against the real DOM and is not vacuous. **Do not add a `vi.mock("next/image", ...)`** — mocking it is exactly what would make that assertion meaningless.

---

## Task 1: `cheapestActiveBlank` + `cardPriceLine` in `src/lib/pricing.ts`

**Files:**
- Modify: `src/lib/pricing.ts` (additive exports only; `minRetailPrice` is refactored to delegate, with identical output)
- Test: `src/lib/__tests__/pricing.test.ts` (extend)

**Interfaces:**
- Produces:
  ```ts
  export function cheapestActiveBlank(): { blankId: string; price: number };
  export type ShopCardPrice = { amount: number; garment: string; text: string };
  export function cardPriceLine(blankId: string | null | undefined): ShopCardPrice;
  ```
- Consumes: `computePrice` (same module), `ACTIVE_BLANKS`, `DEFAULT_BLANK_ID`, `getBlank` from `@/lib/blanks`.
- `minRetailPrice(): number` keeps its exact current signature and return value.

### Steps

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/__tests__/pricing.test.ts` (read the file first and match its existing `describe`/`it` style and imports):

```ts
describe("cheapestActiveBlank", () => {
  it("agrees with minRetailPrice on the amount", () => {
    expect(cheapestActiveBlank().price).toBe(minRetailPrice());
  });

  it("names a blank that is actually sold at that price", () => {
    const { blankId, price } = cheapestActiveBlank();
    const blank = getBlankOrThrow(blankId);
    const prices = blank.sizes.map((s) => computePrice(0, blankId, s).total);
    expect(Math.min(...prices)).toBe(price);
  });

  it("is the Classic Tee at $19.43 today", () => {
    // Pins the copy the Shop card renders. If a cheaper blank is added this
    // fails, which is the point: the card's garment name follows the price.
    expect(cheapestActiveBlank()).toEqual({
      blankId: "bella-canvas-3001",
      price: 19.43,
    });
  });
});

describe("cardPriceLine", () => {
  it("falls back to the cheapest active blank when no garment is fixed", () => {
    expect(cardPriceLine(null).text).toBe("From $19.43 · Classic Tee");
    expect(cardPriceLine(undefined)).toEqual(cardPriceLine(null));
  });

  it("uses a fixed blank's own floor price and name", () => {
    const line = cardPriceLine("cotton-heritage-mc1087");
    expect(line.garment).toBe("Box Tee");
    expect(line.amount).toBe(26.18);
    expect(line.text).toBe("From $26.18 · Box Tee");
  });

  it("always says From, because a card shows no size", () => {
    // Classic Tee is $19.43 on S-XL and $21.43 on 2XL; a bare price would be
    // false for one of them.
    expect(cardPriceLine("bella-canvas-3001").text).toMatch(/^From \$/);
  });

  it("falls back rather than throwing on an unknown blank id", () => {
    // A card must never take the whole feed down over a stale id.
    expect(cardPriceLine("no-such-blank")).toEqual(cardPriceLine(null));
  });

  it("formats to exactly two decimals", () => {
    expect(cardPriceLine(null).text).toContain("$19.43");
    expect(cardPriceLine(null).text).not.toContain("19.430");
  });
});
```

Add whatever imports these need to the file's existing import block (`cheapestActiveBlank`, `cardPriceLine`, `computePrice`, `minRetailPrice` from `@/lib/pricing`; `getBlankOrThrow` from `@/lib/blanks`).

Run `npx vitest run src/lib/__tests__/pricing.test.ts` and confirm the new tests fail to import / fail on the new names. **Do not proceed until you have seen them fail.**

- [ ] **Step 2: Implement**

In `src/lib/pricing.ts`, add `getBlank` to the existing `./blanks` import. Then replace the current `minRetailPrice` block with:

```ts
/**
 * The cheapest thing in the catalog, and which blank it is. Both halves come
 * from one scan so a caller can never quote a price from blank A next to the
 * name of blank B — the failure mode a Shop card would show as
 * "From $18.00 · Classic Tee" the day a cheaper blank is added.
 *
 * Ties break toward DEFAULT_BLANK_ID, then catalog order, so the default
 * garment keeps its name when a new blank matches its price.
 */
export function cheapestActiveBlank(): { blankId: string; price: number } {
  let bestId = DEFAULT_BLANK_ID;
  let best = Infinity;
  for (const blank of ACTIVE_BLANKS) {
    for (const size of blank.sizes) {
      const { total } = computePrice(0, blank.id, size);
      const wins =
        total < best ||
        (total === best && blank.id === DEFAULT_BLANK_ID && bestId !== DEFAULT_BLANK_ID);
      if (wins) {
        best = total;
        bestId = blank.id;
      }
    }
  }
  return { blankId: bestId, price: best };
}

/**
 * Cheapest customer-facing price across the active catalog (any blank, any
 * size, front only). Derived from the same computePrice the checkout charges,
 * so marketing copy like the landing's "Tees from $X" can never go stale.
 * (Lives here rather than blanks.ts because it needs the margin computation,
 * and blanks.ts importing pricing.ts would be circular.)
 */
export function minRetailPrice(): number {
  return cheapestActiveBlank().price;
}

export type ShopCardPrice = {
  /** Dollars, cent precision. The floor across the garment's sizes. */
  amount: number;
  /** Display name of the garment the amount belongs to. */
  garment: string;
  /** The rendered line: `From $19.43 · Classic Tee`. */
  text: string;
};

/**
 * The one line a Shop card says about money (Paper slice 6).
 *
 * A composition either fixes a garment (`blankId`) or leaves the buyer to
 * pick one; every PRNTD Shop mirror row is the latter today
 * (model-b-writes.ts writes `blankId: null`), so the fallback is the normal
 * path, not an edge case. Either way the amount is a *floor* — a card shows
 * no size, and a blank's price varies by size — hence "From".
 *
 * Pure and catalog-driven: the amount comes from the same `computePrice` the
 * checkout charges through, so the card and the till cannot disagree. An
 * unknown blank id falls back rather than throwing; one stale id must not
 * take down the whole feed.
 */
export function cardPriceLine(
  blankId: string | null | undefined
): ShopCardPrice {
  const blank = blankId ? getBlank(blankId) : undefined;
  if (!blank) {
    const { blankId: cheapestId, price } = cheapestActiveBlank();
    const cheapest = getBlankOrThrow(cheapestId);
    return {
      amount: price,
      garment: cheapest.name,
      text: `From $${price.toFixed(2)} · ${cheapest.name}`,
    };
  }
  const amount = Math.min(
    ...blank.sizes.map((size) => computePrice(0, blank.id, size).total)
  );
  return {
    amount,
    garment: blank.name,
    text: `From $${amount.toFixed(2)} · ${blank.name}`,
  };
}
```

`getBlankOrThrow` is already imported in this file. Note `getBlank` returns `Blank | undefined` — a discontinued blank still resolves through it, which is deliberate: a historical fixed composition should name the garment it actually is.

- [ ] **Step 3: Verify**

```
npx vitest run src/lib/__tests__/pricing.test.ts
npm run typecheck
```
Both green. Confirm the pre-existing `minRetailPrice` tests still pass unchanged — if any needed editing, stop and report rather than editing them.

- [ ] **Step 4: Commit** — `feat(pricing): cheapestActiveBlank + cardPriceLine for the Shop card`

---

## Task 2: carry the composition's garment through the feed read

**Files:**
- Modify: `src/lib/discover-feed.ts` (`FeedRow` + the `getPublishedFeed` select)
- Modify: `src/app/d/actions.ts` (`PublishedImage` type + the `getDiscoverFeed` map — **these two spots only**; keep the diff minimal, a sibling slice may touch this file)
- Test: `src/lib/__tests__/discover-feed.integration.test.ts` (extend)

**Interfaces:**
- `FeedRow` gains `blankId: string | null`.
- `PublishedImage` gains `blankId?: string | null` (Ruling 3).
- `orderFeedByRank` / `compareFeedOrder` / the one-card-per-design dedupe rule are unchanged — do not touch their logic.

### Steps

- [ ] **Step 1: Write the failing test**

Read `src/lib/__tests__/discover-feed.integration.test.ts` first — it seeds real rows against the in-memory libSQL harness. Add a test in the existing `describe("getPublishedFeed (real DB)")` block, reusing that file's seed helpers rather than inventing new ones:

```ts
it("carries the mirror product's blank id, null when the buyer picks", async () => {
  // Every Shop mirror is written with blank_id NULL (model-b-writes.ts), so
  // the null case is the production path; the fixed case is what composition
  // slice 5+ will start writing.
  const feed = await getPublishedFeed();
  expect(feed.length).toBeGreaterThan(0);
  for (const row of feed) {
    expect(row).toHaveProperty("blankId");
  }
  expect(feed.every((r) => r.blankId === null)).toBe(true);
});
```

Then add a second test that updates one seeded mirror `product` row's `blank_id` to `"cotton-heritage-mc1087"` (use the harness's `db` + drizzle `update`, matching how other tests in that file mutate seeded rows) and asserts that image's feed row comes back with that value. If the file's seed helpers make identifying one row awkward, seed a dedicated row instead — do not weaken the assertion to "some row has a non-null blankId".

Run the file, see it fail on the missing property.

- [ ] **Step 2: Implement `src/lib/discover-feed.ts`**

Add to the `FeedRow` type, after `backgroundColor`:

```ts
  /**
   * The garment this composition fixes, or null when the buyer picks one.
   * Null on every Shop mirror today (model-b-writes.ts writes blankId: null);
   * the field exists because the Shop card names the garment it prices.
   */
  blankId: string | null;
```

Add `blankId: productTable.blankId,` to the `.select({...})` object in `getPublishedFeed`, next to `backgroundColor`. Nothing else changes — the row already comes from `productTable`, so there is no new join and no new query cost. The trailing `.map()` spreads `...r`, so the field flows through untouched.

- [ ] **Step 3: Implement `src/app/d/actions.ts`**

Two edits, nothing else in the file.

(a) In the `PublishedImage` type, after `backgroundColor`:

```ts
  /**
   * The garment a composition fixes; absent or null means the buyer picks one
   * (every Shop mirror row today). Optional because ImagePage derives from
   * this type and the image detail page has a real per-size buy panel — it has
   * no card price line to render, so getImagePage does not supply it. To
   * cardPriceLine, undefined and null mean the same thing.
   */
  blankId?: string | null;
```

(b) In `getDiscoverFeed`'s `rows.map(...)`, add `blankId: r.blankId,` next to `backgroundColor`.

- [ ] **Step 4: Verify**

```
npx vitest run src/lib/__tests__/discover-feed.integration.test.ts
npm run typecheck
```
Green. `getImagePage` must still typecheck untouched — if it does not, you have made `blankId` required; go back to Ruling 3.

- [ ] **Step 5: Commit** — `feat(feed): carry the composition's blank id into the Shop feed row`

---

## Task 3: Shop card anatomy and grid density in `PublishedGrid`

**Files:**
- Modify: `src/components/published-grid.tsx`
- Test: `src/components/__tests__/published-grid.test.tsx` (new)

**Interfaces:**
- `PublishedGrid({ images, from })` keeps its exact current props. `data-testid="published-grid"` stays on the same grid `<div>` (Ruling 5).
- Consumes `cardPriceLine` from `@/lib/pricing` and `publishedBackdrop` from `@/lib/blanks` (already imported).

### Steps

- [ ] **Step 1: Write the failing tests**

New file `src/components/__tests__/published-grid.test.tsx`. Model the setup on `src/components/__tests__/side-mockup.test.tsx` (read it for the repo's Testing Library conventions). No `next/image` mock — see the grounding spike.

```tsx
/**
 * Shop card anatomy (Paper slice 6, #188). The card sells a shirt: art on its
 * pinned backdrop in a hairline frame, then title, then what it costs and on
 * what garment, then the maker.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PublishedGrid } from "@/components/published-grid";
import type { PublishedImage } from "@/app/d/actions";

function img(over: Partial<PublishedImage> = {}): PublishedImage {
  return {
    imageId: "i1",
    imageUrl: "https://example.com/a.png",
    title: "Dapper Whale",
    description: null,
    backgroundColor: null,
    designerName: "Nico",
    designerId: "u1",
    isOwn: false,
    publishedAt: new Date("2026-09-01T00:00:00Z"),
    forkChain: [],
    ...over,
  };
}

describe("PublishedGrid", () => {
  it("prices the card by its garment", () => {
    render(<PublishedGrid images={[img()]} />);
    expect(screen.getByText("From $19.43 · Classic Tee")).toBeTruthy();
  });

  it("prices a composition that fixes a garment off that garment", () => {
    render(<PublishedGrid images={[img({ blankId: "cotton-heritage-mc1087" })]} />);
    expect(screen.getByText("From $26.18 · Box Tee")).toBeTruthy();
  });

  it("falls back to Untitled rather than dropping the title line", () => {
    render(<PublishedGrid images={[img({ title: null })]} />);
    expect(screen.getByText("Untitled")).toBeTruthy();
  });

  it("attributes the maker, and says 'by you' for the viewer's own", () => {
    render(<PublishedGrid images={[img(), img({ imageId: "i2", isOwn: true })]} />);
    expect(screen.getByText("by Nico")).toBeTruthy();
    expect(screen.getByText("by you")).toBeTruthy();
  });

  it("paints the pinned backdrop, defaulting a legacy null to White (#76)", () => {
    const { container } = render(
      <PublishedGrid images={[img({ backgroundColor: "Black" })]} />
    );
    const well = container.querySelector("[style*='background-color']");
    expect(well?.getAttribute("style")).toContain("12, 12, 12"); // #0c0c0c
    const plain = render(<PublishedGrid images={[img({ imageId: "i9" })]} />);
    expect(
      plain.container.querySelector("[style*='background-color']")?.getAttribute("style")
    ).toContain("255, 255, 255");
  });

  it("frames the art in a hairline that goes ink on hover, not a rounded accent tile", () => {
    const { container } = render(<PublishedGrid images={[img()]} />);
    const well = container.querySelector("[style*='background-color']")!;
    expect(well.className).toContain("border-border");
    expect(well.className).toContain("group-hover:border-border-hover");
    expect(well.className).not.toContain("rounded");
    expect(well.className).not.toContain("border-accent");
    expect(well.className).not.toContain("shadow");
  });

  it("is two columns on a phone, three at sm and four at lg", () => {
    render(<PublishedGrid images={[img()]} />);
    const grid = screen.getByTestId("published-grid");
    expect(grid.className).toContain("grid-cols-2");
    expect(grid.className).toContain("sm:grid-cols-3");
    expect(grid.className).toContain("lg:grid-cols-4");
    expect(grid.className).not.toContain("md:grid-cols-4");
  });

  it("keeps the lazy-loading attributes and a sizes hint matching those columns (#134/#144)", () => {
    render(<PublishedGrid images={[img()]} />);
    const el = screen.getByRole("img");
    expect(el.getAttribute("loading")).toBe("lazy");
    expect(el.getAttribute("decoding")).toBe("async");
    // The breakpoints in `sizes` must be the grid's own, or the browser
    // fetches a 25vw source for a 33vw slot between 768 and 1023px.
    expect(el.getAttribute("sizes")).toBe(
      "(max-width: 639px) 50vw, (max-width: 1023px) 33vw, 25vw"
    );
  });

  it("records the origin on each card link so Escape returns there", () => {
    render(<PublishedGrid images={[img()]} from="/shop" />);
    expect(screen.getByRole("link").getAttribute("href")).toBe(
      "/d/i1?from=%2Fshop"
    );
  });
});
```

Run it; every card-anatomy assertion should fail against the current component.

- [ ] **Step 2: Implement**

Rewrite the body of `src/components/published-grid.tsx`. Keep the file's existing docblock and extend it; keep `data-testid="published-grid"` where it is.

- `GRID_SIZES` becomes `"(max-width: 639px) 50vw, (max-width: 1023px) 33vw, 25vw"` and its comment names the new `grid-cols-2 / sm:3 / lg:4` boundaries and says the two must change together (Ruling 4).
- Grid classes: `grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4`.
- Art well: drop `rounded-md`; `border border-border group-hover:border-border-hover group-focus-visible:border-border-hover transition-colors`, keep `relative aspect-square overflow-hidden` and the `backdrop.style` fill.
- Under it, a `mt-2 space-y-0.5` block:
  - title `<p className="text-sm font-medium text-foreground truncate">{img.title ?? "Untitled"}</p>` — `"Untitled"` is the house fallback (`studio-client.tsx`, `archive/page.tsx`, `editable-naming.tsx`).
  - price `<p className="font-mono text-[11px] leading-4 text-text-muted truncate">{cardPriceLine(img.blankId).text}</p>` — no `uppercase`/`tracking` here: it is a price, not a caps label, and letter-spaced digits read badly.
  - maker `<p className="text-[11px] leading-4 text-text-faint truncate">{img.isOwn ? "by you" : `by ${img.designerName}`}</p>`.
- The `<Link>` keeps `className="group block"`; add `focus-visible:outline-none` only if the well's focus border needs it to be visible — check, do not add cosmetics blind.

Import `cardPriceLine` from `@/lib/pricing`.

- [ ] **Step 3: Verify**

```
npx vitest run src/components/__tests__/published-grid.test.tsx
npm run lint && npm run typecheck
```
All green.

- [ ] **Step 4: Commit** — `feat(shop): Paper card anatomy — hairline frame, title, price, garment, maker`

---

## Task 4: `/shop` masthead and the homepage Shop teaser

**Files:**
- Modify: `src/app/shop/page.tsx`
- Modify: `src/app/page.tsx` (**the Shop teaser `<section>` only** — nothing above it, nothing in the footer)
- Test: `src/app/shop/__tests__/shop-page.test.tsx` (new)
- Test: `src/app/__tests__/page.test.tsx` (extend — do not weaken its existing assertions)

**Interfaces:** no exported API changes. Both pages keep `export const dynamic = "force-dynamic"`.

### Steps

- [ ] **Step 1: Read before you edit**

Read `e2e/landing.spec.ts` in full and list every `data-testid` and role selector it uses on `/`. Read `.github/workflows/prod-smoke.yml` lines 70-100. Confirm for yourself (Ruling 5) that neither depends on the teaser heading text or the "See all" link. If either does, stop and report before touching `page.tsx`.

- [ ] **Step 2: Write the failing tests**

New `src/app/shop/__tests__/shop-page.test.tsx`. The page is an async server component; call it and render the returned element, mocking its one data dependency:

```tsx
/**
 * The Shop masthead is a mono label, not a centred display heading, and it no
 * longer carries the sub-line "Designs published by other makers." — the Shop
 * sells shirts, not art (docs/object-model-composition.md).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/app/d/actions", () => ({ getDiscoverFeed: vi.fn(async () => []) }));

const { getDiscoverFeed } = await import("@/app/d/actions");
const { default: ShopPage } = await import("../page");

describe("/shop", () => {
  it("says nothing about makers publishing designs", async () => {
    render(await ShopPage());
    expect(screen.queryByText(/published by other makers/i)).toBeNull();
  });

  it("heads the page with a mono label, not a display heading", async () => {
    render(await ShopPage());
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe("Shop");
    expect(h1.className).toContain("font-mono");
    expect(h1.className).toContain("uppercase");
    expect(h1.className).not.toContain("text-3xl");
    expect(h1.className).not.toContain("text-center");
  });

  it("shows the shared empty state when nothing is published", async () => {
    render(await ShopPage());
    expect(screen.getByTestId("empty-state").textContent).toContain(
      "No published designs yet."
    );
  });

  it("renders the grid when the feed has rows", async () => {
    vi.mocked(getDiscoverFeed).mockResolvedValueOnce([
      {
        imageId: "i1",
        imageUrl: "https://example.com/a.png",
        title: "Whale",
        description: null,
        backgroundColor: null,
        blankId: null,
        designerName: "Nico",
        designerId: "u1",
        isOwn: false,
        publishedAt: new Date(),
        forkChain: [],
      },
    ]);
    render(await ShopPage());
    expect(screen.getByTestId("published-grid")).toBeTruthy();
    expect(screen.getByText("From $19.43 · Classic Tee")).toBeTruthy();
  });
});
```

Note the shop page imports `getDiscoverFeed` via the relative path `"../d/actions"`; the `vi.mock` factory must be registered under the specifier that resolves to the same module — mirror how `src/app/__tests__/page.test.tsx` mocks `"@/app/d/actions"` and confirm the mock actually takes effect (the empty-state test proves it: an unmocked call would hit the DB and throw).

Extend `src/app/__tests__/page.test.tsx` with a teaser test. Keep every existing assertion exactly as it is — that file pins the "no session read, no redirect" decision and is not yours to relax:

```tsx
it("heads the Shop teaser with the same mono label and an underlined See all", async () => {
  vi.mocked(getDiscoverFeed).mockResolvedValueOnce([
    /* one PublishedImage, same shape as the shop-page test */
  ]);
  const { container } = render(await Home());
  const h2 = screen.getByRole("heading", { level: 2, name: "Shop" });
  expect(h2.className).toContain("font-mono");
  expect(h2.className).not.toContain("text-2xl");
  const seeAll = screen.getByRole("link", { name: /See all/ });
  expect(seeAll.getAttribute("href")).toBe("/shop");
  expect(seeAll.className).toContain("underline");
});
```

That file currently calls `Home()` without rendering (deliberately, per its docblock). Rendering it now pulls in `MakerHero` — check whether that renders cleanly in jsdom. If it does not, **do not stub MakerHero**: put this assertion in a separate new file that renders `Home` with `@/components/maker-hero` mocked to a stub, and leave `page.test.tsx`'s decision test untouched and un-rendered. Report which route you took.

Run both files, see them fail.

- [ ] **Step 3: Implement `src/app/shop/page.tsx`**

Replace the `<header>` block with a left-aligned mono masthead and drop the sub-line entirely (no replacement sentence — spec item 1):

```tsx
      <div className="max-w-6xl mx-auto">
        <h1 className="mb-8 font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted">
          Shop
        </h1>
```

Keep `getDiscoverFeed(60)`, the `EmptyState` branch and its existing copy ("No published designs yet." — persona C, already plain) exactly as they are. Update the file's docblock to note the masthead decision and why the sub-line went.

- [ ] **Step 4: Implement the teaser in `src/app/page.tsx`**

Only inside `{discover.length > 0 && (<section ...>)}`. Replace the centred `<h2>` + centred "See all" with a masthead row and a left-aligned underlined link:

```tsx
        <section className="py-8 sm:py-16 px-4 border-t border-border">
          <div className="max-w-6xl mx-auto">
            <div className="mb-4 sm:mb-8 flex items-baseline justify-between gap-4">
              <h2 className="font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted">
                Shop
              </h2>
              <Link
                href="/shop"
                className="text-sm underline underline-offset-[3px] hover:text-text-muted transition-colors"
              >
                See all
              </Link>
            </div>
            <PublishedGrid images={discover} from="/" />
          </div>
        </section>
```

Two judgement calls to make explicitly and record in the ledger:
- The `→` is dropped from "See all" because the link is now underlined text in a masthead row rather than a centred button-ish affordance; if you keep it, keep it inside the link text and say why.
- `from="/"` is **new** — today the homepage teaser passes no `from`, so a card tapped from the homepage sends the detail page's Escape/up target to its default instead of back home. Adding it is a one-word fix in the slice that owns this section. If you find a reason it is deliberate (check `src/lib/nav.ts` `upTarget` and the `/d` page's `?from` handling), leave it and say so.

Do not touch `MakerHero`, the promo band, the footer, or anything else in the file.

- [ ] **Step 5: Verify**

```
npx vitest run src/app/shop/__tests__/shop-page.test.tsx src/app/__tests__/page.test.tsx
npm run lint && npm run typecheck && npm test
```
All green. Report the test count.

- [ ] **Step 6: Commit** — `feat(shop): mono masthead on /shop and the homepage teaser`

---

## Final verification (controller)

- [ ] `npm run lint` — 0 errors
- [ ] `npm run typecheck` — clean
- [ ] `npm test` — full suite green, record before/after counts
- [ ] `npm run build` — succeeds
- [ ] `git diff origin/main...HEAD --stat` — every touched file is on the allowed list in Global Constraints
- [ ] Whole-branch `opus` review (mandatory, once): stale comments in files no task diff touched, cross-task drift, anything a per-task review structurally could not see. Fix findings, re-review the fixes scoped.
- [ ] Ledger committed at `docs/superpowers/ledgers/2026-09-07-paper-shop-feed-progress.md` with every ruling.
