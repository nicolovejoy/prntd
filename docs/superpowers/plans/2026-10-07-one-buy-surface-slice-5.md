# One Buy Surface — Slice 5: the cart line can be re-opened, changed and counted (#282)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A cart line gets an Edit link that re-opens the image detail page's buy panel with the line's picks loaded and saves back to the same line, and a quantity control from 1 to 12.

**Architecture:** `getCart` computes each line's edit link (`cart-line-edit.ts`, pure: which pinned image is the page image, and the href with `line=<id>`). Two new server actions in `src/app/cart/actions.ts`: `updateCartItem` (the same validation chain as `addToCart`'s image-detail-page path, then one owner-scoped `UPDATE`) and `setCartItemQuantity`. The buy panel gains an edit mode (`editingLine`): "Save to cart" replaces Order and Add to cart, Cancel returns to the cart. The page verifies the `line` belongs to the viewer before turning edit mode on. No schema change (`cart_item.quantity` exists; `checkoutCart` already multiplies by it).

**Tech Stack:** Next.js 16 App Router, server actions, Drizzle + libSQL, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/plans/2026-10-01-one-buy-surface.md` (the parent plan: Decisions, Global Constraints, URL contract, and its "Slice 5" section), issue #282, issue #278 (option B, Nico 2026-10-01). Nico's rulings for this slice: the cart re-opens the image detail page to edit a line and saves to the same line; a quantity control, 1 to 12 (2026-10-01).

## Global Constraints

Everything in the parent plan's Global Constraints applies. Restated here, with this slice's specifics:

- No price is written into this plan, a test fixture added by this slice, or a brief. Tests match prices by pattern (`/\$\d/`), never by value. `src/lib/__tests__/no-preselection-price.test.ts` must stay green.
- No price is shown before the buyer has picked garment and size. The cart line's price (a picked line) is fine; the panel's rules are unchanged.
- Phone-first: 44px touch targets (`min-h-11`, `w-11 h-11`), no horizontal scroll at 390px.
- Copy is persona C (neutral, no whimsy). Labels used by this slice, decided by Claude because Nico is away (record them in the PR body as copy to confirm): "Edit" (the cart line's link), "Save to cart" (the panel's edit-mode CTA), "Cancel" (unchanged), "Quantity" (the stepper's accessible group name), "Decrease quantity" / "Increase quantity" (the stepper buttons' `aria-label`), `UPDATE_CART_FAILED = "Couldn't save the changes to your cart."`, `CART_LINE_GONE = "This line is no longer in your cart."`.
- Say "image detail page" in copy, comments, PR text and messages to Nico, not "/d".
- Server actions live in `src/app/cart/actions.ts` (`"use server"`: async exports only; a non-exported async helper is fine). Pure helpers that need tests go in `src/lib/`. `src/app/__tests__/server-action-exports.test.ts` pins `order/actions.ts`, `preview/actions.ts`, `d/actions.ts` and `shop/actions.ts`; `cart/actions.ts` is not pinned, so no pin changes.
- `@typescript-eslint/no-explicit-any` is an error outside tests. `catch (err)` and narrow.
- libSQL over HTTP has no interactive transactions: every update is one owner-scoped `UPDATE … WHERE id = ? AND user_id = ?` with `.returning()`, never a read-then-write.
- Money path: `updateCartItem` and `setCartItemQuantity` change what `checkoutCart` charges. They get real-DB integration tests (`createTestDb`, factories in `src/lib/__tests__/factories.ts`) and the PR gets a dedicated adversarial review.
- URL sync in the panel uses `window.history.replaceState` (never `router.replace` next to a server-action call). `line` is already a pick key in `src/lib/buy-page-picks.ts`, kept by `withBuyPagePicks` when not passed and left alone by the panel's `removePicksFromUrl`.
- No random or clock-derived value in a client component's render.
- Gate before the PR: `npm run lint && npm run typecheck && npm test && npm run build` (build env: the dummy block in `ci.yml`'s `check` job), then `npm run e2e`. Then an independent whole-branch review plus the adversarial money-path review. Never tell a reviewer what not to flag.
- Nico merges. Branch `claude/278-cart-edit`. No schema change; if one appears the PR is HOLD.
- Each task is one commit. Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

Inputs the spec implies but no feature sentence names, most likely to bite first. Each is pinned to a task below.

1. **A `line` id in the URL that is not in the viewer's cart** (another user's line, a deleted line, a forged id). Expected: the page opens in plain buy mode (no edit mode), and a direct `updateCartItem`/`setCartItemQuantity` call with that id changes nothing and reports `{ ok: false, reason: "not-found" }`. Pinned in Task 2 (integration) and Task 4 (page test).
2. **The line is removed in another tab while the panel is open on it.** Expected: Save reports the line is gone (`CART_LINE_GONE`), nothing is inserted, no second line appears. Pinned in Task 2 (update of a deleted id) and Task 4 (panel notice on `ok: false`).
3. **Quantity at the bounds and out of them** (a double tap on + at 12, a hand-crafted call with 0, 13, 1.5, NaN, a string). Expected: the buttons are disabled at 1 and 12, the server refuses anything outside the integers 1–12 and the row keeps its old quantity. Pinned in Task 2 (bounds) and Task 3 (disabled buttons).
4. **Edit on a swapped line** (the page image is on the back, the pick on the front). Expected: the Edit link opens the page image's page with `back=<pick>&swap=1`, the panel shows the sides the right way round, and Save keeps `{ front: pick, back: pageImage }`. Pinned in Task 1 (`cartLineEdit`) and Task 2 (swap on update).
5. **Saving a two-sided line onto a product with no back print area.** Expected: refused with the panel's notice, the line is unchanged in the database. Pinned in Task 2 (integration) and Task 4 (panel shows `UPDATE_CART_FAILED` on a throw).

---

## File structure

New files:

- `src/lib/cart-line-edit.ts` — pure: which pinned image a cart line's page is (`cartLineEdit`), the edit href (`cartLineEditHref`), the quantity bounds (`CART_LINE_MIN_QUANTITY`, `CART_LINE_MAX_QUANTITY`, `isValidCartQuantity`).
- `src/lib/__tests__/cart-line-edit.test.ts`
- `src/app/cart/__tests__/update-cart-item.integration.test.ts` — real DB: `updateCartItem`, `setCartItemQuantity`, `getEditableCartLine`, and `checkoutCart` after an edit.

Modified:

- `src/lib/nav.ts` — `/cart` becomes a detail origin so `from=/cart` gives the image detail page a "Cart" parent crumb and back arrow.
- `src/lib/action-copy.ts` — `UPDATE_CART_FAILED`, `CART_LINE_GONE`.
- `src/lib/buy-page-picks.ts` — `OpenBuyPanelPicks` gains `line`; `siblingImageHref` carries it.
- `src/app/cart/actions.ts` — `resolveLineInput` (shared validation, extracted from `addToCart`), `updateCartItem`, `setCartItemQuantity`, `getEditableCartLine`; `CartLine.editHref`.
- `src/app/cart/page.tsx` — Edit link, thumbnails link, quantity stepper, controls row.
- `src/app/d/[imageId]/buy-panel.tsx` — `editingLine` prop and edit mode.
- `src/app/d/[imageId]/buy-hero.tsx` — forwards `editingLine`.
- `src/app/d/[imageId]/page.tsx` — resolves `picks.line` through `getEditableCartLine`.
- Tests: `src/lib/__tests__/nav.test.ts` (if present; else `src/lib/__tests__/breadcrumbs.test.ts`, find it with `grep -rl "breadcrumbTrail" src --include=*.test.ts*`), `src/lib/__tests__/buy-page-picks.test.ts`, `src/app/cart/__tests__/cart-page.test.tsx`, `src/app/d/[imageId]/__tests__/buy-panel.test.tsx`, `src/app/d/[imageId]/__tests__/owner-order-page.test.tsx`, `e2e/cart.spec.ts`.

## Interfaces produced by this slice

```ts
// src/lib/cart-line-edit.ts
export const CART_LINE_MIN_QUANTITY = 1;
export const CART_LINE_MAX_QUANTITY = 12;
export function isValidCartQuantity(q: unknown): q is number;

