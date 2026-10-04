# One Buy Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every path from a design to a paid order goes through the image detail page's buy panel, its picks live in the URL, and a cart line re-opens that panel to be changed.

**Architecture:** The image detail page (`/d/[imageId]`) becomes the one buy surface. Its panel reads and writes its picks in the query string, serves the owner's unpublished images as well as published ones, and gains an edit mode that saves back to a cart line. `/preview` becomes a redirect to it and is then removed. Six slices, one PR each, in order.

**Tech Stack:** Next.js 16 App Router, server actions, Drizzle + libSQL, Stripe Checkout (embedded and hosted), Vitest + Testing Library, Playwright.

**Spec:** issue #278 (trace and proposal: https://github.com/nicolovejoy/prntd/issues/278#issuecomment-5938134088) and issue #282 (cart). Nico chose option B on 2026-10-01.

## Decisions

Ruled by Nico, 2026-10-01:

- Option B: the image detail page is the buy surface; `/preview` redirects, then goes.
- Cart edit re-opens the buy surface with the line's picks and saves to the same line (#282).

Taken as proposed with B:

- The front picker ("Change") is not carried over, on the condition that no utility is lost (Nico, 2026-10-01). Each image has its own page and swap stays, so every front/back pair is still reachable. What would be lost is changing the front without re-picking size and colour; slice 4 keeps that by carrying the picks on the links between a conversation's images.
- Colour is not remembered from the last purchase. Precedence stays URL > the design's pinned backdrop > White. (No slice changes it.)
- A quantity control is added to the cart line, 1 to 12 (Nico, 2026-10-01). (Slice 5.)
- The cart moves to embedded checkout last. (Slice 6.)

Correction to the #278 proposal: B does **not** remove the dead end for an unpublished image whose conversation was deleted. `order.design_id`, `order_item.design_id` and `cart_item.design_id` are `NOT NULL` references to `design`, and the mockup cache lives on the design row, so an image with no live conversation still cannot be ordered. Lifting that needs a schema change and is out of scope here. The panel for such an image shows no Order, as today.

## Global Constraints