export type CartLineEdit = {
  pageImageId: string;      // the image detail page to open
  back: string | null;      // the other pin, if any
  swap: boolean;            // true when the page image is on the back
};
/** `linked(imageId)` says whether the image is linked to the line's conversation
 * (a `conversation_image` row for the line's designId). */
export function cartLineEdit(
  line: { placements: Record<string, string> | null },
  linked: (imageId: string) => boolean
): CartLineEdit | null;
export function cartLineEditHref(
  lineId: string,
  line: { productId: string; size: string; color: string },
  edit: CartLineEdit
): string;

// src/app/cart/actions.ts (additions)
export type CartLine = { /* existing fields */ editHref: string | null };
export async function updateCartItem(params: {
  id: string; frontImageId: string; front?: string; back?: string;
  productId: string; size: string; color: string;
}): Promise<{ ok: true } | { ok: false; reason: "not-found" }>;
export async function setCartItemQuantity(
  id: string, quantity: number
): Promise<{ ok: true } | { ok: false; reason: "not-found" }>;
export async function getEditableCartLine(
  id: string
): Promise<{ id: string; quantity: number } | null>;

// src/lib/buy-page-picks.ts
export type OpenBuyPanelPicks = { product; size; color; back; swap; line: string | null } | null;

// src/app/d/[imageId]/buy-panel.tsx and buy-hero.tsx (new prop)
editingLine?: { id: string } | null;
```

---

### Task 1: `cart-line-edit.ts` (pure) and the `/cart` breadcrumb origin

**Files:**
- Create: `src/lib/cart-line-edit.ts`
- Create: `src/lib/__tests__/cart-line-edit.test.ts`
- Modify: `src/lib/nav.ts:37-60` (`DETAIL_ORIGINS`, `detailParent`)
- Test: the existing breadcrumb test file (find it: `grep -rl "breadcrumbTrail" src --include='*.test.ts' --include='*.test.tsx'`)

**Interfaces:**
- Consumes: `buyPageHref` from `src/lib/buy-page-picks.ts`.
- Produces: everything under "Interfaces produced by this slice" for `cart-line-edit.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/__tests__/cart-line-edit.test.ts
import { describe, it, expect } from "vitest";
import {
  cartLineEdit,
  cartLineEditHref,
  isValidCartQuantity,
  CART_LINE_MAX_QUANTITY,
  CART_LINE_MIN_QUANTITY,
} from "@/lib/cart-line-edit";

const OPTS = { productId: "bella-canvas-3001", size: "M", color: "Black" };

describe("cartLineEdit", () => {
  it("front-only line: the front is the page image", () => {
    expect(cartLineEdit({ placements: { front: "A" } }, (id) => id === "A")).toEqual({
      pageImageId: "A",
      back: null,
      swap: false,
    });
  });

  it("two-sided line with the front linked: front page, back carried", () => {
    expect(
      cartLineEdit({ placements: { front: "A", back: "B" } }, (id) => id === "A")
    ).toEqual({ pageImageId: "A", back: "B", swap: false });
  });

  it("swapped line (only the back is linked): the back is the page image, swap set", () => {
    expect(
      cartLineEdit({ placements: { front: "B", back: "A" } }, (id) => id === "A")
    ).toEqual({ pageImageId: "A", back: "B", swap: true });
  });

  it("both pins linked (two images of one conversation): the front wins, no swap", () => {
    expect(cartLineEdit({ placements: { front: "A", back: "C" } }, () => true)).toEqual({
      pageImageId: "A",
      back: "C",
      swap: false,
    });
  });

  it("neither pin linked (a legacy /preview line with a foreign front): the front is still the page", () => {
    expect(cartLineEdit({ placements: { front: "X" } }, () => false)).toEqual({
      pageImageId: "X",
      back: null,
      swap: false,
    });
  });

  it("no front pin: not editable", () => {
    expect(cartLineEdit({ placements: null }, () => true)).toBeNull();
    expect(cartLineEdit({ placements: { back: "B" } }, () => true)).toBeNull();
  });
});

describe("cartLineEditHref", () => {
  it("opens the page image with the panel open, the picks, the line and from=/cart", () => {
    const href = cartLineEditHref("line-1", OPTS, {
      pageImageId: "A",
      back: null,
      swap: false,
    });
    const url = new URL(href, "http://x");
    expect(url.pathname).toBe("/d/A");
    expect(url.searchParams.get("order")).toBe("1");
    expect(url.searchParams.get("product")).toBe(OPTS.productId);
    expect(url.searchParams.get("size")).toBe("M");
    expect(url.searchParams.get("color")).toBe("Black");
    expect(url.searchParams.get("line")).toBe("line-1");
    expect(url.searchParams.get("from")).toBe("/cart");
    expect(url.searchParams.has("back")).toBe(false);
    expect(url.searchParams.has("swap")).toBe(false);
  });

  it("carries back and swap for a swapped line", () => {
    const url = new URL(
      cartLineEditHref("line-2", OPTS, { pageImageId: "A", back: "B", swap: true }),
      "http://x"
    );
    expect(url.searchParams.get("back")).toBe("B");
    expect(url.searchParams.get("swap")).toBe("1");
  });
});