- No price is written into this plan, a brief, a mock or a fixture added by this work. Tests match prices by pattern (`/\$\d/`), never by value. `src/lib/__tests__/no-preselection-price.test.ts` must stay green.
- No price is shown before the buyer has picked garment and size.
- Phone-first: 44px touch targets, no horizontal scroll at 390px.
- Copy is persona C (neutral, no whimsy). The order step is called "Order" everywhere.
- Say "image detail page" in copy, comments, PR text and messages to Nico, not "/d".
- Server actions live in the page directory's `actions.ts`; pure helpers that need tests go in `src/lib/`. `src/app/__tests__/server-action-exports.test.ts` pins the exports of `order/actions.ts`, `preview/actions.ts`, `d/actions.ts` and `shop/actions.ts`: a new or removed export in one of those must update its pin in the same commit.
- `@typescript-eslint/no-explicit-any` is an error outside tests. `catch (err)` and narrow.
- libSQL over HTTP has no interactive transactions: `db.batch`, conditional `UPDATE … WHERE`, guarded `INSERT … SELECT`.
- A `router.replace` next to a server-action call gets cancelled; URL sync uses `window.history.replaceState`, skipped when the URL already matches and once a navigation away has started (the two guards in `src/app/preview/page.tsx:373-391`).
- No random or clock-derived value in a client component's render.
- Money-path changes (slice 3, slice 5's checkout-adjacent parts, slice 6) get real-DB integration tests (`createTestDb`, factories in `src/lib/__tests__/factories.ts`) and a dedicated adversarial review.
- Gate before every PR: `npm run lint && npm run typecheck && npm test && npm run build` (build env: the dummy block in `ci.yml`'s `check` job), then `npm run e2e`. Then an independent whole-branch review. Never tell a reviewer what not to flag.
- Nico merges. Branches are `claude/278-<slice>`. No schema change is expected in any slice; if one appears, the PR is HOLD and follows the migration rules in `CLAUDE.md`.
- One smoke per message, self-contained, with distinctive strings.

## Review Focus

1. **A link carrying picks that are no longer valid** (a discontinued product, a size the product does not offer, a colour not in its palette, a back image the viewer may not use). Expected: each invalid pick is dropped on its own and the rest still apply; nothing throws and nothing is charged for a dropped back. Pinned in slice 2 task 1 (`parseBuyPagePicks`) and task 2 (`resolveInitialBack`).
2. **A guest signs up from the buy panel.** Expected: they land back on the same image detail page with the panel open and the same product, size and colour, and one tap on Order reaches checkout. Pinned in slice 2 task 4 and the `guest-funnel` Playwright spec.
3. **A buyer returns from Stripe** (hosted cancel, embedded Back, browser back). Expected: the panel is open with the picks that were sent to Stripe. Pinned in slice 2 task 4 (integration test on `cancelUrl` and `backPath`).
4. **A non-owner sends another person's unpublished image id to the checkout action.** Expected: refused, no order row, no Stripe session. Pinned in slice 3.
5. **An old `/preview?id=…` link** from an email, a bookmark or a Stripe session opened before the redirect shipped. Expected: it lands on the right image's page with the same picks; a conversation with no primary image goes to `/design?id=…` as today. Pinned in slice 4.

---

## File structure

New files:

- `src/lib/buy-page-picks.ts` — pure: parse, validate and build the image detail page's pick query string. The one place that knows the parameter names.
- `src/lib/__tests__/buy-page-picks.test.ts`
- `src/lib/cart-line-edit.ts` — pure: turn a cart line into a buy-page href, and decide which page image a line belongs to (slice 5).

Modified, by slice:

- Slice 1: `src/app/preview/page.tsx`, `src/app/design/design-stage.tsx`, `src/app/design/image-gallery.tsx`, `src/app/design/image-lightbox.tsx`, `src/app/design/mobile-gallery-strip.tsx` (comment), `src/app/d/[imageId]/buy-panel.tsx`, `src/app/cart/actions.ts`, `src/app/cart/page.tsx`, and their tests.
- Slice 2: `src/app/d/[imageId]/page.tsx`, `buy-hero.tsx`, `buy-panel.tsx`, `src/app/d/actions.ts`.
- Slice 3: `src/lib/design-publish.ts`, `src/app/d/actions.ts`, `src/app/d/[imageId]/page.tsx`.
- Slice 4: `src/lib/placement-pins.ts`, `src/app/studio/studio-client.tsx`, `src/app/design/design-client.tsx`, `src/app/preview/page.tsx` (becomes a server redirect), `e2e/*.spec.ts`.
- Slice 5: `src/app/cart/actions.ts`, `src/app/cart/page.tsx`, `src/app/d/[imageId]/buy-panel.tsx`, `page.tsx`.
- Slice 6: `src/app/preview/**` and `src/app/order/actions.ts` removed; `src/app/cart/actions.ts` (embedded).

## The URL contract (produced by slice 2, used by slices 3–5)

```
/d/<imageId>?order=1&product=<blankId>&size=<size>&color=<colour name>&back=<imageId>&swap=1&line=<cartItemId>&from=<path>
```

- `order=1`: the panel starts expanded.
- `product`, `size`, `color`: applied when valid for the catalog; precedence URL > remembered > static, the same as `/preview` (`resolveProductAndSize`, `resolveDefaultColor` in `src/lib/purchase-defaults.ts`).
- `back`: an image id for the back. Honoured only when `MULTI_PLACEMENT_ENABLED` is on, the viewer is a signed-in real user, the product has a back print area and the image passes `canUseAsPlacementSource`.
- `swap=1`: the back pick is on the front and the page image on the back. Ignored without a valid `back`.
- `line`: a cart line being edited (slice 5).
- `from`: already exists; the breadcrumb origin.

---

# Slice 1 — small fixes

Branch `claude/278-small-fixes`. No money-path change. Six tasks, each its own commit.

### Task 1.1: `/preview` puts Size above Colour

**Files:**
- Modify: `src/app/preview/page.tsx:1085-1098`
- Test: `src/app/preview/__tests__/preview-sides.test.tsx`

- [ ] **Step 1: Write the failing test** (append inside the file's top-level `describe`, or a new one)

```tsx
describe("/preview option order (#278)", () => {
  it("renders Size above Colour", async () => {
    params = new URLSearchParams(NO_BACK);
    render(<PreviewPage />);
    const size = await screen.findByText("Size");
    const colour = screen.getByText(/^Color — /);
    expect(
      size.compareDocumentPosition(colour) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/app/preview/__tests__/preview-sides.test.tsx -t "Size above Colour"`
Expected: FAIL (Colour precedes Size).

- [ ] **Step 3: Move the `SizePicker` line above the `ColorPicker` block**

```tsx
          <SizePicker sizes={sizes} value={size} onChange={setSize} label={sizeLabel} />
          <ColorPicker
            colors={colors}
            value={colorName}
            onChange={(name) => {
              colorTouched.current = true;
              handleColorChange(name);
            }}
            note={
              pinnedColor && colorName === pinnedColor
                ? "Designer's pick"
                : undefined
            }
          />
```

- [ ] **Step 4: Run the whole file**

Run: `npx vitest run src/app/preview/__tests__/preview-sides.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -am "/preview: Size above Colour (#278)"`

### Task 1.2: remove the design-size slider from `/preview`

The slider rescales the mockup only; no scale reaches checkout, the cart or fulfillment, so it can show a shirt that is not what prints.

**Files:**
- Modify: `src/app/preview/page.tsx` (state at `:161`, uses at `:518`, `:548`, `:906`, `:1017`, block at `:1037-1053`)
- Test: `src/app/preview/__tests__/preview-sides.test.tsx`

- [ ] **Step 1: Write the failing test.** The slider only renders while the hero has no mockup and none is loading, so fail the mockup fetch to reach that state.

```tsx
it("offers no design-size control (#278)", async () => {
  params = new URLSearchParams(NO_BACK);
  generateMockup.mockRejectedValue(new Error("printful down"));
  render(<PreviewPage />);
  await screen.findByText("Retry preview");
  expect(screen.queryByText("Design size")).not.toBeInTheDocument();
  expect(screen.queryByRole("slider")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run it** — `npx vitest run src/app/preview/__tests__/preview-sides.test.tsx -t "design-size"`. Expected: FAIL.

- [ ] **Step 3: Implement.** Delete the `{/* Scale slider … */}` block. Replace `const [scale, setScale] = useState(1.0);` with a module constant above the component:

```tsx
// Mockups and prints are always full size: there is no scale control, and no
// scale reaches checkout or fulfillment (#278).
const SCALE = 1.0;
```

and replace every `scale` read in the component with `SCALE` (`Math.round(SCALE * 100)`, `generateMockup(designId, colorName, productId, SCALE, side, sourceImageId)`, `artworkWidthPct={Math.round(SCALE * 62)}` in both `SideMockup` uses). Update the mockup-cache comment at `:194` that lists "scale" as a variable.

- [ ] **Step 4: Run** `npx vitest run src/app/preview && npm run typecheck`. Expected: PASS, no unused-variable errors.

- [ ] **Step 5: Commit** — `git commit -am "/preview: remove the design-size slider; it never reached the print (#278)"`

### Task 1.3: "Make Products" becomes "Order"

**Files:**
- Modify: `src/app/design/design-stage.tsx:142`, `src/app/design/image-gallery.tsx:125`, `src/app/design/image-lightbox.tsx:201`, `src/app/design/mobile-gallery-strip.tsx:8` (comment)
- Test: `src/app/design/__tests__/image-lightbox.test.tsx:215,238,255,282,289,292`

- [ ] **Step 1: Change the tests first.** Replace every `"Make Products"` in `image-lightbox.test.tsx` with `"Order"`, including the test title at `:289`.
- [ ] **Step 2: Run** `npx vitest run src/app/design/__tests__/image-lightbox.test.tsx`. Expected: FAIL (button still says Make Products).
- [ ] **Step 3: Change the copy.** `design-stage.tsx` and `image-gallery.tsx`: `Make Products &rarr;` → `Order &rarr;`. `image-lightbox.tsx`: `Make Products` → `Order`. Fix the comment in `mobile-gallery-strip.tsx`. Leave prop and handler names (`onMakeProducts`, `stage-make-products`) alone: the e2e specs use the test id.
- [ ] **Step 4: Run** `npx vitest run src/app/design && grep -rn "Make Products" src e2e` — tests PASS, grep prints nothing.
- [ ] **Step 5: Commit** — `git commit -am "Design page: the order step is called Order (#278)"`

### Task 1.4: the image detail panel shows no total until a size is picked

**Files:**
- Modify: `src/app/d/[imageId]/buy-panel.tsx:237-246`, `:331`, `:529-551`
- Test: `src/app/d/[imageId]/__tests__/buy-panel.test.tsx`

- [ ] **Step 1: Write the failing test and update the two that assumed a total**

```tsx
describe("BuyPanel price (#278)", () => {
  it("shows no total until a size is picked", () => {
    render(<BuyPanel imageId="img-1" isLoggedIn />);
    expand();
    expect(screen.queryByText("Total")).not.toBeInTheDocument();
    expect(screen.queryByText(/\$\d/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "M" }));
    expect(screen.getByText("Total")).toBeInTheDocument();
    expect(buyButton()).toHaveTextContent(/Order — \$\d/);
  });
});
```

Change the `buyButton()` helper so it finds the button with or without a total:

```tsx
function buyButton() {
  // Rendered twice (desktop inline + mobile sticky); both share state. No
  // total in the label until a size is picked (#278).
  return screen.getAllByRole("button", { name: /^Order( — \$.+)?$/ })[0];
}
```

In "tapping Order expands the picker stack in place", replace `expect(screen.getByText("Total")).toBeInTheDocument();` with `expect(screen.getByText("Size")).toBeInTheDocument();`. In the signed-out test, change the absence check to `screen.queryByRole("button", { name: /^Order( — \$.+)?$/ })`.

- [ ] **Step 2: Run** `npx vitest run "src/app/d/[imageId]/__tests__/buy-panel.test.tsx"`. Expected: the new test FAILS.

- [ ] **Step 3: Implement.** Compute prices only with a size:

```tsx
  // No number before a size is picked (owner rule, 2026-09-08): the total
  // depends on it. The Design line stays the front-only price; a picked back
  // design adds its own line. A swap never moves the price.
  const priced = size
    ? {
        front: computePrice(0, productId, size).total,
        ...computeOrderTotal(
          computePrice(0, productId, size, { back: !!sides.back }).total
        ),
      }
    : null;
```

Remove `sizeForPrice`, `frontPrice`, `shipping`, `total`. The CTA label becomes `{loading ? "Redirecting…" : priced ? \`Order — $${priced.total.toFixed(2)}\` : "Order"}`. Wrap the Price block in `{priced && ( … )}` and read `priced.front`, `priced.shipping`, `priced.total` inside it. Rewrite the comment at `:237-239`.

- [ ] **Step 4: Run** `npx vitest run "src/app/d/[imageId]" src/lib/__tests__/no-preselection-price.test.ts && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "Image detail page: no total until a size is picked (#278)"`

### Task 1.5: a cart line shows the back design (#282)

**Files:**
- Modify: `src/app/cart/actions.ts:50-62` (`CartLine`), `:270-300` (`getCart`); `src/app/cart/page.tsx:144-156`
- Test: `src/app/cart/__tests__/add-to-cart-swap.integration.test.ts`, `src/app/cart/__tests__/cart-page.test.tsx`

**Interfaces:**
- Produces: `CartLine.backImageUrl: string | null` (slice 5 reads it too).

- [ ] **Step 1: Failing integration test.** In `add-to-cart-swap.integration.test.ts`, in the test that proves the swapped line's thumbnail, add after the existing `imageUrl` assertion:

```ts
    // The back is the page image after a swap (#282): the cart shows it too.
    expect(view.items[0].backImageUrl).toBe("https://img.example/listing.png");
```

and in a test with a one-sided line add `expect(view.items[0].backImageUrl).toBeNull();`. (Use the variable name the test already binds `getCart()`'s result to.)

- [ ] **Step 2: Failing page test.** In `cart-page.test.tsx` add `backImageUrl: null` to the `ONE_ITEM` line, then:

```tsx
it("shows the back design beside the front on a two-sided line (#282)", async () => {
  getCart.mockResolvedValue({
    ...ONE_ITEM,
    items: [
      {
        ...ONE_ITEM.items[0],
        hasBack: true,
        imageUrl: "https://example.com/front.png",
        backImageUrl: "https://example.com/back.png",
      },
    ],
  });
  render(<CartPage />);
  const back = await screen.findByTestId("cart-line-back");
  expect(back.querySelector("img")?.getAttribute("src")).toBe(
    "https://example.com/back.png"
  );
});

it("shows one thumbnail on a front-only line", async () => {
  getCart.mockResolvedValue(ONE_ITEM_WITH_IMAGE);
  render(<CartPage />);
  await screen.findByTestId("cart-line-item");
  expect(screen.queryByTestId("cart-line-back")).not.toBeInTheDocument();
});
```

- [ ] **Step 3: Run both files.** Expected: FAIL (`backImageUrl` undefined, no `cart-line-back`).

- [ ] **Step 4: Implement.** `CartLine` gains `backImageUrl: string | null;` with the comment `/** The back design's artwork, when the line has one (#282). */`. In `getCart`, resolve fronts and backs in one call and rename the map:

```ts
  const pinnedById = await resolveImagesByIds(
    rows
      .flatMap((r) => [r.placements?.front, r.placements?.back])
      .filter((v): v is string => Boolean(v))
  );
```

use `pinnedById` for `pinnedFront`, and add to the pushed line:

```ts
      backImageUrl: r.placements?.back
        ? pinnedById.get(r.placements.back)?.imageUrl ?? null
        : null,
```

In `cart/page.tsx`, after the front thumbnail `<div>`:

```tsx
                  {item.backImageUrl && (
                    <div
                      data-testid="cart-line-back"
                      className="w-16 h-16 shrink-0 bg-surface-well border border-border overflow-hidden"
                    >
                      {/* alt="" for the same reason as the front: the text
                          beside it ("front + back") is the label. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.backImageUrl}
                        alt=""
                        className="w-full h-full object-contain"
                      />
                    </div>
                  )}
```

Check the row at 390px: two 64px thumbnails, the 16px gaps, the text column and the price column must not overflow. If the text column gets too narrow, drop both thumbnails to `w-14 h-14` on a two-sided line.

- [ ] **Step 5: Run** `npx vitest run src/app/cart && npm run typecheck`. Expected: PASS. Any other fixture that builds a `CartLine` fails typecheck until it gains `backImageUrl`; fix each.
- [ ] **Step 6: Commit** — `git commit -am "Cart: show the back design on a two-sided line (#282)"`

### Task 1.6: a Cancel under Order and Add to cart

Asked for by Nico on 2026-10-01 after the #280 smoke: on the buy surface, after Order and Add to cart, add a Cancel.

**Files:**
- Modify: `src/app/preview/page.tsx` (desktop CTA stack near `:1205-1223`, mobile sticky bar near `:1307-1337`), `src/app/d/[imageId]/buy-panel.tsx` (the `cta` block, both branches)
- Test: `src/app/preview/__tests__/preview-sides.test.tsx`, `src/app/d/[imageId]/__tests__/buy-panel.test.tsx`

Behaviour (Nico confirmed this default on 2026-10-01 when the slice started):

- `/preview`: Cancel is a link to the page's parent, the last entry of `breadcrumbTrail("/preview", { id, product })` (the same target the breadcrumb's up link uses), not `router.back()`, which leaves the site on a deep link.
- Image detail panel: Cancel collapses the panel (`setExpanded(false)`), so the hero returns to the artwork. After slice 2 it also clears the pick params from the address bar (`withBuyPagePicks(search, { order: false, product: null, size: null, color: null, back: null, swap: false })`).
- Third in the stack, under Order and Add to cart, in the desktop stack and the phone sticky bar. A text link, not a third full-width button: `min-h-11`, `text-sm underline text-text-muted`, centred. It is never disabled.

- [ ] **Step 1: Failing tests.** `/preview`: `await screen.findAllByRole("link", { name: "Cancel" })` has at least one entry and its `href` is the breadcrumb parent's. Note the source picker already has a "Cancel" **button**; query by role `link` so the two do not collide. Panel: expanded, click the Cancel button (`getAllByRole("button", { name: "Cancel" })[0]`; the back picker's own Cancel only renders while that picker is open), then `screen.getByTestId("order-expand")` is back and no size picker is shown; the signed-out branch has it too.
- [ ] **Step 2: Run both files.** Expected: FAIL.
- [ ] **Step 3: Implement** as above. On `/preview` the sticky bar grows by one 44px row: raise the page's bottom padding (`pb-40`) to match, and check at 390px that the bar does not cover the last control.
- [ ] **Step 4: Run** `npx vitest run src/app/preview "src/app/d/[imageId]" && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** — `"Buy surfaces: Cancel under Order and Add to cart (#278)"`

### Slice 1 close

- [ ] Full gate, `npm run e2e`, whole-branch review, PR "Order pipeline small fixes: Size above Colour, no slider, Order label, no total before size, cart shows the back (#278, #282)".
- [ ] Rebase or merge #274 afterwards: its open question 1 (swatches above Size) is answered by task 1.1.
- `PREVIEW_EMBEDDED_CHECKOUT_ENABLED` stays off in Production (Nico, 2026-10-01): `/preview` becomes a redirect in slice 4, so the flip is not worth making.

Smoke for Nico (after merge, on a phone):
1. Open https://prntd.org/studio, tap any design image, tap **Order**.
2. Look at the page below the shirt, without picking a size.
- PASS: Size sits above the colour swatches; there is no "Design size" slider anywhere; the bottom button says "Order" with no amount.
- FAIL: colours above Size, a slider, or an amount before a size is picked.

---

# Slice 2 — the image detail panel keeps its picks in the URL

Branch `claude/278-buy-page-picks`. The panel still serves published images only. No money moves differently; the Stripe return paths change, so task 4 has an integration test.

### Task 2.1: `buy-page-picks` (pure)

**Files:**
- Create: `src/lib/buy-page-picks.ts`
- Test: `src/lib/__tests__/buy-page-picks.test.ts`

**Interfaces:**
- Produces:

```ts
export type BuyPagePicks = {
  order: boolean;
  product: string | null; // an ACTIVE_BLANKS id, or null
  size: string | null;    // valid for `product` (or the default blank), or null
  color: string | null;   // in that blank's palette, or null
  back: string | null;    // raw image id; the server decides whether it is usable
  swap: boolean;          // only true with a back
  line: string | null;    // cart line id (slice 5)
};
export function parseBuyPagePicks(
  search: Record<string, string | string[] | undefined>
): BuyPagePicks;
export function buyPageHref(
  imageId: string,
  picks: Partial<BuyPagePicks> & { from?: string | null }
): string;
export function withBuyPagePicks(search: string, picks: Partial<BuyPagePicks>): string;
```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { ACTIVE_BLANKS, DEFAULT_BLANK_ID, getBlankOrThrow } from "@/lib/blanks";
import {
  parseBuyPagePicks,
  buyPageHref,
  withBuyPagePicks,
} from "@/lib/buy-page-picks";

const blank = getBlankOrThrow(DEFAULT_BLANK_ID);
const other = ACTIVE_BLANKS.find((b) => b.id !== DEFAULT_BLANK_ID)!;

describe("parseBuyPagePicks", () => {
  it("returns all-empty for no params", () => {
    expect(parseBuyPagePicks({})).toEqual({
      order: false, product: null, size: null, color: null,
      back: null, swap: false, line: null,
    });
  });

  it("reads a full, valid link", () => {
    const picks = parseBuyPagePicks({
      order: "1", product: other.id, size: other.sizes[0],
      color: other.colors[0].name, back: "img-b", swap: "1", line: "line-1",
    });
    expect(picks).toEqual({
      order: true, product: other.id, size: other.sizes[0],
      color: other.colors[0].name, back: "img-b", swap: true, line: "line-1",
    });
  });

  it("drops an unknown product and validates size and colour against the default blank", () => {
    const picks = parseBuyPagePicks({
      product: "discontinued-tee", size: blank.sizes[0], color: blank.colors[0].name,
    });
    expect(picks.product).toBeNull();
    expect(picks.size).toBe(blank.sizes[0]);
    expect(picks.color).toBe(blank.colors[0].name);
  });

  it("drops a size the product does not offer, keeps the rest", () => {
    const picks = parseBuyPagePicks({ product: blank.id, size: "9XL", color: blank.colors[0].name });
    expect(picks).toMatchObject({ product: blank.id, size: null, color: blank.colors[0].name });
  });

  it("drops a colour outside the palette", () => {
    expect(parseBuyPagePicks({ product: blank.id, color: "Plaid" }).color).toBeNull();
  });

  it("ignores swap without a back", () => {
    expect(parseBuyPagePicks({ swap: "1" }).swap).toBe(false);
  });

  it("takes the first value of a repeated param and ignores empty strings", () => {
    const picks = parseBuyPagePicks({ size: [blank.sizes[0], "9XL"], back: "" });
    expect(picks.size).toBe(blank.sizes[0]);
    expect(picks.back).toBeNull();
  });

  it("rejects ids with characters an id never has", () => {
    expect(parseBuyPagePicks({ back: "a b/../c" }).back).toBeNull();
    expect(parseBuyPagePicks({ line: "x".repeat(200) }).line).toBeNull();
  });
});

describe("buyPageHref", () => {
  it("is the bare page with no picks", () => {
    expect(buyPageHref("img-1", {})).toBe("/d/img-1");
  });

  it("writes picks in a fixed order and encodes them", () => {
    expect(
      buyPageHref("img-1", {
        order: true, product: blank.id, size: "M", color: "Heather Grey",
        back: "img-b", swap: true, from: "/designs",
      })
    ).toBe(
      `/d/img-1?order=1&product=${blank.id}&size=M&color=Heather+Grey&back=img-b&swap=1&from=%2Fdesigns`
    );
  });

  it("round-trips through parseBuyPagePicks", () => {
    const picks = { order: true, product: blank.id, size: blank.sizes[1], color: blank.colors[1].name, back: "img-b", swap: true, line: null };
    const href = buyPageHref("img-1", picks);
    const parsed = parseBuyPagePicks(
      Object.fromEntries(new URL(href, "http://x.invalid").searchParams)
    );
    expect(parsed).toEqual(picks);
  });
});

describe("withBuyPagePicks", () => {
  it("replaces pick params and keeps the others", () => {
    expect(
      withBuyPagePicks("?from=%2Fshop&size=S&back=old", { order: true, size: "L", back: null })
    ).toBe("?from=%2Fshop&order=1&size=L");
  });

  it("returns an empty string when nothing is left", () => {
    expect(withBuyPagePicks("?size=S", { size: null })).toBe("");
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/lib/__tests__/buy-page-picks.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
/**
 * The image detail page's buy-panel picks as a query string (#278). The one
 * place that knows the parameter names: the page parses with
 * `parseBuyPagePicks`, the panel keeps the address bar in step with
 * `withBuyPagePicks`, and every link into the panel (sign-in return, Stripe
 * cancel, the cart's Edit) is built by `buyPageHref`.
 *
 * Parsing validates against the catalog only. Whether a `back` image may be
 * printed for this viewer is a server decision (`resolveInitialBack`), not
 * made here. No DB access.
 */
import { ACTIVE_BLANKS, DEFAULT_BLANK_ID, getBlankOrThrow } from "@/lib/blanks";

export type BuyPagePicks = {
  order: boolean;
  product: string | null;
  size: string | null;
  color: string | null;
  back: string | null;
  swap: boolean;
  line: string | null;
};

type Search = Record<string, string | string[] | undefined>;

// Image and cart-line ids are UUIDs; legacy image ids are short slugs.
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function first(search: Search, key: string): string | null {
  const raw = search[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value ? value : null;
}

function id(search: Search, key: string): string | null {
  const value = first(search, key);
  return value && ID_RE.test(value) ? value : null;
}

export function parseBuyPagePicks(search: Search): BuyPagePicks {
  const urlProduct = first(search, "product");
  const blank = ACTIVE_BLANKS.find((b) => b.id === urlProduct);
  // Size and colour validate against the product the link names, or the
  // default blank when it names none (or a discontinued one). The panel
  // re-validates against a remembered product if that wins.
  const palette = blank ?? getBlankOrThrow(DEFAULT_BLANK_ID);
  const size = first(search, "size");
  const color = first(search, "color");
  const back = id(search, "back");
  return {
    order: first(search, "order") === "1",
    product: blank ? blank.id : null,
    size: size && palette.sizes.includes(size) ? size : null,
    color: color && palette.colors.some((c) => c.name === color) ? color : null,
    back,
    swap: !!back && first(search, "swap") === "1",
    line: id(search, "line"),
  };
}

const PICK_KEYS = ["order", "product", "size", "color", "back", "swap", "line"] as const;

function setPicks(params: URLSearchParams, picks: Partial<BuyPagePicks>) {
  for (const key of PICK_KEYS) {
    if (!(key in picks)) continue;
    const value = picks[key];
    if (value === true) params.set(key, "1");
    else if (typeof value === "string" && value) params.set(key, value);
    else params.delete(key);
  }
}

/** A link to the image detail page with the given picks. */
export function buyPageHref(
  imageId: string,
  picks: Partial<BuyPagePicks> & { from?: string | null }
): string {
  const params = new URLSearchParams();
  setPicks(params, picks);
  if (picks.from) params.set("from", picks.from);
  const qs = params.toString();
  return qs ? `/d/${imageId}?${qs}` : `/d/${imageId}`;
}

/** `search` with the pick params replaced; other params (`from`) are kept. */
export function withBuyPagePicks(
  search: string,
  picks: Partial<BuyPagePicks>
): string {
  const params = new URLSearchParams(search);
  // Rebuild so pick params always follow the non-pick ones in a fixed order.
  const kept = new URLSearchParams();
  for (const [key, value] of params) {
    if (!(PICK_KEYS as readonly string[]).includes(key)) kept.append(key, value);
  }
  const current: Partial<BuyPagePicks> = {};
  for (const key of PICK_KEYS) {
    const value = params.get(key);
    if (value === null) continue;
    if (key === "order" || key === "swap") current[key] = value === "1";
    else current[key] = value;
  }
  setPicks(kept, { ...current, ...picks });
  const qs = kept.toString();
  return qs ? `?${qs}` : "";
}
```

- [ ] **Step 4: Run** the test file. Expected: PASS. If the fixed-order assertion in `buyPageHref` fails, the order is `PICK_KEYS` then `from`.
- [ ] **Step 5: Commit** — `git add src/lib/buy-page-picks.ts src/lib/__tests__/buy-page-picks.test.ts && git commit -m "buy-page-picks: the image detail panel's picks as a query string (#278)"`

### Task 2.2: the page parses the link and resolves the back

**Files:**
- Modify: `src/app/d/[imageId]/page.tsx` (`Search` type, `searchParams` read, `BuyHero` props), `src/app/d/actions.ts` (new export `resolveInitialBack`; add it to the `d/actions.ts` pin in `src/app/__tests__/server-action-exports.test.ts`)
- Test: `src/app/d/__tests__/resolve-initial-back.integration.test.ts` (new; harness copied from `src/app/cart/__tests__/add-to-cart-swap.integration.test.ts` — mocked `@/lib/db` getter, `@/lib/auth`, `next/headers`; `createTestDb`, `makeUser`, `makeDesign`, `makeSourceImage`)

**Interfaces:**
- Consumes: `parseBuyPagePicks` (task 2.1).
- Produces: `resolveInitialBack(pageImageId: string, backImageId: string): Promise<PlacementPick | null>` in `src/app/d/actions.ts`. Returns the back as `{ id, imageUrl }` when `MULTI_PLACEMENT_ENABLED` is on, the viewer is a signed-in real user, the page image is buyable and the back passes `assertUsablePlacementImage(backImageId, pageImage.designId, viewerId)`; otherwise `null`. Never throws for an unusable id.
- Produces: `BuyHero` and `BuyPanel` prop `initialPicks: { expanded: boolean; productId: string | null; size: string | null; color: string | null; back: PlacementPick | null; swapped: boolean }`.

- [ ] **Step 1: Failing integration tests** for `resolveInitialBack`, one `it` each: returns the pick for the buyer's own image; returns the pick for a published image owned by someone else; `null` for another user's unpublished image; `null` for an admin-hidden image; `null` when the session is anonymous; `null` with no session; `null` when `MULTI_PLACEMENT_ENABLED` is unset (set and restore `process.env.MULTI_PLACEMENT_ENABLED` in `beforeEach`/`afterEach`); `null` for an id that matches no image. Each asserts on the returned value only, for example:

```ts
it("returns null for another user's unpublished image", async () => {
  h.session = { user: { id: "buyer" } };
  expect(await resolveInitialBack(ids.listingId, ids.sellerPrivateId)).toBeNull();
});
```

- [ ] **Step 2: Run.** Expected: FAIL (no export).
- [ ] **Step 3: Implement `resolveInitialBack`** next to `getBuyPageBackSources`, with the same gates in the same order, wrapping `assertUsablePlacementImage` in `try/catch` and returning `null` on a throw; resolve the URL with `resolveImagesByIds([backImageId])`. Add the export name to the pin.
- [ ] **Step 4: Wire the page.** Widen `Search` to `Promise<Record<string, string | string[] | undefined>>`, read `from` as `typeof sp.from === "string" ? sp.from : undefined`, then:

```tsx
  const picks = parseBuyPagePicks(sp);
  const initialBack =
    isPublished && isLoggedIn && multiPlacementEnabled() && picks.back
      ? await resolveInitialBack(imageId, picks.back)
      : null;
  const initialPicks = {
    expanded: picks.order,
    productId: picks.product,
    size: picks.size,
    color: picks.color,
    back: initialBack,
    swapped: picks.swap && !!initialBack && initialBack.id !== imageId,
  };
```

and pass `initialPicks={initialPicks}` to `BuyHero`, which forwards it to `BuyPanel`.
- [ ] **Step 5: Run** the new test file, `npx vitest run src/app/__tests__/server-action-exports.test.ts`, `npm run typecheck`. Expected: PASS (typecheck fails until task 2.3 adds the prop; do 2.3 before committing if so, and commit them together).
- [ ] **Step 6: Commit** — `"Image detail page: read buy picks from the link (#278)"`

### Task 2.3: the panel starts from the link and keeps the address bar in step

**Files:**
- Modify: `src/app/d/[imageId]/buy-panel.tsx` (state initialisers `:113-141`, `:166-171`; new effect), `src/app/d/[imageId]/buy-hero.tsx` (initial `expanded`, `productId`, `colorName`, `back`, `front`)
- Test: `src/app/d/[imageId]/__tests__/buy-panel.test.tsx`, `buy-hero.test.tsx`

**Interfaces:**
- Consumes: `initialPicks` (task 2.2), `withBuyPagePicks` (task 2.1).

- [ ] **Step 1: Failing tests** (append to `buy-panel.test.tsx`)

```tsx
describe("BuyPanel picks in the URL (#278)", () => {
  const classic = getBlankOrThrow("bella-canvas-3001");
  const NONE = { expanded: false, productId: null, size: null, color: null, back: null, swapped: false };

  beforeEach(() => window.history.replaceState(null, "", "/d/img-1?from=%2Fshop"));

  it("opens expanded with the link's product, size and colour", () => {
    render(
      <BuyPanel
        imageId="img-1"
        isLoggedIn
        initialPicks={{ ...NONE, expanded: true, productId: classic.id, size: "L", color: "Black" }}
      />
    );
    expect(screen.queryByTestId("order-expand")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "L" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Color — Black")).toBeInTheDocument();
    expect(buyButton()).toBeEnabled();
  });

  it("the link beats the remembered defaults", () => {
    render(
      <BuyPanel
        imageId="img-1"
        isLoggedIn
        remembered={{ blankId: classic.id, size: "S" }}
        initialPicks={{ ...NONE, expanded: true, size: "XL" }}
      />
    );
    expect(screen.getByRole("button", { name: "XL" })).toHaveAttribute("aria-pressed", "true");
  });

  it("writes each pick to the address bar and keeps `from`", () => {
    render(<BuyPanel imageId="img-1" isLoggedIn />);
    expand();
    fireEvent.click(screen.getByRole("button", { name: "M" }));
    const params = new URLSearchParams(window.location.search);
    expect(params.get("from")).toBe("/shop");
    expect(params.get("order")).toBe("1");
    expect(params.get("size")).toBe("M");
    expect(params.get("product")).toBe(classic.id);
    expect(params.get("color")).toBeTruthy();
  });

  it("writes nothing while collapsed", () => {
    render(<BuyPanel imageId="img-1" isLoggedIn />);
    expect(window.location.search).toBe("?from=%2Fshop");
  });

  it("starts with the link's back design, swapped", () => {
    render(
      <BuyPanel
        imageId="img-1"
        imageUrl="https://img.example/page.png"
        isLoggedIn
        backEnabled
        initialPicks={{
          ...NONE,
          expanded: true,
          back: { id: "back-1", imageUrl: "https://img.example/back-1.png" },
          swapped: true,
        }}
      />
    );
    const front = within(screen.getByTestId("side-row-front")).getByAltText("Front design");
    expect(front).toHaveAttribute("src", "https://img.example/back-1.png");
  });

  it("ignores a link's back when back designs are not enabled for this viewer", () => {
    render(
      <BuyPanel
        imageId="img-1"
        isLoggedIn={false}
        initialPicks={{
          ...NONE,
          expanded: true,
          back: { id: "back-1", imageUrl: "https://img.example/back-1.png" },
        }}
      />
    );
    expect(screen.queryByTestId("side-row-back")).not.toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get("back")).toBeNull();
  });
});
```

Import `beforeEach` from vitest. In `buy-hero.test.tsx` add: rendered with `initialPicks.expanded`, the hero requests a mockup on mount (`getListingMockup` called once with the link's product and colour) and shows the mockup panel, not the plain artwork.

- [ ] **Step 2: Run.** Expected: FAIL.

- [ ] **Step 3: Implement in `buy-panel.tsx`.** Add the prop (optional, so existing callers and tests are unchanged):

```tsx
  /** Picks carried by the link (#278): the panel starts from them and keeps
   * the address bar in step, so a reload, the sign-in detour and a return
   * from Stripe all come back to the same shirt. */
  initialPicks?: {
    expanded: boolean;
    productId: string | null;
    size: string | null;
    color: string | null;
    back: BackPick | null;
    swapped: boolean;
  };
```

State initialisers, precedence link > remembered > static:

```tsx
  const [expanded, setExpanded] = useState(initialPicks?.expanded ?? false);
  const [productId, setProductId] = useState(
    () =>
      resolveProductAndSize({
        urlProduct: initialPicks?.productId ?? null,
        urlSize: initialPicks?.size ?? null,
        remembered: remembered ?? null,
      }).productId
  );
  const [size, setSize] = useState<string | null>(
    () =>
      resolveProductAndSize({
        urlProduct: initialPicks?.productId ?? null,
        urlSize: initialPicks?.size ?? null,
        remembered: remembered ?? null,
      }).size
  );
  const [color, setColor] = useState<string>(
    () =>
      resolveDefaultColor({
        urlColor: initialPicks?.color ?? null,
        pinnedColor: preferredColor ?? null,
        palette: getBlank(productId)?.colors ?? [],
      }).color
  );
  const [back, setBack] = useState<BackPick | null>(
    () => (backEnabled ? initialPicks?.back ?? null : null)
  );
  const [swapped, setSwapped] = useState(
    () => backEnabled && !!initialPicks?.back && !!initialPicks?.swapped
  );
```

(import `resolveProductAndSize`; `pinnedColorApplied` becomes `color === preferredColor && !!preferredColor`, so a link colour is not labelled the designer's pick.) The URL sync, after the report effects:

```tsx
  // Set the moment a navigation away starts (checkout, add to cart, sign-in):
  // a late state change must not rewrite history after that (#101).
  const navigatingAway = useRef(false);

  // Keep the picks in the address bar (#278). replaceState, not
  // router.replace: a router.replace next to a server-action call gets
  // cancelled. Nothing is written while collapsed, so a browsing visitor's
  // URL stays the bare page.
  useEffect(() => {
    if (!expanded || navigatingAway.current) return;
    const next =
      window.location.pathname +
      withBuyPagePicks(window.location.search, {
        order: true,
        product: productId,
        size,
        color,
        back: back?.id ?? null,
        swap: swapped && !!back,
      });
    if (next === window.location.pathname + window.location.search) return;
    window.history.replaceState(window.history.state, "", next);
  }, [expanded, productId, size, color, back, swapped]);
```

Set `navigatingAway.current = true` at the top of `handleBuy` and `handleAddToCart` and reset it to `false` in each `catch`.

- [ ] **Step 4: Implement in `buy-hero.tsx`.** Accept and forward `initialPicks`; seed `expanded` from it. The panel's report effects fire on mount and bring `productId`, `colorName`, `back` and `front` into line, so the hero's own initial values only need `expanded`.
- [ ] **Step 5: Run** `npx vitest run "src/app/d/[imageId]" && npm run typecheck`. Expected: PASS, including every pre-existing test.
- [ ] **Step 6: Commit** — `"Image detail panel: start from the link's picks and keep them in the address bar (#278)"`

### Task 2.4: sign-in and Stripe come back to the same shirt

**Files:**
- Modify: `src/app/d/[imageId]/buy-panel.tsx:266`, `:341`; `src/app/d/actions.ts` (`buyPublishedDesign`: `cancelUrl`, `embedded.backPath`)
- Test: `buy-panel.test.tsx`; `src/app/d/__tests__/buy-return-paths.integration.test.ts` (new; same harness, with the `@/lib/stripe` mock that records `sessions.create` params, as in `add-to-cart-swap.integration.test.ts`)

**Interfaces:**
- Consumes: `buyPageHref` (task 2.1).

- [ ] **Step 1: Failing panel tests**

```tsx
it("Sign in to buy carries the picks through sign-in (#278)", () => {
  window.history.replaceState(null, "", "/d/img-1");
  render(<BuyPanel imageId="img-1" isLoggedIn={false} />);
  expand();
  fireEvent.click(screen.getByRole("button", { name: "L" }));
  const href = screen.getAllByRole("link", { name: "Sign in to buy" })[0].getAttribute("href")!;
  const next = new URL(href, "http://x.invalid").searchParams.get("next")!;
  expect(next.startsWith("/d/img-1?")).toBe(true);
  const picks = new URL(next, "http://x.invalid").searchParams;
  expect(picks.get("order")).toBe("1");
  expect(picks.get("size")).toBe("L");
});
```

(The size picker must be reachable for a signed-out visitor; it already is.)

- [ ] **Step 2: Failing integration tests** on `buyPublishedDesign` for a published image bought with product, size, colour and a back: (a) hosted — the recorded Stripe params' `cancel_url` ends with `buyPageHref(imageId, { order: true, product, size, color, back })`; (b) with a swap, the path carries `swap=1`; (c) embedded (set the env the existing embedded tests set) — the returned `url` is `/checkout?session=…&from=` followed by the encoded same path; (d) with `MULTI_PLACEMENT_ENABLED` off, the path has no `back`.
- [ ] **Step 3: Run.** Expected: FAIL.
- [ ] **Step 4: Implement.** In the panel, one helper used by both the link and the `needsAuth` branch:

```tsx
  const signInHref = `/sign-in?next=${encodeURIComponent(
    buyPageHref(imageId, {
      order: true,
      product: productId,
      size,
      color,
      back: back?.id ?? null,
      swap: swapped && !!back,
    })
  )}`;
```

`<Link href={signInHref}>` and `window.location.href = signInHref`. In `buyPublishedDesign`, build the return path from the values the action validated (never from a client-sent path):

```ts
  const returnPath = buyPageHref(params.imageId, {
    order: true,
    product: resolvedProductId,
    size: params.size,
    color: params.color,
    back: backImageId,
    swap: frontSwapped,
  });
```

then `cancelUrl: \`${process.env.NEXT_PUBLIC_APP_URL}${returnPath}\`` and `backPath: returnPath`. Replace the comment that says this page keeps no placement state in its URL. `from` is deliberately not carried: the breadcrumb falls back to Shop.
- [ ] **Step 5: Run** `npx vitest run src/app/d src/app/checkout src/lib/__tests__/embedded-checkout*.test.ts && npm run typecheck`. Expected: PASS. `safeCheckoutReturnPath` accepts a path with a query string; if an embedded-checkout test pinned `/d/<id>` exactly, update it to the new path.
- [ ] **Step 6: Commit** — `"Image detail page: sign-in and Stripe return to the same picks (#278)"`

### Slice 2 close

- [ ] Extend `e2e/guest-funnel.spec.ts`: a guest opens a published image, taps Order, picks a size, taps Sign in to buy, signs up, and lands on the image detail page with the panel open and the size still selected.
- [ ] Full gate, `npm run e2e`, whole-branch review (name Review Focus 1–3 to the reviewer as things to probe, not as things already handled), PR.

Smoke for Nico (after merge, on a phone, signed out):
1. Open https://prntd.org/shop and tap any design.
2. Tap **Order**, tap size **L**, pick any colour that is not the one already selected, then tap **Sign in to buy** and sign in.
- PASS: you land back on the same design with the options open, L selected and the colour you picked; one tap on Order opens checkout.
- FAIL: the options are closed, or the size or colour is gone.

---

# Slices 3–6

Each gets its own task-level plan, written when the slice before it has merged, because each one edits files the earlier slices will have changed. What is fixed now is the scope, the interfaces and the tests each must carry.

## Slice 3 — the owner orders an unpublished image through the panel (money path)

Branch `claude/278-owner-buy`. Confirm with Nico before starting: the front picker does not come over.

- `src/lib/design-publish.ts`: add `canBuyImage({ image, imageOwnerId, userId })` — `canBuyPublishedImage(image)`, or `userId === imageOwnerId && !image.isHidden`. `canBuyPublishedImage` stays for callers that mean "anyone".
- `src/app/d/actions.ts`: `buyPublishedDesign` and `getBuyPageBackSources` gate on `canBuyImage`. For an unpublished image there is no Shop composition: skip `requireMirrorProduct` and pass no `storeProductId` (the shape `/preview` orders have today). A published image still requires its mirror product. Keep the export names; they are pinned.
- `src/app/d/[imageId]/page.tsx`: the unpublished-owner branch renders `BuyHero` (with `canEdit={false}`: no backdrop picker without a listing) instead of the link to `/preview`, when the image has a live conversation (`img.sourceDesignId && img.hasSourceConversation`). Without one, no Order, as today.
- A guest owns their unpublished images as an anonymous user: the panel shows Sign in to buy; after sign-in `reparentUserData` moves the image to the real account and the page returns with its picks (slice 2).
- Real-DB integration tests, each asserting on `order`, `order_item` and the recorded Stripe params: owner buys own unpublished image (order written, `placements.front` is the image, `store_product_id` null, `design_id` the image's conversation); owner with a back and with a swap; non-owner sends the same id (throws, zero `order` rows, zero Stripe calls — Review Focus 4); anonymous owner (returns `needsAuth`, nothing written); image admin-hidden (throws); published image still books its `store_product_id`; the webhook claims the new order and books `sale` + `stripe_fee`; fulfillment submits the pinned image.
- Dedicated adversarial review of the money path before the PR. The nightly Stripe e2e gains one purchase of an unpublished image through the panel.

## Slice 4 — every entry point opens the image detail page; `/preview` redirects

Branch `claude/278-repoint`.

- `src/lib/placement-pins.ts`: `previewOrderHref` is replaced by `buyPageHref(imageId, { order: true })` at its two callers (`src/app/studio/studio-client.tsx:1632`, the image detail page's own former link). The Studio lightbox keeps its `lane.cells.some((c) => c.isPrimary)` condition only if `/design` still needs it; the image page needs just a live conversation.
- `src/app/design/design-client.tsx:763-777`: "Order" goes to the selected image's page (`buyPageHref(imageId, { order: true, product })`); `selectImage` is still called so the conversation's primary follows the pick.
- My Designs tiles are unchanged (they already open the image detail page); the page now has Order in place.
- `src/app/d/[imageId]/conversation-images.tsx:71`: while the panel is open, the links to the conversation's other images carry the current picks (`buyPageHref(otherImageId, { order: true, product, size, color, from })`), so switching the front to a sibling image keeps product, size and colour. This replaces `/preview`'s front picker. The back pick is carried too unless the sibling is the back image itself. Page test: with the panel open at size L, a sibling link's href has `order=1` and `size=L`; collapsed, it is the bare link.
- `src/app/preview/page.tsx` becomes a server component that redirects: read `id`, `front`, `product`, `size`, `color`, `back`; resolve the image as `front` or the conversation's primary (owner-checked through the existing `getDesign`); `redirect(buyPageHref(imageId, { order: true, product, size, color, back }))`. No primary → `/design?id=…`; no `id` → `/design`. `/order` already redirects to `/preview` and keeps working through it. A `front` that is not the back's swap partner needs no special case: the redirect target is the front image's own page.
- `createCheckoutSession`'s open Stripe sessions carry `/preview` cancel URLs for up to two hours after deploy; the redirect covers them (Review Focus 5). `/order/confirm` and `/checkout` are untouched.
- Playwright specs (`guest-funnel`, `cart`, `stripe-money-path`) and the nightly drive the image detail page instead of `/preview`. Expect the nightly's first run to need selector calibration, as #267's did.
- Tests: redirect unit tests for each parameter combination, including an invalid size and a `front` the viewer does not own (falls through to the page's own 404).

## Slice 5 — the cart line can be re-opened, changed, and counted (#282)

Branch `claude/282-cart-edit`. Confirm with Nico before starting: quantity control in or out.

- `src/lib/cart-line-edit.ts` (pure): `cartLinePageImage(placements)` — the image whose page edits the line: `placements.front` (after a swap the front is the picked image, and its page with `back` = the other image is the same shirt); `cartLineEditHref(line)` = `buyPageHref(pageImage, { order: true, line: line.id, product, size, color, back: placements.back ?? null })`. A line with null `placements` (legacy) gets no Edit. After a swap the front image can belong to a different conversation than the line's `design_id`; the slice's plan must decide whether `updateCartItem` re-derives `design_id` from the page image (as `addToCart` does) or the edit link opens the back image's page with `swap=1` so the line's design is unchanged. The second keeps the line's design stable and is the default.
- `src/app/cart/actions.ts`: `updateCartItem({ id, productId, size, color, back?, front? })` — owner-checked on the line's `userId`, then the same validation chain as `addToCart` (catalog, back print area, `assertUsablePlacementImage`, `resolveBuyPageFront`), then one `UPDATE … WHERE id = ? AND user_id = ?`. `setCartItemQuantity(id, quantity)` — 1 to 12, same owner guard; `checkoutCart` already multiplies by `quantity`.
- `src/app/d/[imageId]/page.tsx` + `buy-panel.tsx`: with `line` in the link and a line the viewer owns, the panel is in edit mode: primary button "Update cart" calls `updateCartItem` then hard-navigates to `/cart`; Order and Add to cart are not shown; a "Cancel" link returns to `/cart`. A `line` the viewer does not own, or one that no longer exists, is ignored and the panel behaves as a normal buy.
- `src/app/cart/page.tsx`: each line gets an **Edit** link (`cartLineEditHref`) and a quantity stepper (44px targets); the thumbnails link to the same place.
- Real-DB tests: update changes exactly one row and only for its owner; a cross-user id changes nothing; an update to a product with no back print area on a two-sided line is refused; quantity bounds; `checkoutCart` after an edit writes `order_item` rows with the edited values and the Stripe line count and amounts follow the quantity. Page tests for edit mode and for an unowned `line`.

## Slice 6 — remove `/preview`; the cart on embedded checkout

Branch `claude/278-remove-preview`, then `claude/135-cart-embedded`.

- Delete `src/app/preview/page.tsx`'s remaining client code, `createCheckoutSession` and `calculatePrice` in `src/app/order/actions.ts`, `PREVIEW_EMBEDDED_CHECKOUT_ENABLED` and its helpers, `previewOrderHref`, `withFront`, `normalizeFrontPin`, `swapPlacementPins`, and their tests; keep the `/preview` and `/order` redirects for old links. `generateMockup`, `getOrCreatePlacementRender`, `ensureMockupsPrefetched`, `getBackDesignSources` go if nothing else calls them (check each with grep; `getLastPurchaseDefaults` is still used by the image detail page and moves to `src/app/d/actions.ts` or `src/lib/`). Update the export pins, `CLAUDE.md` (routes, env vars, payment flow), `docs/stripe-e2e.md`, and remove the env var from Vercel and CI.
- Before deleting the mockup prefetch: the image detail page fetches a mockup per colour on demand. Measure first-mockup time on a phone for an unpublished image with a cold cache; if it is slow, keep a prefetch for the owner's first visit instead of deleting it.
- Cart on embedded checkout (#135 slice 4): `checkoutCart` passes `embedded` to `createStripeCheckoutForOrder` behind its own switch, `backPath: "/cart"`; `/checkout`'s review block already renders line summaries. Real-DB tests and a preview-deploy purchase before the Production switch.

---

## Order of work and gates

1. Slice 1 (no dependencies). Unblocks #274.
2. Slice 2. Needs slice 1 merged only to avoid conflicts in `buy-panel.tsx`.
3. Slice 3. Needs slice 2 (the panel's return paths). Money path: adversarial review.
4. Slice 4. Needs slice 3 in Production and Nico's smoke of an unpublished-image purchase passed.
5. Slice 5. Needs slice 2; independent of 3 and 4 for published images, but ships after 4 so Edit works for every line.
6. Slice 6. Needs a week of slice 4 in Production with no `/preview`-shaped errors in `/admin/errors`.

#249 (HELD, migration 0014) touches `src/app/d/actions.ts` and the `listing` table name; whichever merges second merges main and re-gates.