describe("isValidCartQuantity", () => {
  it("accepts the integers 1 to 12", () => {
    expect(CART_LINE_MIN_QUANTITY).toBe(1);
    expect(CART_LINE_MAX_QUANTITY).toBe(12);
    for (let q = 1; q <= 12; q++) expect(isValidCartQuantity(q)).toBe(true);
  });
  it("refuses everything else", () => {
    for (const q of [0, 13, -1, 1.5, NaN, Infinity, "2", null, undefined, true]) {
      expect(isValidCartQuantity(q)).toBe(false);
    }
  });
});
```

And in the breadcrumb test file, add one case next to the existing `detailFrom`/`breadcrumbTrail` cases (match its style):

```ts
it("the image detail page hangs off the cart when opened from a cart line (#282)", () => {
  const trail = breadcrumbTrail("/d/img-1", { from: detailFrom("/cart", true) });
  expect(trail[trail.length - 1]).toEqual({ label: "Cart", href: "/cart" });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/lib/__tests__/cart-line-edit.test.ts` and the breadcrumb test file.
Expected: FAIL (module not found; the trail's last crumb is not Cart).

- [ ] **Step 3: Write `src/lib/cart-line-edit.ts`**

```ts
/**
 * The cart line's way back to the buy surface (#282, one buy surface slice
 * 5). A line stores its conversation (`designId`) and the images pinned on
 * each side. The image detail page is keyed on an image, so the Edit link has
 * to pick which pin is the page: the one linked to the line's conversation,
 * preferring the front; a swapped line has the page image on the back and
 * the link carries `swap=1`. A legacy line whose front is not linked (the
 * /preview path allowed any guarded image as the front) still opens on its
 * front; saving re-derives the line's design from that image, which is what
 * the add path does too. A line with no front pin cannot be re-opened.
 *
 * No DB access: the caller answers `linked` from one conversation_image query.
 */
import { buyPageHref } from "@/lib/buy-page-picks";

export const CART_LINE_MIN_QUANTITY = 1;
export const CART_LINE_MAX_QUANTITY = 12;

/** An integer from 1 to 12 (Nico, 2026-10-01). */
export function isValidCartQuantity(q: unknown): q is number {
  return (
    typeof q === "number" &&
    Number.isInteger(q) &&
    q >= CART_LINE_MIN_QUANTITY &&
    q <= CART_LINE_MAX_QUANTITY
  );
}

export type CartLineEdit = {
  pageImageId: string;
  back: string | null;
  swap: boolean;
};

export function cartLineEdit(
  line: { placements: Record<string, string> | null },
  linked: (imageId: string) => boolean
): CartLineEdit | null {
  const front = line.placements?.front;
  if (!front) return null;
  const back = line.placements?.back ?? null;
  if (back && !linked(front) && linked(back)) {
    return { pageImageId: back, back: front, swap: true };
  }
  return { pageImageId: front, back, swap: false };
}

export function cartLineEditHref(
  lineId: string,
  line: { productId: string; size: string; color: string },
  edit: CartLineEdit
): string {
  return buyPageHref(edit.pageImageId, {
    order: true,
    product: line.productId,
    size: line.size,
    color: line.color,
    back: edit.back,
    swap: edit.swap,
    line: lineId,
    from: "/cart",
  });
}
```

- [ ] **Step 4: Add `/cart` to the detail origins in `src/lib/nav.ts`**

In `DETAIL_ORIGINS` append `"/cart"`. In `detailParent`, add a case returning `{ label: "Cart", href: "/cart" }`. Update the comment above `DETAIL_ORIGINS` if it lists the origins.

- [ ] **Step 5: Run the tests again**

Run: `npx vitest run src/lib/__tests__/cart-line-edit.test.ts src/lib/__tests__/nav*.test.ts` (or the breadcrumb test file).
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cart-line-edit.ts src/lib/__tests__/cart-line-edit.test.ts src/lib/nav.ts <breadcrumb test file>
git commit -m "Cart line edit helpers: page image, edit href, quantity bounds; /cart as a detail origin (#282)"
```

---

### Task 2: `updateCartItem`, `setCartItemQuantity`, `getEditableCartLine`, `CartLine.editHref`

**Files:**
- Modify: `src/app/cart/actions.ts`
- Modify: `src/lib/action-copy.ts` (two constants, used by Task 4; added here so the file changes once)
- Create: `src/app/cart/__tests__/update-cart-item.integration.test.ts`

**Interfaces:**
- Consumes: Task 1's `cartLineEdit`, `cartLineEditHref`, `isValidCartQuantity`; `conversationImage` from `@/lib/db/schema`.
- Produces: `updateCartItem`, `setCartItemQuantity`, `getEditableCartLine`, `CartLine.editHref` as declared above.

- [ ] **Step 1: Write the failing integration tests**

Model the file on `src/app/cart/__tests__/add-to-cart-swap.integration.test.ts` (same mocks: `@/lib/db`, `@/lib/auth`, `next/headers`, `@/lib/stripe`, `@/lib/printful`; same `seed`, `cartRows`, `withoutBackPlacement`). Import `addToCart, updateCartItem, setCartItemQuantity, getEditableCartLine, getCart, checkoutCart` from `@/app/cart/actions`. Tests:

```ts
describe("updateCartItem (#282)", () => {
  it("changes exactly the named line: size, colour and product, keeping its quantity", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await addToCart({ frontImageId: ids.listingId, ...OPTS });
    await addToCart({ frontImageId: ids.listingId, ...OPTS });
    const [a, b] = await cartRows(db);
    await db.update(schema.cartItem).set({ quantity: 3 }).where(eq(schema.cartItem.id, a.id));

    const result = await updateCartItem({
      id: a.id, frontImageId: ids.listingId, productId: OPTS.productId, size: "L", color: "White",
    });
    expect(result).toEqual({ ok: true });

    const rows = await cartRows(db);
    const after = rows.find((r) => r.id === a.id)!;
    expect(after.size).toBe("L");
    expect(after.color).toBe("White");
    expect(after.quantity).toBe(3);
    expect(after.placements).toEqual({ front: ids.listingId });
    const other = rows.find((r) => r.id === b.id)!;
    expect(other.size).toBe("M");
    expect(rows).toHaveLength(2);
  });

  it("another user's line id changes nothing and reports not-found", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await addToCart({ frontImageId: ids.listingId, ...OPTS });
    const [row] = await cartRows(db);

    h.session = { user: { id: "other", isAnonymous: false } };
    const result = await updateCartItem({
      id: row.id, frontImageId: ids.listingId, productId: OPTS.productId, size: "L", color: "White",
    });
    expect(result).toEqual({ ok: false, reason: "not-found" });
    const [same] = await cartRows(db);
    expect(same.size).toBe("M");
    expect(same.color).toBe("Black");
  });

  it("a deleted line reports not-found and inserts nothing", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await addToCart({ frontImageId: ids.listingId, ...OPTS });
    const [row] = await cartRows(db);
    await db.delete(schema.cartItem).where(eq(schema.cartItem.id, row.id));

    const result = await updateCartItem({
      id: row.id, frontImageId: ids.listingId, productId: OPTS.productId, size: "L", color: "White",
    });
    expect(result).toEqual({ ok: false, reason: "not-found" });
    expect(await cartRows(db)).toHaveLength(0);
  });

  it("adds a back and a swap to a front-only line", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await addToCart({ frontImageId: ids.listingId, ...OPTS });
    const [row] = await cartRows(db);

    await updateCartItem({
      id: row.id, frontImageId: ids.listingId, front: ids.myImageId, back: ids.listingId, ...OPTS,
    });
    const [after] = await cartRows(db);
    expect(after.placements).toEqual({ front: ids.myImageId, back: ids.listingId });
    expect(after.designId).toBe(ids.soldDesignId);
  });

  it("refuses a back on a product with no back print area and leaves the line unchanged", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await addToCart({ frontImageId: ids.listingId, back: ids.myImageId, ...OPTS });
    const [row] = await cartRows(db);
    await withoutBackPlacement(async () => {
      await expect(
        updateCartItem({ id: row.id, frontImageId: ids.listingId, back: ids.myImageId, ...OPTS, size: "L" })
      ).rejects.toThrow("This product has no back print area");
    });
    const [same] = await cartRows(db);
    expect(same.size).toBe("M");
    expect(same.placements).toEqual({ front: ids.listingId, back: ids.myImageId });
  });

  it("refuses a cross-owner private back and an admin-hidden back, leaving the line unchanged", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await addToCart({ frontImageId: ids.listingId, ...OPTS });
    const [row] = await cartRows(db);
    for (const back of [ids.sellerPrivateId, ids.sellerHiddenId]) {
      await expect(
        updateCartItem({ id: row.id, frontImageId: ids.listingId, back, ...OPTS })
      ).rejects.toThrow();
    }
    const [same] = await cartRows(db);
    expect(same.placements).toEqual({ front: ids.listingId });
  });

  it("refuses an unknown size before touching the row", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await addToCart({ frontImageId: ids.listingId, ...OPTS });
    const [row] = await cartRows(db);
    await expect(
      updateCartItem({ id: row.id, frontImageId: ids.listingId, productId: OPTS.productId, size: "XXXS", color: "Black" })
    ).rejects.toThrow();
    const [same] = await cartRows(db);
    expect(same.size).toBe("M");
  });

  it("checkoutCart after an edit writes the edited line and the Stripe amount follows it", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await addToCart({ frontImageId: ids.listingId, ...OPTS });
    const [row] = await cartRows(db);
    await updateCartItem({ id: row.id, frontImageId: ids.listingId, back: ids.myImageId, ...OPTS, size: "2XL" });
    await setCartItemQuantity(row.id, 2);

    const { url } = await checkoutCart();
    expect(url).toMatch(/^https:\/\//);
    const lines = await db.query.orderItem.findMany();
    expect(lines).toHaveLength(1);
    expect(lines[0].size).toBe("2XL");
    expect(lines[0].quantity).toBe(2);
    expect(lines[0].placements).toEqual({ front: ids.listingId, back: ids.myImageId });
    const expected = computePrice(0, OPTS.productId, "2XL", { back: true }).total;
    expect(lines[0].itemPrice).toBeCloseTo(expected, 2);
    const li = h.sessionParams[0]?.line_items?.[0];
    expect(li?.quantity).toBe(2);
    expect(li?.price_data?.unit_amount).toBe(Math.round(expected * 100));
  });
});

describe("setCartItemQuantity (#282)", () => {
  it("sets the quantity within 1..12 for the owner's line", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await addToCart({ frontImageId: ids.listingId, ...OPTS });
    const [row] = await cartRows(db);
    expect(await setCartItemQuantity(row.id, 12)).toEqual({ ok: true });
    expect((await cartRows(db))[0].quantity).toBe(12);
    expect(await setCartItemQuantity(row.id, 1)).toEqual({ ok: true });
    expect((await cartRows(db))[0].quantity).toBe(1);
  });

  it("refuses 0, 13, 1.5, NaN and a string, keeping the old quantity", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await addToCart({ frontImageId: ids.listingId, ...OPTS });
    const [row] = await cartRows(db);
    await setCartItemQuantity(row.id, 4);
    for (const q of [0, 13, 1.5, NaN, "2" as unknown as number]) {
      await expect(setCartItemQuantity(row.id, q)).rejects.toThrow("Quantity must be between 1 and 12");
    }
    expect((await cartRows(db))[0].quantity).toBe(4);
  });

  it("another user's line reports not-found and keeps its quantity", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await addToCart({ frontImageId: ids.listingId, ...OPTS });
    const [row] = await cartRows(db);
    h.session = { user: { id: "other", isAnonymous: false } };
    expect(await setCartItemQuantity(row.id, 5)).toEqual({ ok: false, reason: "not-found" });
    expect((await cartRows(db))[0].quantity).toBe(1);
  });

  it("getCart's totals and the Stripe quote multiply by the quantity", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await addToCart({ frontImageId: ids.listingId, ...OPTS });
    const [row] = await cartRows(db);
    const one = await getCart();
    await setCartItemQuantity(row.id, 3);
    const three = await getCart();
    expect(three.items[0].quantity).toBe(3);
    expect(three.itemSubtotal).toBeCloseTo(one.itemSubtotal * 3, 2);
  });
});

describe("getEditableCartLine and CartLine.editHref (#282)", () => {
  it("returns the owner's line and null for another user's or an unknown id", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await addToCart({ frontImageId: ids.listingId, ...OPTS });
    const [row] = await cartRows(db);
    expect(await getEditableCartLine(row.id)).toEqual({ id: row.id, quantity: 1 });
    expect(await getEditableCartLine("nope")).toBeNull();
    h.session = { user: { id: "other", isAnonymous: false } };
    expect(await getEditableCartLine(row.id)).toBeNull();
  });

  it("a Shop line's editHref opens the page image; a swapped line's carries swap=1 and the pick as back", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await addToCart({ frontImageId: ids.listingId, ...OPTS });
    await addToCart({ frontImageId: ids.listingId, front: ids.myImageId, back: ids.listingId, ...OPTS });
    const view = await getCart();
    const plain = new URL(view.items[0].editHref!, "http://x");
    expect(plain.pathname).toBe(`/d/${ids.listingId}`);
    expect(plain.searchParams.get("line")).toBe(view.items[0].id);
    expect(plain.searchParams.get("size")).toBe("M");
    const swapped = new URL(view.items[1].editHref!, "http://x");
    expect(swapped.pathname).toBe(`/d/${ids.listingId}`);
    expect(swapped.searchParams.get("back")).toBe(ids.myImageId);
    expect(swapped.searchParams.get("swap")).toBe("1");
  });

  it("a line with no front pin has no editHref", async () => {
    const db = h.db as Db;
    const ids = await seed(db);
    await db.insert(schema.cartItem).values({
      userId: "buyer", designId: ids.myDesignId, ...OPTS, placements: null,
    });
    const view = await getCart();
    expect(view.items[0].editHref).toBeNull();
  });
});
```

(Import `* as schema from "@/lib/db/schema"` and `eq` from `drizzle-orm`; `computePrice` from `@/lib/pricing`.)

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/app/cart/__tests__/update-cart-item.integration.test.ts`
Expected: FAIL (`updateCartItem` is not exported).

- [ ] **Step 3: Add the copy constants to `src/lib/action-copy.ts`** (under `// --- cart ---`)

```ts
/** updateCartItem threw (a refusal such as a back on a garment with no back
 * print area, or a failure). No "Try again": the refusal fails identically on
 * every retry. */
export const UPDATE_CART_FAILED = "Couldn't save the changes to your cart.";

/** updateCartItem returned not-found: the line was removed (another tab,
 * or a paid checkout) while the panel was open on it. */
export const CART_LINE_GONE = "This line is no longer in your cart.";
```

- [ ] **Step 4: Extract `addToCart`'s image-detail-page validation into a shared helper**

In `src/app/cart/actions.ts`, add a non-exported helper and make `addToCart`'s `frontImageId` branch call it. The `designId` branch (the former `/preview` entry) stays as it is.

```ts
/**
 * The validated row an image-detail-page add or edit writes (#282): the same
 * chain `addToCart`'s `frontImageId` entry has always run (catalog variant,
 * `resolveBuyableImage` on the page image, the back's print area and guard,
 * the swap rule), returned as the columns to write. Throws on any refusal;
 * writes nothing.
 */
async function resolveLineInput(
  params: {
    frontImageId: string;
    front?: string;
    back?: string;
    productId: string;
    size: string;
    color: string;
  },
  userId: string
): Promise<{
  designId: string;
  productId: string;
  size: string;
  color: string;
  placements: Record<string, string>;
}> {
  const { product } = resolveOrderVariant({
    productId: params.productId,
    size: params.size,
    color: params.color,
  });
  const buyable = await resolveBuyableImage(params.frontImageId, userId);
  if (!buyable.ok) {
    throw new Error(
      buyable.reason === "not-found" ? "Image not found" : "Image is not available"
    );
  }
  const designId = buyable.designId;
  let frontId = params.frontImageId;
  const backId = multiPlacementEnabled() && params.back ? params.back : null;
  if (backId) {
    if (!productSupportsPlacement(product, "back")) {
      throw new Error("This product has no back print area");
    }
    await assertUsablePlacementImage(backId, designId, userId);
  }
  const swappedFront = resolveBuyPageFront({
    pageImageId: params.frontImageId,
    front: params.front,
    back: backId,
  });
  if (swappedFront !== params.frontImageId) {
    await assertUsablePlacementImage(swappedFront, designId, userId, "front");
    frontId = swappedFront;
  }
  return {
    designId,
    productId: params.productId,
    size: params.size,
    color: params.color,
    placements: { front: frontId, ...(backId ? { back: backId } : {}) },
  };
}
```

Rewrite `addToCart` so that `if (params.frontImageId)` calls `resolveLineInput` and inserts its result (plus `userId`); the `else` branch keeps the existing `designId` logic (owner check, `front` guard or primary, back guard) and builds `placements` as today. Keep every existing comment that still describes the code; move the ones about the `frontImageId` path onto `resolveLineInput`. The existing add-to-cart integration tests must stay green unchanged: run `npx vitest run src/app/cart` after this step.

- [ ] **Step 5: Add the three actions**

```ts
/**
 * Save the image detail page's panel back onto an existing cart line (#282,
 * one buy surface slice 5). The same validation as an add, then ONE
 * owner-scoped UPDATE: a line id from another cart, or a line removed since
 * the panel opened, matches no row and is reported as data (`not-found`), so
 * the panel can say so (production masks thrown errors). Quantity is left as
 * it is: the stepper on the cart page owns it.
 */
export async function updateCartItem(params: {
  id: string;
  frontImageId: string;
  front?: string;
  back?: string;
  productId: string;
  size: string;
  color: string;
}): Promise<{ ok: true } | { ok: false; reason: "not-found" }> {
  const userId = await currentUserId();
  if (!userId) throw new Error("Unauthorized");
  const next = await resolveLineInput(params, userId);
  const updated = await db
    .update(cartItemTable)
    .set(next)
    .where(and(eq(cartItemTable.id, params.id), eq(cartItemTable.userId, userId)))
    .returning({ id: cartItemTable.id });
  return updated.length === 1 ? { ok: true } : { ok: false, reason: "not-found" };
}

/** 1 to 12 (Nico, 2026-10-01). Owner-scoped like removeCartItem. */
export async function setCartItemQuantity(
  id: string,
  quantity: number
): Promise<{ ok: true } | { ok: false; reason: "not-found" }> {
  const userId = await currentUserId();
  if (!userId) throw new Error("Unauthorized");
  if (!isValidCartQuantity(quantity)) {
    throw new Error(
      `Quantity must be between ${CART_LINE_MIN_QUANTITY} and ${CART_LINE_MAX_QUANTITY}`
    );
  }
  const updated = await db
    .update(cartItemTable)
    .set({ quantity })
    .where(and(eq(cartItemTable.id, id), eq(cartItemTable.userId, userId)))
    .returning({ id: cartItemTable.id });
  return updated.length === 1 ? { ok: true } : { ok: false, reason: "not-found" };
}

/**
 * The image detail page asks before turning edit mode on for a `line` in its
 * URL: only the viewer's own line qualifies. Null otherwise, and the page
 * opens in plain buy mode.
 */
export async function getEditableCartLine(
  id: string
): Promise<{ id: string; quantity: number } | null> {
  const userId = await currentUserId();
  if (!userId) return null;
  const row = await db.query.cartItem.findFirst({
    where: and(eq(cartItemTable.id, id), eq(cartItemTable.userId, userId)),
    columns: { id: true, quantity: true },
  });
  return row ?? null;
}
```

Imports: `isValidCartQuantity, CART_LINE_MIN_QUANTITY, CART_LINE_MAX_QUANTITY, cartLineEdit, cartLineEditHref` from `@/lib/cart-line-edit`; `conversationImage as conversationImageTable` from `@/lib/db/schema`; `inArray` from `drizzle-orm`.

- [ ] **Step 6: `CartLine.editHref` in `getCart`**

Add `editHref: string | null;` to `CartLine` with the doc comment `/** The image detail page link that re-opens this line for editing (#282); null when the line has no front pin. */`. In `getCart`, after `pinnedById`, run one query for which pins are linked to their line's conversation:

```ts
  // Which pinned image is the line's page image (cart-line-edit.ts): the one
  // linked to the line's conversation. One query for every line's pins.
  const pinIds = rows
    .flatMap((r) => [r.placements?.front, r.placements?.back])
    .filter((v): v is string => Boolean(v));
  const links =
    pinIds.length > 0
      ? await db
          .select({
            designId: conversationImageTable.designId,
            imageId: conversationImageTable.imageId,
          })
          .from(conversationImageTable)
          .where(
            and(
              inArray(conversationImageTable.designId, rows.map((r) => r.designId)),
              inArray(conversationImageTable.imageId, pinIds)
            )
          )
      : [];
  const linked = new Set(links.map((l) => `${l.designId}:${l.imageId}`));
```

And per line, inside the loop:

```ts
    const edit = cartLineEdit(
      { placements: r.placements ?? null },
      (imageId) => linked.has(`${r.designId}:${imageId}`)
    );
    // …
      editHref: edit
        ? cartLineEditHref(r.id, { productId: r.productId, size: r.size, color: r.color }, edit)
        : null,
```

Fixtures in `src/app/cart/__tests__/cart-page.test.tsx` (`ONE_ITEM`) will need `editHref: null` to type-check; add it there now (Task 3 changes that file further).

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/app/cart && npm run typecheck`
Expected: all cart tests PASS, including the new file; typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add src/app/cart/actions.ts src/lib/action-copy.ts src/app/cart/__tests__/update-cart-item.integration.test.ts src/app/cart/__tests__/cart-page.test.tsx
git commit -m "updateCartItem, setCartItemQuantity, getEditableCartLine; cart lines carry an edit link (#282)"
```

---

### Task 3: The cart page: Edit link, linked thumbnails, quantity stepper

**Files:**
- Modify: `src/app/cart/page.tsx`
- Test: `src/app/cart/__tests__/cart-page.test.tsx`

**Interfaces:**
- Consumes: `CartLine.editHref`, `setCartItemQuantity` (Task 2), `CART_LINE_MIN_QUANTITY`, `CART_LINE_MAX_QUANTITY` (Task 1).

- [ ] **Step 1: Write the failing tests** (append to `cart-page.test.tsx`; extend the `vi.mock("../actions", …)` with `setCartItemQuantity: (...args) => setCartItemQuantity(...args)` and declare `const setCartItemQuantity = vi.fn();`; reset it in `beforeEach`)

```tsx
describe("cart line controls (#282)", () => {
  const WITH_EDIT: CartView = {
    ...ONE_ITEM_WITH_IMAGE,
    items: [{ ...ONE_ITEM_WITH_IMAGE.items[0], editHref: "/d/img-1?order=1&size=M&line=line-1&from=%2Fcart" }],
  };

  it("renders an Edit link and links the thumbnail to the same place", async () => {
    getCart.mockResolvedValue(WITH_EDIT);
    render(<CartPage />);
    const edit = await screen.findByRole("link", { name: "Edit" });
    expect(edit).toHaveAttribute("href", WITH_EDIT.items[0].editHref);
    const thumbLink = screen.getByTestId("cart-line-thumb-link");
    expect(thumbLink).toHaveAttribute("href", WITH_EDIT.items[0].editHref);
  });

  it("no Edit link on a line without one, or on an unavailable line", async () => {
    getCart.mockResolvedValue({
      ...WITH_EDIT,
      items: [
        { ...WITH_EDIT.items[0], id: "a", editHref: null },
        { ...WITH_EDIT.items[0], id: "b", unavailable: true },
      ],
    });
    render(<CartPage />);
    await screen.findAllByTestId("cart-line-item");
    expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("the stepper shows the quantity and calls setCartItemQuantity with ±1", async () => {
    getCart.mockResolvedValue({ ...WITH_EDIT, items: [{ ...WITH_EDIT.items[0], quantity: 2 }] });
    setCartItemQuantity.mockResolvedValue({ ok: true });
    render(<CartPage />);
    expect(await screen.findByTestId("cart-line-quantity")).toHaveTextContent("2");
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity" }));
    await waitFor(() => expect(setCartItemQuantity).toHaveBeenCalledWith("line-1", 3));
    fireEvent.click(screen.getByRole("button", { name: "Decrease quantity" }));
    await waitFor(() => expect(setCartItemQuantity).toHaveBeenCalledWith("line-1", 1));
    // The cart is re-read after each change.
    await waitFor(() => expect(getCart).toHaveBeenCalledTimes(3));
  });

  it("disables Decrease at 1 and Increase at 12", async () => {
    getCart.mockResolvedValueOnce({ ...WITH_EDIT, items: [{ ...WITH_EDIT.items[0], quantity: 1 }] });
    const { unmount } = render(<CartPage />);
    await screen.findByTestId("cart-line-quantity");
    expect(screen.getByRole("button", { name: "Decrease quantity" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Increase quantity" })).toBeEnabled();
    unmount();
    getCart.mockResolvedValueOnce({ ...WITH_EDIT, items: [{ ...WITH_EDIT.items[0], quantity: 12 }] });
    render(<CartPage />);
    await screen.findByTestId("cart-line-quantity");
    expect(screen.getByRole("button", { name: "Increase quantity" })).toBeDisabled();
  });

  it("the stepper buttons are 44px targets", async () => {
    getCart.mockResolvedValue(WITH_EDIT);
    render(<CartPage />);
    const inc = await screen.findByRole("button", { name: "Increase quantity" });
    expect(inc.className).toMatch(/\bw-11\b/);
    expect(inc.className).toMatch(/\bh-11\b/);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/app/cart/__tests__/cart-page.test.tsx`
Expected: FAIL (no Edit link, no stepper).

- [ ] **Step 3: Restructure the line in `src/app/cart/page.tsx`**

Each `<li>` becomes two rows. Top row: thumbnails (wrapped in a `<Link data-testid="cart-line-thumb-link" href={item.editHref}>` when `editHref` is set and the line is available, else a plain `<div>`), the text column (product name; `colour / size · front + back`; the unavailable label), and the line price (`unitPrice × quantity`). Drop the `· ×N` text — the stepper shows the quantity. Bottom row (`flex items-center justify-between gap-3 mt-3`): the stepper on the left, `Edit` (a `<Link>` styled like the Remove button, `min-h-11 inline-flex items-center text-xs underline …`) and `Remove` on the right.

Stepper:

```tsx
<div
  role="group"
  aria-label="Quantity"
  className="inline-flex items-center border border-border"
>
  <button
    type="button"
    aria-label="Decrease quantity"
    onClick={() => handleQuantity(item.id, item.quantity - 1)}
    disabled={busy === item.id || item.quantity <= CART_LINE_MIN_QUANTITY}
    className="w-11 h-11 inline-flex items-center justify-center text-base disabled:text-text-faint"
  >
    −
  </button>
  <span data-testid="cart-line-quantity" className="w-8 text-center font-mono text-sm">
    {item.quantity}
  </span>
  <button
    type="button"
    aria-label="Increase quantity"
    onClick={() => handleQuantity(item.id, item.quantity + 1)}
    disabled={busy === item.id || item.quantity >= CART_LINE_MAX_QUANTITY}
    className="w-11 h-11 inline-flex items-center justify-center text-base disabled:text-text-faint"
  >
    +
  </button>
</div>
```

Rename the `removing` state to `busy: string | null` (one in-flight change per line; Remove and the stepper share it) and add:

```tsx
  async function handleQuantity(id: string, quantity: number) {
    if (quantity < CART_LINE_MIN_QUANTITY || quantity > CART_LINE_MAX_QUANTITY) return;
    setBusy(id);
    try {
      await setCartItemQuantity(id, quantity);
      await refresh();
    } finally {
      setBusy(null);
    }
  }
```

The stepper is rendered on every line, available or not (a stale line still needs Remove; changing its count is harmless and the checkout refusal stands). The `−`/`+` glyphs: use U+2212 for minus so the two buttons are the same width.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/app/cart/__tests__/cart-page.test.tsx && npm run lint`
Expected: PASS; lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/cart/page.tsx src/app/cart/__tests__/cart-page.test.tsx
git commit -m "Cart line: Edit link, linked thumbnails, quantity stepper 1–12 (#282)"
```

---

### Task 4: The buy panel's edit mode

**Files:**
- Modify: `src/app/d/[imageId]/buy-panel.tsx`
- Modify: `src/app/d/[imageId]/buy-hero.tsx` (forward one prop)
- Modify: `src/app/d/[imageId]/page.tsx`
- Modify: `src/lib/buy-page-picks.ts` (`OpenBuyPanelPicks.line`, `siblingImageHref`)
- Test: `src/app/d/[imageId]/__tests__/buy-panel.test.tsx`, `src/app/d/[imageId]/__tests__/owner-order-page.test.tsx`, `src/lib/__tests__/buy-page-picks.test.ts`

**Interfaces:**
- Consumes: `updateCartItem`, `getEditableCartLine` (Task 2); `UPDATE_CART_FAILED`, `CART_LINE_GONE` (Task 2).
- Produces: `editingLine?: { id: string } | null` on `BuyPanel` and `BuyHero`; `OpenBuyPanelPicks.line`.

- [ ] **Step 1: Write the failing panel tests** (append to `buy-panel.test.tsx`; extend the `@/app/cart/actions` mock with `updateCartItem: vi.fn(async () => ({ ok: true }))` and import it)

```tsx
describe("edit mode: saving back to a cart line (#282)", () => {
  const EDIT_PICKS = {
    expanded: true,
    productId: "bella-canvas-3001",
    size: "M",
    color: "Black",
    back: null,
    swapped: false,
  };

  function renderEdit(props: Partial<React.ComponentProps<typeof BuyPanel>> = {}) {
    return render(
      <BuyPanel
        imageId="img-1"
        isLoggedIn
        cartEnabled
        initialPicks={EDIT_PICKS}
        editingLine={{ id: "line-1" }}
        {...props}
      />
    );
  }

  it("shows Save to cart and a Cancel link to the cart, and no Order or Add to cart", () => {
    renderEdit();
    expect(screen.getAllByRole("button", { name: "Save to cart" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /^Order/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId("add-to-cart")).not.toBeInTheDocument();
    const cancel = screen.getAllByRole("link", { name: "Cancel" })[0];
    expect(cancel).toHaveAttribute("href", "/cart");
  });

  it("Save calls updateCartItem with the line id and the current picks, then goes to the cart", async () => {
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...original, set href(v: string) { assign(v); }, pathname: "/d/img-1", search: "" },
    });
    try {
      renderEdit();
      fireEvent.click(screen.getByRole("button", { name: "L" }));
      fireEvent.click(screen.getAllByRole("button", { name: "Save to cart" })[0]);
      await waitFor(() =>
        expect(updateCartItem).toHaveBeenCalledWith({
          id: "line-1",
          frontImageId: "img-1",
          productId: "bella-canvas-3001",
          size: "L",
          color: "Black",
        })
      );
      await waitFor(() => expect(assign).toHaveBeenCalledWith("/cart"));
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: original });
    }
  });

  it("a not-found result shows the line-gone notice and stays on the page", async () => {
    vi.mocked(updateCartItem).mockResolvedValueOnce({ ok: false, reason: "not-found" });
    renderEdit();
    fireEvent.click(screen.getAllByRole("button", { name: "Save to cart" })[0]);
    expect(await screen.findAllByText(CART_LINE_GONE)).not.toHaveLength(0);
  });

  it("a thrown refusal shows the update-failed notice", async () => {
    vi.mocked(updateCartItem).mockRejectedValueOnce(new Error("This product has no back print area"));
    renderEdit();
    fireEvent.click(screen.getAllByRole("button", { name: "Save to cart" })[0]);
    expect(await screen.findAllByText(UPDATE_CART_FAILED)).not.toHaveLength(0);
  });

  it("Save is disabled until a size is picked", () => {
    renderEdit({ initialPicks: { ...EDIT_PICKS, size: null } });
    expect(screen.getAllByRole("button", { name: "Save to cart" })[0]).toBeDisabled();
  });

  it("a guest in edit mode gets Save to cart, not Sign in to buy", () => {
    renderEdit({ isLoggedIn: false });
    expect(screen.getAllByRole("button", { name: "Save to cart" }).length).toBeGreaterThan(0);
    expect(screen.queryByText("Sign in to buy")).not.toBeInTheDocument();
  });

  it("reports the line in its open picks so sibling links carry it", () => {
    let seen: ReturnType<typeof useOpenBuyPanelPicks> = null;
    function Probe() {
      seen = useOpenBuyPanelPicks();
      return null;
    }
    render(
      <BuyPanelPicksProvider>
        <BuyPanel imageId="img-1" isLoggedIn initialPicks={EDIT_PICKS} editingLine={{ id: "line-1" }} />
        <Probe />
      </BuyPanelPicksProvider>
    );
    expect(seen?.line).toBe("line-1");
  });
});
```

Look at how the existing tests in this file stub `window.location` for the Order and Add to cart navigations and copy that pattern instead of the `Object.defineProperty` sketch above if the file already has a helper.

In `src/lib/__tests__/buy-page-picks.test.ts`, add to the `siblingImageHref` cases:

```ts
it("carries the cart line being edited (#282)", () => {
  const href = siblingImageHref("sib", { product: null, size: "M", color: null, back: null, swap: false, line: "line-1" });
  expect(new URL(href, "http://x").searchParams.get("line")).toBe("line-1");
});
```

and set `line: null` on the existing `OpenBuyPanelPicks` fixtures so they type-check.

In `owner-order-page.test.tsx`, extend the `@/app/cart/actions` mock with `getEditableCartLine: vi.fn(async () => h.line)` and `updateCartItem: vi.fn(async () => ({ ok: true }))` (`h.line` hoisted, default `null`), and add:

```tsx
describe("edit mode from a cart line (#282)", () => {
  it("the viewer's own line turns edit mode on", async () => {
    h.line = { id: "line-1", quantity: 1 };
    render(await PublishedImagePage({ params: Promise.resolve({ imageId: "img-1" }), searchParams: Promise.resolve({ order: "1", size: "M", line: "line-1" }) }));
    expect(screen.getAllByRole("button", { name: "Save to cart" }).length).toBeGreaterThan(0);
  });

  it("a line that is not the viewer's opens plain buy mode", async () => {
    h.line = null;
    render(await PublishedImagePage({ params: Promise.resolve({ imageId: "img-1" }), searchParams: Promise.resolve({ order: "1", size: "M", line: "line-x" }) }));
    expect(screen.queryByRole("button", { name: "Save to cart" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Order/ }).length).toBeGreaterThan(0);
  });
});
```

Match the file's existing way of rendering the page and setting `h.image`/`h.session` (an owner's or a published image, logged in).

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run 'src/app/d/[imageId]/__tests__/buy-panel.test.tsx' 'src/app/d/[imageId]/__tests__/owner-order-page.test.tsx' src/lib/__tests__/buy-page-picks.test.ts`
Expected: FAIL (`editingLine` unknown, no Save to cart).

- [ ] **Step 3: `OpenBuyPanelPicks.line` and `siblingImageHref`**

In `src/lib/buy-page-picks.ts` add `line: string | null;` to `OpenBuyPanelPicks` with a comment `/** The cart line being edited (#282), so switching image keeps the edit. */`, and in `siblingImageHref` pass `line: open.line` into `buyPageHref`. Fix the type where the panel reports (`buy-panel.tsx`) and any other constructor of the type (`grep -rn "OpenBuyPanelPicks" src`).

- [ ] **Step 4: Edit mode in `buy-panel.tsx`**

Add the prop:

```tsx
  /** The cart line this panel is editing (#282): Save to cart replaces Order
   * and Add to cart, Cancel returns to the cart, and the picks save onto that
   * line. Set only when the page has checked the line is the viewer's. */
  editingLine?: { id: string } | null;
```

State: `const [saving, setSaving] = useState(false);`. Report `line: editingLine?.id ?? null` in the `reportPicks` effect (add `editingLine?.id` to its deps). Add:

```tsx
  async function handleSave() {
    if (!size || !editingLine) return;
    navigatingAway.current = true;
    setSaving(true);
    setNotice(null);
    try {
      const result = await updateCartItem({
        id: editingLine.id,
        frontImageId: imageId,
        productId,
        size,
        color,
        ...(sides.back ? { back: sides.back.id } : {}),
        ...(frontOverride ? { front: frontOverride } : {}),
      });
      if (!result.ok) {
        navigatingAway.current = false;
        setNotice(CART_LINE_GONE);
        setSaving(false);
        return;
      }
      window.location.href = "/cart";
    } catch {
      navigatingAway.current = false;
      setNotice(UPDATE_CART_FAILED);
      setSaving(false);
    }
  }
```

Reset `saving` in the `pageshow` handler alongside `loading` and `addingToCart`. Build the edit-mode CTA and use it for both the signed-in and guest branches when `editingLine` is set (guests have carts, so there is no sign-in gate on a save):

```tsx
  const editCta = editingLine ? (
    <div className="space-y-1.5">
      {!size && <p className="text-sm text-text-muted text-center">Choose a size</p>}
      <Button
        onClick={handleSave}
        disabled={saving || !size}
        size="lg"
        className="w-full"
        data-testid="save-to-cart"
      >
        {saving ? "Saving…" : "Save to cart"}
      </Button>
      <Link
        href="/cart"
        className="block w-full min-h-11 text-sm text-center underline text-text-muted hover:text-foreground leading-[2.75rem]"
      >
        Cancel
      </Link>
      {notice && <InlineNotice message={notice} className="text-center" />}
    </div>
  ) : null;

  const cta = editCta ?? (isLoggedIn ? ( /* existing signed-in block */ ) : ( /* existing guest block */ ));
```

The price block in edit mode shows the unit price as today (the stepper on the cart page owns the count). Update the component doc comment with one sentence on edit mode.

- [ ] **Step 5: Forward the prop in `buy-hero.tsx` and resolve the line in `page.tsx`**

`buy-hero.tsx`: add `editingLine?: { id: string } | null;` to the props (doc: `/** Forwarded to BuyPanel (#282). */`) and pass `editingLine={editingLine}` to `<BuyPanel>`.

`page.tsx`: import `getEditableCartLine` from `@/app/cart/actions`; after `initialPicks`:

```tsx
  // A cart line in the link (#282) turns the panel into an editor of that
  // line, only when it is the viewer's own: anything else opens plain buy mode.
  const editable = picks.line ? await getEditableCartLine(picks.line) : null;
  const editingLine = editable ? { id: editable.id } : null;
```

and pass `editingLine={editingLine}` to `<BuyHero>`. Every page-level test that mocks `@/app/cart/actions` needs `getEditableCartLine` in its mock: `grep -rln 'vi.mock("@/app/cart/actions"' src` and add `getEditableCartLine: vi.fn(async () => null)` where missing.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/app/d src/lib/__tests__/buy-page-picks.test.ts && npm run typecheck && npm run lint`
Expected: PASS, clean.

- [ ] **Step 7: Commit**

```bash
git add 'src/app/d/[imageId]/buy-panel.tsx' 'src/app/d/[imageId]/buy-hero.tsx' 'src/app/d/[imageId]/page.tsx' src/lib/buy-page-picks.ts 'src/app/d/[imageId]/__tests__/' src/lib/__tests__/buy-page-picks.test.ts
git commit -m "Buy panel edit mode: a cart line's picks load, Save to cart writes them back (#282)"
```

---

### Task 5: Playwright: edit a line and count it

**Files:**
- Modify: `e2e/cart.spec.ts`

**Interfaces:**
- Consumes: the finished feature. Read the existing test in the file for how it adds a line to the cart (the image detail page's Order → size → Add to cart) and reuse its helpers.

- [ ] **Step 1: Write the test**

```ts
test("cart line: quantity stepper and Edit save back to the same line (#282)", async ({ page }) => {
  // Add one line the way the existing test does (reuse its helper/steps).
  // …
  await page.goto("/cart");
  const line = page.getByTestId("cart-line-item");
  await expect(line).toHaveCount(1);
  await expect(page.getByTestId("cart-line-quantity")).toHaveText("1");

  await page.getByRole("button", { name: "Increase quantity" }).click();
  await expect(page.getByTestId("cart-line-quantity")).toHaveText("2");
  await expect(page.getByRole("button", { name: "Decrease quantity" })).toBeEnabled();

  const sizeBefore = await line.getByText(/ \/ /).first().textContent();
  await page.getByRole("link", { name: "Edit" }).click();
  await expect(page).toHaveURL(/\/d\/[^?]+\?.*line=/);
  await expect(page.getByTestId("save-to-cart").first()).toBeVisible();
  // Pick a size that differs from the line's current one.
  const target = sizeBefore?.includes("/ L") ? "M" : "L";
  await page.getByRole("button", { name: target, exact: true }).click();
  await page.getByTestId("save-to-cart").first().click();

  await expect(page).toHaveURL(/\/cart$/);
  await expect(page.getByTestId("cart-line-item")).toHaveCount(1);
  await expect(page.getByTestId("cart-line-item")).toContainText(`/ ${target}`);
  await expect(page.getByTestId("cart-line-quantity")).toHaveText("2");
});
```

Adjust the selectors to the actual markup of the finished Task 3 and Task 4 (size chips render as buttons named by the size; the line text is `Colour / Size`). If the existing spec adds a line as a guest, this test runs as a guest too: edit mode has no sign-in gate.

- [ ] **Step 2: Run it**

Run: `npm run e2e -- e2e/cart.spec.ts` (needs the local build env; see the parent plan's Global Constraints). If the compiled build is already present from the gate, `npx playwright test e2e/cart.spec.ts`.
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/cart.spec.ts
git commit -m "e2e: cart quantity stepper and Edit round trip (#282)"
```

---

## Gate, reviews and PR

1. `npm run lint && npm run typecheck && npm test && npm run build` (dummy env from `ci.yml`), `npm run db:generate` must print "No schema changes", then `npm run e2e`.
2. One independent whole-branch review (Opus) and one adversarial money-path review (Opus) of `updateCartItem`, `setCartItemQuantity` and `checkoutCart` after an edit. Fix rounds go back to the implementer; re-gate after each.
3. PR on `claude/278-cart-edit` against main, titled "Cart: edit a line from the image detail page, quantity 1–12 (#282, one buy surface slice 5)". The body lists: the copy decided by Claude (to confirm), the sibling-link `line` carry, the known limits below, and one smoke for Nico (self-contained, phone width).
4. Ledger copied to `docs/superpowers/ledgers/2026-10-07-278-slice-5.md`.

## Known limits (state them in the PR)

- A guest's legacy two-sided line (a back picked on `/preview` before 2026-10-06) saves without its back: the page resolves a link's `back` only for a signed-in viewer, so edit mode for a guest shows no back and Save writes none. The panel never offered a back to guests, so no line added through it is affected.
- `addToCart` still inserts a new line for every add; two identical adds are two lines (issue #282 open question 3, not ruled). The stepper counts within a line.
- The edit link opens the page image's page; a line whose front is not linked to its conversation (a legacy `/preview` line with a foreign front) opens on that front, and Save re-derives the line's design from it.
- Editing an unavailable line is not offered (no Edit link); the buyer removes it.
