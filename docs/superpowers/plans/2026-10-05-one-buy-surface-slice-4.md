# One Buy Surface, Slice 4: every entry point opens the image detail page; `/preview` redirects

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Parent plan:** `docs/superpowers/plans/2026-10-01-one-buy-surface.md`. Its Decisions, Global Constraints and URL contract apply here unchanged. Read them first. The slice 3 plan (`docs/superpowers/plans/2026-10-05-one-buy-surface-slice-3.md`) and PR #290 describe the gate this slice relies on.

**Goal:** every link that leads to `/preview` today opens the image detail page with the buyer's picks in the URL instead; an old `/preview` link redirects to the right image's page with the same picks; the conversation's other images stay one tap away with the same product, size and colour, which replaces `/preview`'s front picker.

**Architecture:** `/preview` becomes a server component that calls one resolver (`src/lib/preview-redirect.ts`) and redirects. The Studio and the conversation page build their links with `buyPageHref` (`src/lib/buy-page-picks.ts`). On the image detail page, the buy panel reports its open picks through a small React context, and the links to the conversation's other images read them. What only the old `/preview` client used (its mockup, render, prefetch and back-source actions, `getDesign`, the `foldPrimaryFront` option) is removed, which closes the two `/preview` gaps recorded on #288. The `/preview` checkout action and `PREVIEW_EMBEDDED_CHECKOUT_ENABLED` stay until slice 6.

**Tech Stack:** Next.js 16 App Router (server component `redirect()`), React context, Drizzle + libSQL, Vitest + Testing Library, Playwright.

**Branch:** `claude/278-slice-4` (the parent plan named it `claude/278-repoint`; the worktree uses this name). One PR. No schema change is expected; if one appears the PR is HOLD.

**Before starting:** the parent plan gates this slice on slice 3 being in Production and Nico's slice 3 smoke having passed. `CLAUDE.md` does not record that smoke yet. Confirm it with Nico before Task 1.

## What exists today (traced 2026-10-05, main at `09ebc1d`)

- `/preview` (`src/app/preview/page.tsx`) is a 1,342-line client component. It reads `id`, `front`, `back`, `product`, `size`, `color`; calls `getDesign(id)` (which throws for a signed-out or non-owner viewer and returns the whole design row, `mockupUrls` included); sends a design with no primary to `/design?id=…` and a missing id to `/design`; mints a guest session; and calls `generateMockup`, `getOrCreatePlacementRender`, `ensureMockupsPrefetched`, `getBackDesignSources`, `isMultiPlacementEnabled`, `getLastPurchaseDefaults`, `calculatePrice`, `createCheckoutSession` and `addToCart` (design path).
- `generateMockup` is the only caller that passes `foldPrimaryFront: true` to `renderAndCacheMockup` (`src/lib/mockup-render.ts`) and the only caller that can omit `sourceImageId`. With no source it renders the conversation's primary with no hidden check (#288). `ensureMockupsPrefetched` is the only caller of `prefetchProductMockups` (`src/lib/mockup-prefetch.ts`), which renders the primary with no hidden check (#288) and writes source-less cache keys that the image detail page never reads (its mockups are always keyed by source image).
- `getDesign` (`src/app/design/actions.ts`) has one caller: the `/preview` client.
- The image detail page (`src/app/d/[imageId]/page.tsx`) serves published images to everyone and the owner's unpublished images to the owner. `img.canOrder` comes from `resolveBuyableImage` (`src/lib/buyable-image.ts`). Since slice 3 it no longer links to `/preview`.
- The panel (`buy-panel.tsx`) keeps its picks in the address bar while open (`withBuyPagePicks` + `replaceState`).
- `ConversationImages` (`conversation-images.tsx`) shows the owner the conversation's other images. Strip thumbnails open a lightbox; the lightbox's **Open** link (`href(imageId)`, line 70) is the only link to a sibling's page, and it carries only `from`.
- `src/lib/nav.ts` `DETAIL_ORIGINS` does not include `/studio`.
- `PREVIEW_EMBEDDED_CHECKOUT_ENABLED` is off in Production and on in Vercel Preview and the nightly. Only `createCheckoutSession` reads it (through `previewEmbeddedCheckoutFlag` / `previewEmbeddedCheckoutConfig`); `/checkout` 404s unless it or `EMBEDDED_CHECKOUT_ENABLED` is on.

## Entry points that lead to `/preview` today

Traced with `grep -rnE "/preview|preview\?id|previewOrderHref" src e2e .github` and by reading every `href=`/`router.push` builder in the Studio, the conversation page, My Designs, the cart, `/order/confirm`, `/checkout` and the email templates.

| # | Entry point | Where it is built | Replacement in this slice | Pinned by |
|---|---|---|---|---|
| 1 | Studio lightbox **Order** | `src/app/studio/studio-client.tsx:1630-1642` (`previewOrderHref(lane.designId, imageId)`), shown only when the lane has a primary | `buyPageHref(imageId, { order: true, from: "/studio" })`, shown for every cell (the image page needs no primary; its own gate decides) | Task 4: `studio-client.test.tsx` |
| 2 | Conversation page stage **Order →** | `design-stage.tsx:137` → `design-client.tsx:763-766` `handleMakeProducts` → `/preview?id=` | `conversationOrderHref(images, selectedImage)` → `/d/<selected image>?order=1&from=%2Fstudio` | Task 1 unit tests, Task 9 guard |
| 3 | Conversation page phone drawer **Order →** | `mobile-gallery-drawer.tsx` → `image-gallery.tsx:120` → `handleMakeProducts` | same as 2 | same as 2 |
| 4 | Conversation page lightbox **Order** | `image-lightbox.tsx:199` → `design-client.tsx:768-774` `handleMakeProductsForImage` (calls `selectImage` first) | `selectImage` still runs, then `conversationOrderHref(images, imageUrl)` | same as 2 |
| 5 | Conversation page product-version links ("Classic Tee →") | `design-stage.tsx:125`, `image-gallery.tsx:87,96` → `handleSelectProductVersion` → `/preview?id=&product=` | `conversationOrderHref(images, selectedImage, productId)` | same as 2 |
| 6 | Hosted Stripe `cancel_url` of a `/preview` order | `src/app/order/actions.ts:154` (`previewPath`, in sessions created before deploy; sessions expire after 2 hours) | the `/preview` redirect; `createCheckoutSession` has no caller after this slice and is removed in slice 6 | Task 2 (the exact `previewPath` shape), Task 3 Playwright |
| 7 | Embedded `/checkout` Back link, `from=/preview?…` | `backPath: previewPath` in the same action; reachable only where `PREVIEW_EMBEDDED_CHECKOUT_ENABLED` is on (Vercel Preview) | the redirect | Task 2 |
| 8 | Legacy `/order?…` | `src/app/order/page.tsx:26` forwards `id, product, size, color, back` to `/preview` | unchanged; it now chains into the redirect | Task 3 Playwright (`/order?id=…&size=L`) |
| 9 | Sign-in return `next=/preview?…` | `/preview`'s own Sign in link (`withFront`), and `src/proxy.ts` when `GUEST_FUNNEL_ENABLED` is off | the redirect; a signed-out visitor is sent to sign-in with `next` set to the same `/preview` link | Task 2, Task 3 Playwright |
| 10 | Bookmarks and browser history of `/preview?…` | — | the redirect | Task 3 Playwright |
| 11 | e2e `cart.spec.ts` `addToCartFromPreviewPage` (2 calls) | `e2e/cart.spec.ts:39-57` | `addToCartFromImagePage`: `/d/<primary>?order=1&product=…&color=Black&size=M` | Task 7 |
| 12 | Nightly `stripe-money-path.spec.ts` cart helper (2 calls) and the `/preview` purchase test | `e2e/stripe-money-path.spec.ts:260-269`, `:366-458` | helper as in 11; the `/preview` test becomes "an old `/preview` link → image detail page → embedded checkout → submitted order" | Task 7 |

Checked and needing no change: My Designs tiles already open `/d/<id>?from=/designs` (`src/app/designs/library-grid.tsx:337`); the image detail page's private-owner branch stopped linking to `/preview` in slice 3; the emails link only to `/orders` and the admin order page (`src/lib/email.ts:257,290`); the cart page links to `/design` and sign-in only; `/order/confirm` links to `/orders`, `/design`, `/shop` and a Stripe/`/checkout` resume link; `/checkout`'s Back link is whatever `from` the session carries (row 7).

Not entry points, kept: `src/proxy.ts` (`/preview` in the matcher and `FUNNEL_ROUTES`) and `src/lib/funnel-routes.ts` (feedback launcher prefix). The route still exists as a redirect, so both stay until slice 6.

## Decisions

Taken by this plan, each with its reason. Departures from the parent plan are marked.

1. **The redirect resolves in `src/lib/`, not through `getDesign`** (departure: the parent said "owner-checked through the existing `getDesign`"). `getDesign` throws for a signed-out or non-owner viewer and returns `mockupUrls`. The resolver reads `design.userId` and `design.primaryImageId` itself, and `getDesign` is removed with its only caller (Task 8).
2. **Which image page the redirect opens.** `front` when the link names one, else the conversation's primary. One special case (departure: the parent said none is needed): when the link has a `back`, the front is not one of the conversation's images, and the back is, the link came from a swap on `/preview` (the front was picked from My Designs or the Shop). The redirect then opens the back image's page with `back=<front>&swap=1`. That is the same shirt, and the order stays on the conversation the link named and on the viewer's own image, instead of becoming a Shop sale of someone else's image. Without this case the old link would still print the same shirt, but the order would belong to a different conversation.
3. **Who the redirect serves.** No session: sign-in, with `next` set to the same `/preview` link, so an owner who was signed out comes back to the same shirt. A signed-in viewer who does not own the conversation: the `front` image's page when the link names one (a published front works for anyone; a private one 404s, as the image page already does), otherwise `/design`. They are never told the conversation's primary image id.
4. **The redirect never decides who may buy.** It picks a page and passes the picks; the page's own gates (`resolveBuyableImage`, `resolveInitialBack`, `parseBuyPagePicks`) decide. An admin-hidden primary still redirects to its page, which shows no Order.
5. **`redirect()`, not `permanentRedirect()`.** The target depends on the session and on the conversation's current primary, so it must not be cached as permanent.
6. **The `/preview` client is deleted, not kept unreachable** (departure from the brief's default). The route can hold only one page; once `page.tsx` is the redirect, the client cannot be reached by any URL, and keeping 1,342 lines nothing can render would only collect review comments. Git keeps it.
7. **What only the old client used is removed in this slice** (departure: the parent listed these for slice 6): `generateMockup`, `getOrCreatePlacementRender`, `ensureMockupsPrefetched`, `getBackDesignSources`, `isMultiPlacementEnabled`, `getDesign`, `prefetchProductMockups` and `Blank.prefetchColors`, `foldPrimaryFront`, `normalizeFrontPin`, `swapPlacementPins`, `withFront`, `previewOrderHref`, the `/preview` breadcrumb branch. They lose their last caller here. The #288 gaps sit in `generateMockup`'s implicit branch and in the prefetch, so removing them closes both, and `renderAndCacheMockup`'s `sourceImageId` becomes required so the unchecked implicit branch cannot come back. Next strips server actions nothing imports from the client bundle, but its own docs say to treat every action as reachable by direct POST, so dead actions are removed rather than relied on being stripped.
8. **The money path is not touched; its removals stay in slice 6.** `createCheckoutSession`, `calculatePrice`, `PREVIEW_EMBEDDED_CHECKOUT_ENABLED` with `previewEmbeddedCheckoutFlag` / `previewEmbeddedCheckoutConfig`, `/checkout`'s two-switch 404 gate, `addToCart`'s `designId` path and `cart-line-check`'s legacy branch all stay. After this slice nothing in the UI calls `createCheckoutSession`, so the switch is inert: it stays off in Production, stays on in Vercel Preview (harmless), and slice 6 deletes the code, the helpers and the env var together with their tests and the Vercel/CI settings. The nightly stops setting it in this slice (Task 7), because no test reads it any more.
9. **The mockup prefetch is deleted, not moved.** It wrote source-less keys the image detail page never reads, so keeping it would not warm anything the buyer sees. From this slice no surface prefetches mockups; the image detail page renders one per colour on demand, as it already does for every Shop buyer. The parent plan's slice 6 measurement stays, reworded: measure first-mockup time for an owner's unpublished image with a cold cache, and if it is slow, build a source-keyed prefetch for the image detail page.
10. **Picks reach sibling links through React context, not the address bar.** The panel's `replaceState` is not seen by Next's router (slice 2's recorded limit), so a link cannot read picks from `useSearchParams`. A provider on the page holds the open panel's picks; the panel reports them; `ConversationImages` reads them. The links update as the buyer picks.
11. **Sibling links carry the back** unless the sibling is the back image itself, in which case back and swap are dropped (printing one image on both sides is not what switching meant). With a swap, the sibling takes the page image's place on whichever side it was.
12. **`from=/studio`.** The Studio and the conversation page (which hangs off the Studio in the breadcrumb) open the image page with `from=/studio`, and `DETAIL_ORIGINS` learns it, so the image page's back arrow returns to the Studio. `/preview`'s Cancel used to return to the conversation; the Studio is the nearest origin the image page can name with a fixed string. The redirect carries no `from`, as slice 2's Stripe return paths carry none.
13. **The URL sync after publishing with the panel open (deferred from #290) is not in this slice.** Its cause is how Next's router treats `replaceState` (the same root as slice 2's recorded `router.refresh()` limit), which needs its own investigation in a real browser. No entry point and no part of the redirect depends on it, and with Decision 10 the sibling links do not read the address bar. Its effect stays small: Stripe return paths are built on the server from validated values, so only a reload or a copied link right after publishing loses the picks. Record it on #278 as its own follow-up (close task).

## Global Constraints

- The parent plan's Global Constraints apply.
- No schema change.
- No change to ledger, fulfillment, webhook or email code. Also unchanged: `createCheckoutSession`, `calculatePrice`, `buyPublishedDesign`, `addToCart`, `checkoutCart`, `src/app/checkout/**`, `src/lib/embedded-checkout*.ts`, `src/lib/flags.ts`, `src/lib/order-checkout.ts`.
- `resolveBuyableImage` stays the only authority on who may buy. No new buy gate anywhere; the redirect and the sibling links only choose a page and its picks.
- No price is written into this plan, a test fixture or a brief. Tests match prices by pattern (`/\$\d/`). `src/lib/__tests__/no-preselection-price.test.ts` stays green.
- Phone-first: 44px touch targets, no horizontal scroll at 390px.
- Every removed `/preview` link has a test that pins its replacement (the table above names each), and Task 9's guard test fails on any new `/preview` link in product code.
- The redirect is tested through a real request (Playwright, Task 3) for a conversation with a primary, one without, and a link with picks in the query.
- A new or removed export in `src/app/preview/actions.ts` or `src/app/d/actions.ts` updates its pin in `src/app/__tests__/server-action-exports.test.ts` in the same commit.
- Copy and comments say "image detail page", not "/d". Persona C copy.
- `PREVIEW_EMBEDDED_CHECKOUT_ENABLED` is not turned on in Production.
- Gate before the PR: `npm run lint && npm run typecheck && npm test && npm run db:generate && npm run build` (build env: the dummy block in `ci.yml`'s `check` job), then `npm run e2e`. `db:generate` must print "No schema changes".

## Review Focus (name these to the reviewer as things to probe)

1. **An old `/preview` link from an email, a bookmark or a Stripe session opened after the redirect ships** (hosted `cancel_url`, embedded Back `from=`, `/order?…`, sign-in `next=`). Expected: it lands on the right image's page with the panel open and the same product, size, colour and back. Pinned in Task 2 (the exact `cancel_url` shape `createCheckoutSession` writes) and Task 3 (Playwright, including the `/order` chain).
2. **A swapped `/preview` link**: front picked from another conversation or the Shop, back is this conversation's image. Expected: the conversation's image's page with `swap=1`, so the same shirt and the same conversation. Pinned in Task 2.
3. **The link opened signed out, or by someone who does not own the conversation.** Expected: signed out goes to sign-in and comes back to the same shirt; a stranger never learns the primary id, and a private `front` 404s. Pinned in Task 2 and Task 3.
4. **Switching to another image of the conversation with the panel open.** Expected: the new image's page opens with the same product, size and colour, and the same back unless the new image is the back. Pinned in Task 1, Task 6 and the Playwright test in Task 6.
5. **The image detail page's mockups after `sourceImageId` becomes required**: front, back, swapped front, a cached render whose source was later unpublished or hidden. Expected: unchanged behaviour; the source guard still runs before any cache answers. Pinned in Task 8 (ported source-guard tests).

---

## File structure

New:

- `src/lib/preview-redirect.ts`: parse an old `/preview` link and decide where it goes (`parsePreviewLink`, `previewPath`, `previewRedirectTarget` pure; `resolvePreviewRedirect` reads the DB).
- `src/lib/__tests__/preview-redirect.integration.test.ts`
- `src/app/preview/__tests__/preview-redirect-page.test.ts`
- `src/app/d/[imageId]/buy-panel-picks-context.tsx`: the provider and two hooks.
- `src/lib/__tests__/mockup-render-source-guard.integration.test.ts` (ported from the deleted `generate-mockup-source-guard` test).
- `src/lib/__tests__/no-preview-links.test.ts`: guard.
- `e2e/preview-redirect.spec.ts`

Modified: `src/lib/buy-page-picks.ts`, `src/app/preview/page.tsx` (replaced), `src/app/preview/actions.ts`, `src/app/studio/studio-client.tsx`, `src/lib/nav.ts`, `src/app/design/design-client.tsx`, `src/app/design/image-gallery.tsx` (comment), `src/app/d/[imageId]/page.tsx`, `buy-panel.tsx`, `conversation-images.tsx`, `src/app/design/actions.ts`, `src/lib/mockup-render.ts`, `src/lib/placement-pins.ts`, `src/lib/blanks.ts`, `src/app/__tests__/server-action-exports.test.ts`, `e2e/helpers/db.ts`, `e2e/cart.spec.ts`, `e2e/owner-buy.spec.ts`, `e2e/stripe-money-path.spec.ts`, `.github/workflows/stripe-e2e.yml`, `docs/stripe-e2e.md`, `docs/products.md`, `CLAUDE.md`, and the tests beside each.

Deleted: `src/app/preview/__tests__/preview-sides.test.tsx`, `generate-mockup-front-source.integration.test.ts`, `generate-mockup-source-guard.integration.test.ts` (ported), `placement-render-anchor.integration.test.ts`, `src/lib/mockup-prefetch.ts`, `src/lib/__tests__/mockup-prefetch.test.ts`, `src/lib/__tests__/mockup-prefetch-writeback.test.ts`.

Order: Tasks 1 → 9, then the close task. After Task 3 every old link already lands on the image page through the redirect, so the tree works between tasks.

---

### Task 1: link builders in `buy-page-picks`

**Files:**
- Modify: `src/lib/buy-page-picks.ts`
- Test: `src/lib/__tests__/buy-page-picks.test.ts`

**Interfaces:**
- Produces (all in `src/lib/buy-page-picks.ts`):

```ts
/** A raw query value as an image or design id, or null (same rule as `back`). */
export function parseIdParam(raw: string | string[] | undefined): string | null;

/** The buy panel's picks while it is open; null while it is collapsed. */
export type OpenBuyPanelPicks = {
  product: string;
  size: string | null;
  color: string;
  back: string | null;
  swap: boolean;
} | null;

/** Link to another image of the same conversation, carrying the open panel's picks. */
export function siblingImageHref(
  siblingId: string,
  open: OpenBuyPanelPicks,
  from?: string | null
): string;

/** The conversation page's Order link for the image shown at `imageUrl`, or null. */
export function conversationOrderHref(
  images: ReadonlyArray<{ id: string; url: string }>,
  imageUrl: string | null,
  productId?: string
): string | null;
```

- [ ] **Step 1: Write the failing tests** (append to `buy-page-picks.test.ts`; add the three names to its import)

```ts
describe("parseIdParam", () => {
  it("accepts an id and takes the first of a repeated value", () => {
    expect(parseIdParam("img-1")).toBe("img-1");
    expect(parseIdParam(["img-1", "img-2"])).toBe("img-1");
  });
  it("rejects empty, missing and malformed values", () => {
    expect(parseIdParam(undefined)).toBeNull();
    expect(parseIdParam("")).toBeNull();
    expect(parseIdParam("a b/../c")).toBeNull();
    expect(parseIdParam("x".repeat(65))).toBeNull();
  });
});

describe("siblingImageHref", () => {
  const OPEN = { product: "bella-canvas-3001", size: "L", color: "Black", back: null, swap: false };

  it("is the bare link, with from, while the panel is collapsed", () => {
    expect(siblingImageHref("img-c", null, "/designs")).toBe("/d/img-c?from=%2Fdesigns");
    expect(siblingImageHref("img-c", null)).toBe("/d/img-c");
  });

  it("carries the open panel's product, size and colour", () => {
    const url = new URL(siblingImageHref("img-c", OPEN, "/designs"), "http://x.invalid");
    expect(url.pathname).toBe("/d/img-c");
    expect(url.searchParams.get("order")).toBe("1");
    expect(url.searchParams.get("product")).toBe("bella-canvas-3001");
    expect(url.searchParams.get("size")).toBe("L");
    expect(url.searchParams.get("color")).toBe("Black");
    expect(url.searchParams.get("from")).toBe("/designs");
    expect(url.searchParams.get("back")).toBeNull();
  });

  it("leaves size out when none is picked", () => {
    const url = new URL(siblingImageHref("img-c", { ...OPEN, size: null }), "http://x.invalid");
    expect(url.searchParams.has("size")).toBe(false);
  });

  it("carries the back and the swap", () => {
    const url = new URL(
      siblingImageHref("img-c", { ...OPEN, back: "img-x", swap: true }),
      "http://x.invalid"
    );
    expect(url.searchParams.get("back")).toBe("img-x");
    expect(url.searchParams.get("swap")).toBe("1");
  });

  it("drops back and swap when the sibling is the back image", () => {
    const url = new URL(
      siblingImageHref("img-x", { ...OPEN, back: "img-x", swap: true }),
      "http://x.invalid"
    );
    expect(url.searchParams.get("back")).toBeNull();
    expect(url.searchParams.get("swap")).toBeNull();
  });
});

describe("conversationOrderHref", () => {
  const images = [
    { id: "img-a", url: "https://img.example/a.png" },
    { id: "img-b", url: "https://img.example/b.png" },
  ];

  it("opens the shown image's page with the panel open, from the Studio", () => {
    expect(conversationOrderHref(images, "https://img.example/b.png")).toBe(
      "/d/img-b?order=1&from=%2Fstudio"
    );
  });

  it("carries a product version's product", () => {
    expect(
      conversationOrderHref(images, "https://img.example/a.png", "bella-canvas-3001")
    ).toBe("/d/img-a?order=1&product=bella-canvas-3001&from=%2Fstudio");
  });

  it("is null for no image or an image not in the list", () => {
    expect(conversationOrderHref(images, null)).toBeNull();
    expect(conversationOrderHref(images, "https://img.example/gone.png")).toBeNull();
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/lib/__tests__/buy-page-picks.test.ts`. Expected: FAIL (names not exported).

- [ ] **Step 3: Implement** in `src/lib/buy-page-picks.ts`, below `buyPageHref`:

```ts
/** A raw query value as an image or design id, or null: the rule `back` and
 * `line` use, for callers outside the pick set (the `/preview` redirect's
 * `id` and `front`). */
export function parseIdParam(raw: string | string[] | undefined): string | null {
  return id({ value: raw }, "value");
}

/**
 * The buy panel's picks while it is open, as the page's other links need them
 * (#278 slice 4); null while it is collapsed. Reported by the panel through
 * `buy-panel-picks-context.tsx`.
 */
export type OpenBuyPanelPicks = {
  product: string;
  size: string | null;
  color: string;
  back: string | null;
  swap: boolean;
} | null;

/**
 * Link from the image detail page to another image of the same conversation.
 * While the panel is open it carries the panel's picks, so switching the image
 * keeps product, size and colour: this replaces `/preview`'s front picker
 * (Nico, 2026-10-01: no utility lost). The back and the swap ride along unless
 * the sibling IS the back image, where they are dropped. Collapsed, it is the
 * plain link.
 */
export function siblingImageHref(
  siblingId: string,
  open: OpenBuyPanelPicks,
  from?: string | null
): string {
  if (!open) return buyPageHref(siblingId, { from: from ?? null });
  const keepBack = open.back !== null && open.back !== siblingId;
  return buyPageHref(siblingId, {
    order: true,
    product: open.product,
    size: open.size,
    color: open.color,
    back: keepBack ? open.back : null,
    swap: keepBack && open.swap,
    from: from ?? null,
  });
}

/**
 * The conversation page's Order (#278 slice 4): the image detail page of the
 * image shown at `imageUrl` (the conversation page tracks images by URL), with
 * the panel open and, for a product-version link, that product. Null when the
 * URL names no image in the list. `from=/studio`: the conversation page hangs
 * off the Studio, and the image page's back arrow returns there.
 */
export function conversationOrderHref(
  images: ReadonlyArray<{ id: string; url: string }>,
  imageUrl: string | null,
  productId?: string
): string | null {
  if (!imageUrl) return null;
  const image = images.find((img) => img.url === imageUrl);
  if (!image) return null;
  return buyPageHref(image.id, {
    order: true,
    product: productId ?? null,
    from: "/studio",
  });
}
```

- [ ] **Step 4: Run** the test file and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** — `git add src/lib/buy-page-picks.ts src/lib/__tests__/buy-page-picks.test.ts && git commit -m "buy-page-picks: sibling and conversation-page links into the image detail page (#278 slice 4)"`

### Task 2: the `/preview` redirect resolver

**Files:**
- Create: `src/lib/preview-redirect.ts`
- Test: `src/lib/__tests__/preview-redirect.integration.test.ts` (harness: copy the top of `src/app/d/__tests__/resolve-initial-back.integration.test.ts`, the hoisted `h.db` and the `vi.mock("@/lib/db", …)` getter; no auth mock is needed because the viewer id is an argument)

**Interfaces:**
- Consumes: `buyPageHref`, `parseBuyPagePicks`, `parseIdParam` (Task 1); `withNext` (`src/lib/safe-next.ts`).
- Produces:

```ts
export type PreviewLink = {
  designId: string | null;
  front: string | null;
  back: string | null;
  product: string | null;
  size: string | null;
  color: string | null;
};
export function parsePreviewLink(search: Record<string, string | string[] | undefined>): PreviewLink;
export function previewPath(link: PreviewLink): string;
export function previewRedirectTarget(params: {
  link: PreviewLink;
  viewer: "none" | "other" | "owner";
  primaryImageId: string | null;
  inConversation: ReadonlySet<string>;
}): string;
export async function resolvePreviewRedirect(
  search: Record<string, string | string[] | undefined>,
  viewerId: string | null
): Promise<string>;
```

- [ ] **Step 1: Write the failing tests.** Seed with `makeUser`, `makeDesign`, `makeSourceImage` (`src/lib/__tests__/factories.ts`); set a primary with `await db.update(schema.design).set({ primaryImageId }).where(eq(schema.design.id, designId))`. Seed: user `owner` with conversation `conv` (images `primary` set as its primary, and `second`), a second conversation `otherConv` of `owner` (image `elsewhere`), a conversation `empty` of `owner` with an image but no primary, user `stranger`, and an image `hiddenPrimary` published and `isHidden: true` that is the primary of a conversation `hiddenConv` of `owner`. Use `const P = "bella-canvas-3001"`. One `it` each, asserting the returned string:

  - no `id` → `"/design"`; `id: "a b"` → `"/design"`.
  - viewer `null`, `{ id: conv, size: "M" }` → `"/sign-in?next=" + encodeURIComponent(\`/preview?id=${conv}&size=M\`)`.
  - viewer `null`, `{ id: conv, junk: "x", size: "9XL" }` → the `next` path is `/preview?id=${conv}` (unknown keys and invalid picks are not carried).
  - owner, `{ id: conv }` → `` `/d/${primary}?order=1` ``.
  - owner, `{ id: conv, product: P, size: "M", color: "Black" }` → `` `/d/${primary}?order=1&product=${P}&size=M&color=Black` ``.
  - owner, `{ id: conv, product: "discontinued-tee", size: "9XL", color: "Plaid" }` → `` `/d/${primary}?order=1` ``.
  - owner, `{ id: empty }` → `` `/design?id=${empty}` ``.
  - owner, `{ id: conv, front: second }` → `` `/d/${second}?order=1` ``.
  - owner, `{ id: conv, front: primary, back: second }` → `` `/d/${primary}?order=1&back=${second}` ``.
  - owner, swapped link `{ id: conv, front: elsewhere, back: primary }` → `` `/d/${primary}?order=1&back=${elsewhere}&swap=1` `` (Decision 2).
  - owner, `{ id: conv, front: elsewhere, back: "img-shop" }` (neither in `conv`) → `` `/d/${elsewhere}?order=1&back=img-shop` ``.
  - owner, `{ id: conv, front: second, back: second }` → `` `/d/${second}?order=1` ``.
  - owner, `{ id: hiddenConv }` → `` `/d/${hiddenPrimary}?order=1` `` (the page decides; Decision 4).
  - stranger, `{ id: conv }` → `"/design"`; stranger, `{ id: conv, front: second, size: "L" }` → `` `/d/${second}?order=1&size=L` `` (the page 404s a private image; the primary id is never in the result: also assert `.not.toContain(primary)` on the first).
  - repeated values: owner, `{ id: [conv, otherConv] }` → `` `/d/${primary}?order=1` ``.
  - **the Stripe `cancel_url` shape** (Review Focus 1). Build the query exactly as `createCheckoutSession` does at `src/app/order/actions.ts:154` and parse it back:

```ts
it("an old Stripe cancel_url from /preview lands on the same shirt", async () => {
  const qs = `id=${conv}&size=${encodeURIComponent("M")}&color=${encodeURIComponent("Athletic Heather")}&product=${P}&front=${second}&back=${primary}`;
  const search = Object.fromEntries(new URLSearchParams(qs));
  const target = new URL(await resolvePreviewRedirect(search, "owner"), "http://x.invalid");
  expect(target.pathname).toBe(`/d/${second}`);
  expect(Object.fromEntries(target.searchParams)).toEqual({
    order: "1", product: P, size: "M", color: "Athletic Heather", back: primary,
  });
});
```

  ("Athletic Heather" is in the Classic Tee palette, `src/lib/blanks.ts:189`; a two-word name checks the encoding round trip.)

- [ ] **Step 2: Run** `npx vitest run src/lib/__tests__/preview-redirect.integration.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement** `src/lib/preview-redirect.ts`:

```ts
/**
 * Where an old `/preview` link goes now (#278 slice 4). `/preview` was the
 * design-your-own buy page; the image detail page replaced it. Links to it
 * outlive the page: Stripe cancel and Back links from sessions created before
 * the deploy, `/order?…` (which forwards here), sign-in `next=` values,
 * bookmarks. Each lands on the image detail page of the image it showed, with
 * the panel open and the same picks.
 *
 * This only chooses a page. Who may buy, and which back may print, stay the
 * page's decisions (`resolveBuyableImage`, `resolveInitialBack`); a stale or
 * forged link opens a page that refuses what it must.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversationImage, design as designTable } from "@/lib/db/schema";
import {
  buyPageHref,
  parseBuyPagePicks,
  parseIdParam,
} from "@/lib/buy-page-picks";
import { withNext } from "@/lib/safe-next";

type Search = Record<string, string | string[] | undefined>;

export type PreviewLink = {
  designId: string | null;
  front: string | null;
  back: string | null;
  product: string | null;
  size: string | null;
  color: string | null;
};

/** The parameters `/preview` read, validated the way the image page validates its own. */
export function parsePreviewLink(search: Search): PreviewLink {
  const picks = parseBuyPagePicks({
    product: search.product,
    size: search.size,
    color: search.color,
    back: search.back,
  });
  return {
    designId: parseIdParam(search.id),
    front: parseIdParam(search.front),
    back: picks.back,
    product: picks.product,
    size: picks.size,
    color: picks.color,
  };
}

/** The `/preview` link rebuilt from the parsed values only, for the sign-in detour. */
export function previewPath(link: PreviewLink): string {
  const params = new URLSearchParams();
  const entries: [string, string | null][] = [
    ["id", link.designId],
    ["front", link.front],
    ["back", link.back],
    ["product", link.product],
    ["size", link.size],
    ["color", link.color],
  ];
  for (const [key, value] of entries) if (value) params.set(key, value);
  const qs = params.toString();
  return qs ? `/preview?${qs}` : "/preview";
}

/**
 * The decision, given what the DB said. `inConversation` holds which of the
 * front (or primary) and back are images of the link's conversation.
 *
 *  - no conversation id: `/design`, as `/preview` did;
 *  - signed out: sign-in, coming back to this same link;
 *  - a viewer who does not own the conversation: the front's page if the link
 *    names one (the page shows a published image and 404s a private one),
 *    else `/design`. The conversation's primary is never revealed;
 *  - the owner: the front's page, or the primary's; `/design?id=` when there
 *    is neither, as `/preview` did. A swapped link (front from elsewhere, back
 *    from this conversation) opens the back's page with `swap=1`: the same
 *    shirt, ordered on the conversation the link named.
 */
export function previewRedirectTarget(params: {
  link: PreviewLink;
  viewer: "none" | "other" | "owner";
  primaryImageId: string | null;
  inConversation: ReadonlySet<string>;
}): string {
  const { link, viewer, primaryImageId, inConversation } = params;
  if (!link.designId) return "/design";
  if (viewer === "none") return withNext("/sign-in", previewPath(link));

  const picks = {
    order: true,
    product: link.product,
    size: link.size,
    color: link.color,
  };

  if (viewer === "other") {
    if (!link.front) return "/design";
    const back = link.back && link.back !== link.front ? link.back : null;
    return buyPageHref(link.front, { ...picks, back });
  }

  const front = link.front ?? primaryImageId;
  if (!front) return `/design?id=${link.designId}`;
  const back = link.back && link.back !== front ? link.back : null;
  if (back && !inConversation.has(front) && inConversation.has(back)) {
    return buyPageHref(back, { ...picks, back: front, swap: true });
  }
  return buyPageHref(front, { ...picks, back });
}

/** Read what the decision needs and make it. */
export async function resolvePreviewRedirect(
  search: Search,
  viewerId: string | null
): Promise<string> {
  const link = parsePreviewLink(search);
  const none = new Set<string>();
  if (!link.designId) {
    return previewRedirectTarget({ link, viewer: "none", primaryImageId: null, inConversation: none });
  }
  if (!viewerId) {
    return previewRedirectTarget({ link, viewer: "none", primaryImageId: null, inConversation: none });
  }

  const [row] = await db
    .select({ userId: designTable.userId, primaryImageId: designTable.primaryImageId })
    .from(designTable)
    .where(eq(designTable.id, link.designId))
    .limit(1);
  if (!row || row.userId !== viewerId) {
    return previewRedirectTarget({ link, viewer: "other", primaryImageId: null, inConversation: none });
  }

  const front = link.front ?? row.primaryImageId;
  const candidates = [front, link.back].filter((v): v is string => Boolean(v));
  const linked =
    candidates.length > 0
      ? await db
          .select({ imageId: conversationImage.imageId })
          .from(conversationImage)
          .where(
            and(
              eq(conversationImage.designId, link.designId),
              inArray(conversationImage.imageId, candidates)
            )
          )
      : [];
  return previewRedirectTarget({
    link,
    viewer: "owner",
    primaryImageId: row.primaryImageId,
    inConversation: new Set(linked.map((r) => r.imageId)),
  });
}
```

  (`previewRedirectTarget` returns `/design` before it looks at `viewer` when there is no id, so the first early return could pass any viewer; it passes `"none"` only because no lookup ran.)

- [ ] **Step 4: Run** the test file and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** — `git add src/lib/preview-redirect.ts src/lib/__tests__/preview-redirect.integration.test.ts && git commit -m "preview-redirect: where an old /preview link goes (#278 slice 4)"`

### Task 3: `/preview` becomes the redirect

**Files:**
- Replace: `src/app/preview/page.tsx`
- Delete: `src/app/preview/__tests__/preview-sides.test.tsx`
- Create: `src/app/preview/__tests__/preview-redirect-page.test.ts`, `e2e/preview-redirect.spec.ts`
- Modify: `e2e/helpers/db.ts` (add `clearPrimaryImage`)

**Interfaces:**
- Consumes: `resolvePreviewRedirect` (Task 2).
- Produces: `clearPrimaryImage(designId: string): Promise<void>` in `e2e/helpers/db.ts`.

- [ ] **Step 1: Write the failing page test** (`preview-redirect-page.test.ts`, node environment):

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  session: null as unknown,
  sessionThrows: false,
  resolve: vi.fn(async () => "/d/img-1?order=1"),
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  }),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: h.redirect }));
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => {
        if (h.sessionThrows) throw new Error("auth down");
        return h.session;
      },
    },
  },
}));
vi.mock("@/lib/preview-redirect", () => ({ resolvePreviewRedirect: h.resolve }));

import PreviewRedirectPage from "../page";

beforeEach(() => {
  h.session = null;
  h.sessionThrows = false;
  h.resolve.mockClear();
  h.redirect.mockClear();
});

describe("/preview redirects (#278 slice 4)", () => {
  it("passes the query and the viewer to the resolver and redirects to its answer", async () => {
    h.session = { user: { id: "u1" } };
    const searchParams = Promise.resolve({ id: "d1", size: "M" });
    await expect(PreviewRedirectPage({ searchParams })).rejects.toThrow(
      "NEXT_REDIRECT /d/img-1?order=1"
    );
    expect(h.resolve).toHaveBeenCalledWith({ id: "d1", size: "M" }, "u1");
  });

  it("treats a failed session read as signed out", async () => {
    h.sessionThrows = true;
    await expect(
      PreviewRedirectPage({ searchParams: Promise.resolve({ id: "d1" }) })
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(h.resolve).toHaveBeenCalledWith({ id: "d1" }, null);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/app/preview/__tests__/preview-redirect-page.test.ts`. Expected: FAIL (the page is a client component with no such behaviour).

- [ ] **Step 3: Replace `src/app/preview/page.tsx`** with:

```tsx
/**
 * `/preview` was the design-your-own buy page. The image detail page replaced
 * it (one buy surface, #278 slice 4); this route stays so the links to it that
 * outlive the page still work: Stripe cancel and Back links from sessions
 * created before the change, `/order?…` (which forwards here), sign-in
 * `next=` values, bookmarks. `src/lib/preview-redirect.ts` decides where each
 * goes. A temporary redirect, because the answer depends on who is signed in
 * and on the conversation's current primary image.
 */
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { resolvePreviewRedirect } from "@/lib/preview-redirect";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function PreviewRedirectPage({
  searchParams,
}: {
  searchParams: Search;
}) {
  const sp = await searchParams;
  let viewerId: string | null = null;
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    viewerId = session?.user.id ?? null;
  } catch (err) {
    // Degrade to signed out (the redirect then offers sign-in), not a 500.
    console.error("/preview session read failed:", err);
  }
  // Outside the try: redirect() throws to do its work.
  redirect(await resolvePreviewRedirect(sp, viewerId));
}
```

  Delete `src/app/preview/__tests__/preview-sides.test.tsx` (it tests the client this replaces). Leave `src/app/preview/actions.ts` alone in this task (Task 8 trims it).

- [ ] **Step 4: Run** `npx vitest run src/app/preview && npm run typecheck`. Expected: PASS. (`preview/actions.ts`'s exports have no caller now; typecheck does not flag unused exports.)

- [ ] **Step 5: Add the e2e helper** to `e2e/helpers/db.ts`:

```ts
/** Clear a design's primary image, for the "conversation with no primary" case. */
export async function clearPrimaryImage(designId: string): Promise<void> {
  await db().execute({
    sql: "UPDATE design SET primary_image_id = NULL WHERE id = ?",
    args: [designId],
  });
}
```

- [ ] **Step 6: Write `e2e/preview-redirect.spec.ts`.** A real request through the compiled build, for both Playwright projects (mobile and desktop). The panel rewrites the address bar after it mounts (`replaceState` adds the default product and colour), so assert on parsed parameters, never on the exact URL string.

```ts
/**
 * One buy surface, slice 4 (#278): an old /preview link opens the image
 * detail page of the image it showed, with the panel open and the same picks.
 * A conversation with no primary image goes to the conversation; /order (which
 * forwards to /preview) still lands; a signed-out visitor goes to sign-in and
 * is brought back to the same link.
 */
import { test, expect, type Page } from "@playwright/test";
import {
  userIdForSessionCookie,
  seedDesign,
  cleanupDesigns,
  cleanupUser,
  primaryImageIdForDesign,
  clearPrimaryImage,
} from "./helpers/db";
import { waitForSessionCookie } from "./helpers/session";
import { signUpFreshAccount } from "./helpers/auth";

const PRODUCT = "bella-canvas-3001";

async function landedOn(page: Page, imageId: string) {
  await page.waitForURL(
    (url) => url.pathname === `/d/${imageId}` && url.searchParams.get("order") === "1",
    { timeout: 30_000 }
  );
  return new URL(page.url()).searchParams;
}

test("an old /preview link opens the image detail page with the same picks (#278 slice 4)", async ({ page }, testInfo) => {
  const key = `preview-redirect-${Date.now()}-${testInfo.project.name}`;
  const seeded: string[] = [];
  let ownerId = "";
  try {
    await signUpFreshAccount(page, key);
    ownerId = await userIdForSessionCookie(await waitForSessionCookie(page));
    const withPrimary = await seedDesign(ownerId, `${key}-a`);
    const noPrimary = await seedDesign(ownerId, `${key}-b`);
    seeded.push(withPrimary, noPrimary);
    const primary = (await primaryImageIdForDesign(withPrimary))!;
    await clearPrimaryImage(noPrimary);

    // 1. A conversation with a primary: its page, panel open.
    await page.goto(`/preview?id=${withPrimary}`);
    await landedOn(page, primary);
    await expect(page.getByTestId("order-expand")).toHaveCount(0);

    // 2. Picks in the query come along.
    await page.goto(`/preview?id=${withPrimary}&product=${PRODUCT}&size=M&color=Black`);
    const picks = await landedOn(page, primary);
    expect(picks.get("product")).toBe(PRODUCT);
    expect(picks.get("size")).toBe("M");
    expect(picks.get("color")).toBe("Black");
    await expect(page.getByRole("button", { name: "M", exact: true }).first()).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Color — Black")).toBeVisible();

    // 3. No primary: the conversation, as /preview did.
    await page.goto(`/preview?id=${noPrimary}`);
    await page.waitForURL(
      (url) => url.pathname === "/design" && url.searchParams.get("id") === noPrimary,
      { timeout: 30_000 }
    );

    // 4. /order forwards to /preview, which redirects on.
    await page.goto(`/order?id=${withPrimary}&size=L`);
    expect((await landedOn(page, primary)).get("size")).toBe("L");
  } finally {
    await cleanupDesigns(seeded);
    if (ownerId) await cleanupUser(ownerId);
  }
});

test("signed out, an old /preview link goes to sign-in and comes back to it (#278 slice 4)", async ({ browser }, testInfo) => {
  const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  try {
    const page = await context.newPage();
    await page.goto("/preview?id=e2e-not-mine&size=M");
    await page.waitForURL(
      (url) =>
        url.pathname === "/sign-in" &&
        url.searchParams.get("next") === "/preview?id=e2e-not-mine&size=M",
      { timeout: 30_000 }
    );
  } finally {
    await context.close();
  }
});
```

  Use the session-cookie name and the `signUpFreshAccount` helper exactly as `e2e/owner-buy.spec.ts` does. If the size button query matches more than one element on either project, keep `.first()`; if it matches none, read how `owner-buy.spec.ts` clicks "L" and match it.

- [ ] **Step 7: Run** `npm run e2e -- e2e/preview-redirect.spec.ts`. Expected: PASS on both projects. (The first guest or sign-up mint can exceed 15s and pass on retry; that is the known flake in `CLAUDE.md`, not this test.)
- [ ] **Step 8: Commit** — `git add -A src/app/preview e2e/helpers/db.ts e2e/preview-redirect.spec.ts && git commit -m "/preview redirects to the image detail page with the same picks (#278 slice 4)"`

### Task 4: the Studio lightbox's Order opens the image detail page

**Files:**
- Modify: `src/app/studio/studio-client.tsx:17`, `:1625-1642`; `src/lib/nav.ts` (`DETAIL_ORIGINS`, `detailParent`); `src/lib/placement-pins.ts` (delete `previewOrderHref`)
- Test: `src/app/studio/__tests__/studio-client.test.tsx:241-283`, `src/lib/__tests__/nav.test.ts`, `src/lib/__tests__/placement-pins.test.ts:143-149`

- [ ] **Step 1: Change the tests first.** In `studio-client.test.tsx`, retitle "the lightbox row offers Order to /preview with the shown image as the front" to "the lightbox row offers Order to the shown image's image detail page, panel open" and change its two expectations to `"/d/img-2?order=1&from=%2Fstudio"` and `"/d/img-1?order=1&from=%2Fstudio"`. Replace "no Order in the lightbox when the lane has no primary image (/preview would bounce it)" with:

```tsx
  it("offers Order in a lane with no primary image (the image page needs none)", () => {
    render(
      <StudioClient
        initialLanes={[lane({ designId: "design-1", cells: [cell("img-1")] })]}
      />
    );
    fireEvent.click(screen.getByTestId("studio-cell"));
    const lightbox = screen.getByTestId("image-lightbox");
    expect(
      within(lightbox).getByRole("link", { name: "Order" }).getAttribute("href")
    ).toBe("/d/img-1?order=1&from=%2Fstudio");
    expect(within(lightbox).getByTestId("lightbox-edit")).toBeTruthy();
  });
```

  In `nav.test.ts` add:

```ts
it("an image detail page opened from the Studio steps up to the Studio (#278 slice 4)", () => {
  expect(breadcrumbTrail("/d/img-1", { from: "/studio" }).at(-1)).toEqual({
    label: "Studio",
    href: "/studio",
  });
  expect(detailFrom("/studio", false)).toBe("/studio");
  expect(detailFrom("/studio", true)).toBe("/studio");
});
```

  (Import `detailFrom` if the file does not already.) Delete the `describe("previewOrderHref")` block from `placement-pins.test.ts` and its import.

- [ ] **Step 2: Run** `npx vitest run src/app/studio/__tests__/studio-client.test.tsx src/lib/__tests__/nav.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.** `studio-client.tsx`: replace the `previewOrderHref` import with `import { buyPageHref } from "@/lib/buy-page-picks";` and the Order block with:

```tsx
              {/* Order opens the shown image's image detail page with the
                  panel open (one buy surface, #278 slice 4). The image is the
                  page, so a later primary change can't swap what gets
                  ordered, and no primary is needed: the page's own gate
                  decides whether this viewer may order it. */}
              {!selectMode && (
                <Link
                  href={buyPageHref(lane.cells[lightboxIndex].imageId, {
                    order: true,
                    from: "/studio",
                  })}
                  data-testid="lightbox-order"
                  // Mirrors Button's primary variant (src/components/ui/button.tsx); it is a link, so it can't use Button.
                  className="inline-flex min-h-11 items-center rounded-md border border-foreground px-4 text-sm font-medium text-foreground transition-colors hover:bg-surface-well"
                >
                  Order
                </Link>
              )}
```

  `nav.ts`: add `"/studio"` to `DETAIL_ORIGINS` and a `case "/studio": return { label: "Studio", href: "/studio" };` in `detailParent`; mention the Studio in the comment above `DETAIL_ORIGINS`. `placement-pins.ts`: delete `previewOrderHref` and its comment.

- [ ] **Step 4: Run** `npx vitest run src/app/studio src/lib/__tests__/nav.test.ts src/lib/__tests__/placement-pins.test.ts && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** — `"Studio: Order opens the image detail page with the panel open (#278 slice 4)"`

### Task 5: the conversation page's Order links open the image detail page

**Files:**
- Modify: `src/app/design/design-client.tsx:750-778`; `src/app/design/image-gallery.tsx:30` (comment)

**Interfaces:**
- Consumes: `conversationOrderHref` (Task 1).

The conversation page has no render test harness (`DesignPageClient` needs a thread payload, polling and many actions). Its links are pinned by Task 1's unit tests on `conversationOrderHref` and by Task 9's guard, which fails if a `/preview` literal comes back into `design-client.tsx`.

- [ ] **Step 1: Implement.** Import `conversationOrderHref` from `@/lib/buy-page-picks` and replace the three handlers (and fix the `/preview` mention in the comment above `handleSelectImage` to "the hero, the image detail page and the My Designs card thumbnail"):

```tsx
  // Order (#278 slice 4): the image detail page of the image in question,
  // panel open. Nothing happens if the URL names no image in this thread.
  function openOrder(imageUrl: string | null, productId?: string) {
    const href = conversationOrderHref(images, imageUrl, productId);
    if (href) router.push(href);
  }

  function handleMakeProducts() {
    openOrder(selectedImage);
  }

  async function handleMakeProductsForImage(imageUrl: string) {
    // The conversation's primary still follows the pick (#147), so the hero
    // and the My Designs card agree with what the buyer chose to order.
    await selectImage(designId.current, imageUrl);
    setSelectedImage(imageUrl);
    openOrder(imageUrl);
  }

  function handleSelectProductVersion(productId: string) {
    openOrder(selectedImage, productId);
  }
```

  In `image-gallery.tsx:30`, rewrite the comment that says choosing a product is "/preview's job" to say the image detail page does it.

- [ ] **Step 2: Run** `npm run lint && npm run typecheck && npx vitest run src/app/design src/lib/__tests__/buy-page-picks.test.ts`. Expected: PASS.
- [ ] **Step 3: Check by hand** in `npm run dev` (Nico runs the dev server; ask him, or use `npm run build && npm run start -- -p 3100` with CI's dummy env): open a conversation, click **Order →** under the stage; the browser lands on `/d/<that image>?order=1…` with the panel open. Record the result in the task report.
- [ ] **Step 4: Commit** — `"Conversation page: Order opens the image detail page (#278 slice 4)"`

### Task 6: links to the conversation's other images carry the open panel's picks

**Files:**
- Create: `src/app/d/[imageId]/buy-panel-picks-context.tsx`
- Modify: `src/app/d/[imageId]/page.tsx` (wrap the content), `buy-panel.tsx` (report), `conversation-images.tsx` (`href`)
- Test: `src/app/d/[imageId]/__tests__/buy-panel.test.tsx`, `conversation-images.test.tsx`; `e2e/owner-buy.spec.ts`; `e2e/helpers/db.ts` (add `seedConversationImage`)

**Interfaces:**
- Consumes: `OpenBuyPanelPicks`, `siblingImageHref` (Task 1).
- Produces: `BuyPanelPicksProvider`, `useOpenBuyPanelPicks(): OpenBuyPanelPicks`, `useReportBuyPanelPicks(): (picks: OpenBuyPanelPicks) => void` in `buy-panel-picks-context.tsx`; `seedConversationImage(designId: string, ownerId: string, imageId: string, imageUrl: string): Promise<void>` in `e2e/helpers/db.ts`.

- [ ] **Step 1: Write the failing component tests.** In `buy-panel.test.tsx`:

```tsx
import {
  BuyPanelPicksProvider,
  useOpenBuyPanelPicks,
} from "../buy-panel-picks-context";

function Probe() {
  return <output data-testid="probe">{JSON.stringify(useOpenBuyPanelPicks())}</output>;
}
const probe = () => JSON.parse(screen.getByTestId("probe").textContent ?? "null");

describe("BuyPanel reports its open picks to the page (#278 slice 4)", () => {
  it("reports nothing while collapsed, the picks while open, nothing after Cancel", () => {
    render(
      <BuyPanelPicksProvider>
        <BuyPanel imageId="img-1" isLoggedIn />
        <Probe />
      </BuyPanelPicksProvider>
    );
    expect(probe()).toBeNull();
    expand();
    expect(probe()).toMatchObject({ product: "bella-canvas-3001", size: null, back: null, swap: false });
    expect(typeof probe().color).toBe("string");
    fireEvent.click(screen.getByRole("button", { name: "M" }));
    expect(probe().size).toBe("M");
    fireEvent.click(screen.getAllByRole("button", { name: "Cancel" })[0]);
    expect(probe()).toBeNull();
  });

  it("renders without a provider (the panel's other tests do)", () => {
    render(<BuyPanel imageId="img-1" isLoggedIn />);
    expand();
    expect(screen.getByText("Size")).toBeInTheDocument();
  });
});
```

  (`expand()` is the file's existing helper. If the default product is not `bella-canvas-3001`, use `DEFAULT_BLANK_ID` from `@/lib/blanks`.)

  In `conversation-images.test.tsx`:

```tsx
import { useEffect } from "react";
import type { OpenBuyPanelPicks } from "@/lib/buy-page-picks";
import {
  BuyPanelPicksProvider,
  useReportBuyPanelPicks,
} from "../buy-panel-picks-context";

function Report({ picks }: { picks: OpenBuyPanelPicks }) {
  const report = useReportBuyPanelPicks();
  useEffect(() => report(picks), [report, picks]);
  return null;
}

const OPEN_L = { product: "bella-canvas-3001", size: "L", color: "Black", back: null, swap: false };
const OPEN_BACK_C = { ...OPEN_L, back: "img-c", swap: true };
const OPEN_BACK_X = { ...OPEN_L, back: "img-x", swap: true };

function renderWithPicks(picks: OpenBuyPanelPicks) {
  return render(
    <BuyPanelPicksProvider>
      <Report picks={picks} />
      <ConversationImages
        designId="d1"
        currentImageId="img-b"
        images={images}
        initialPrimaryImageId="img-a"
        from="/designs"
      />
    </BuyPanelPicksProvider>
  );
}

const openHref = () =>
  new URL(lightbox().getByRole("link", { name: "Open" }).getAttribute("href")!, "http://x.invalid");

describe("ConversationImages carries the open panel's picks (#278 slice 4)", () => {
  it("with the panel open at size L, Open keeps product, size and colour", () => {
    renderWithPicks(OPEN_L);
    fireEvent.click(thumb(3));
    const href = openHref();
    expect(href.pathname).toBe("/d/img-c");
    expect(href.searchParams.get("order")).toBe("1");
    expect(href.searchParams.get("size")).toBe("L");
    expect(href.searchParams.get("color")).toBe("Black");
    expect(href.searchParams.get("product")).toBe("bella-canvas-3001");
    expect(href.searchParams.get("from")).toBe("/designs");
  });

  it("with the panel collapsed, Open is the plain link", () => {
    renderWithPicks(null);
    fireEvent.click(thumb(3));
    expect(lightbox().getByRole("link", { name: "Open" })).toHaveAttribute(
      "href",
      "/d/img-c?from=%2Fdesigns"
    );
  });

  it("keeps the back and the swap for a sibling that is not the back", () => {
    renderWithPicks(OPEN_BACK_X);
    fireEvent.click(thumb(3));
    expect(openHref().searchParams.get("back")).toBe("img-x");
    expect(openHref().searchParams.get("swap")).toBe("1");
  });

  it("drops the back and the swap when the sibling is the back", () => {
    renderWithPicks(OPEN_BACK_C);
    fireEvent.click(thumb(3));
    expect(openHref().searchParams.get("back")).toBeNull();
    expect(openHref().searchParams.get("swap")).toBeNull();
  });
});
```

  (`thumb`, `lightbox` and `images` are the file's existing helpers and fixture; thumbnail `#3` is `img-c`.)

- [ ] **Step 2: Run** `npx vitest run "src/app/d/[imageId]"`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement the context** (`buy-panel-picks-context.tsx`):

```tsx
"use client";

/**
 * The buy panel's open picks, shared with the rest of the image detail page
 * (#278 slice 4). The links to the conversation's other images carry them, so
 * switching the image keeps product, size and colour. Context rather than the
 * address bar: the panel's replaceState is not seen by Next's router, so
 * useSearchParams would not follow it. Without a provider the report is a
 * no-op and the picks read null.
 */
import { createContext, useContext, useState, type ReactNode } from "react";
import type { OpenBuyPanelPicks } from "@/lib/buy-page-picks";

const PicksContext = createContext<OpenBuyPanelPicks>(null);
const noReport = () => {};
const ReportContext = createContext<(picks: OpenBuyPanelPicks) => void>(noReport);

export function BuyPanelPicksProvider({ children }: { children: ReactNode }) {
  const [picks, setPicks] = useState<OpenBuyPanelPicks>(null);
  return (
    <ReportContext.Provider value={setPicks}>
      <PicksContext.Provider value={picks}>{children}</PicksContext.Provider>
    </ReportContext.Provider>
  );
}

export function useOpenBuyPanelPicks(): OpenBuyPanelPicks {
  return useContext(PicksContext);
}

export function useReportBuyPanelPicks(): (picks: OpenBuyPanelPicks) => void {
  return useContext(ReportContext);
}
```

  `buy-panel.tsx`, after the URL-sync effect:

```tsx
  // Tell the page what the open panel holds (#278 slice 4), so the links to
  // this conversation's other images carry the same shirt. Null while
  // collapsed, so a browsing visitor's links stay plain.
  const reportPicks = useReportBuyPanelPicks();
  useEffect(() => {
    reportPicks(
      expanded
        ? {
            product: productId,
            size,
            color,
            back: back?.id ?? null,
            swap: swapped && !!back,
          }
        : null
    );
  }, [reportPicks, expanded, productId, size, color, back, swapped]);
```

  `conversation-images.tsx`: with the other hooks at the top of the component (before the early returns), `const openPicks = useOpenBuyPanelPicks();`, and replace `href` with `const href = (imageId: string) => siblingImageHref(imageId, openPicks, from);`. Update the component's doc comment: with the panel open, Open carries the picks (this is how the front is changed without re-picking size and colour, which `/preview`'s front picker used to do).

  `page.tsx`: import `BuyPanelPicksProvider` and wrap everything inside `<div className="max-w-3xl mx-auto space-y-4">` in it (both `BuyHero` and `ConversationImages` must be inside).

- [ ] **Step 4: Run** `npx vitest run "src/app/d/[imageId]" && npm run typecheck`. Expected: PASS, every pre-existing test included.

- [ ] **Step 5: Add the e2e helper and test.** `e2e/helpers/db.ts`:

```ts
/** Add another output image to a seeded conversation (cleaned up by cleanupDesigns via source_design_id). */
export async function seedConversationImage(
  designId: string,
  ownerId: string,
  imageId: string,
  imageUrl: string
): Promise<void> {
  const c = db();
  await c.execute({
    sql: `INSERT INTO image (id, owner_id, r2_key, image_url, aspect_ratio, generation_cost, source_design_id, created_at)
          VALUES (?, ?, NULL, ?, '1:1', 0, ?, unixepoch())
          ON CONFLICT(id) DO NOTHING`,
    args: [imageId, ownerId, imageUrl, designId],
  });
  await c.execute({
    sql: `INSERT INTO conversation_image (id, design_id, image_id, role, created_at)
          VALUES (?, ?, ?, 'output', unixepoch())
          ON CONFLICT(design_id, image_id, role) DO NOTHING`,
    args: [`${imageId}-link`, designId, imageId],
  });
}
```

  `e2e/owner-buy.spec.ts`, a second test (same setup as the first: `signUpFreshAccount`, `seedDesign`, cleanup in `finally`):

```ts
test("switching to another image of the conversation with the panel open keeps size and colour (#278 slice 4)", async ({ page }, testInfo) => {
  const key = `owner-sibling-${Date.now()}-${testInfo.project.name}`;
  const seeded: string[] = [];
  let ownerId = "";
  try {
    await signUpFreshAccount(page, key);
    ownerId = await userIdForSessionCookie(await waitForSessionCookie(page));
    const designId = await seedDesign(ownerId, key, "https://placehold.co/1024x1024/png?text=A");
    seeded.push(designId);
    const first = (await primaryImageIdForDesign(designId))!;
    const second = `e2e-${key}-img2`;
    await seedConversationImage(designId, ownerId, second, "https://placehold.co/1024x1024/png?text=B");

    await page.goto(`/d/${first}?order=1&product=bella-canvas-3001&size=L&color=Black`);
    await expect(page.getByText("Total")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("conversation-image-thumb").first().click();
    await page.getByTestId("image-lightbox").getByRole("link", { name: "Open" }).click();

    await page.waitForURL((url) => url.pathname === `/d/${second}`, { timeout: 30_000 });
    const params = new URL(page.url()).searchParams;
    expect(params.get("order")).toBe("1");
    expect(params.get("size")).toBe("L");
    expect(params.get("color")).toBe("Black");
    await expect(page.getByRole("button", { name: "L", exact: true }).first()).toHaveAttribute("aria-pressed", "true");
  } finally {
    await cleanupDesigns(seeded);
    if (ownerId) await cleanupUser(ownerId);
  }
});
```

- [ ] **Step 6: Run** `npm run e2e -- e2e/owner-buy.spec.ts`. Expected: PASS on both projects. Check at 390px (the mobile project) that the strip and the lightbox's Open stay reachable above the sticky bar; note it in the report.
- [ ] **Step 7: Commit** — `"Image detail page: links to the conversation's other images keep the open panel's picks (#278 slice 4)"`

### Task 7: the e2e specs and the nightly drive the image detail page

**Files:**
- Modify: `e2e/cart.spec.ts`, `e2e/stripe-money-path.spec.ts`, `.github/workflows/stripe-e2e.yml`, `docs/stripe-e2e.md`

- [ ] **Step 1: `cart.spec.ts`.** Replace `addToCartFromPreviewPage` with:

```ts
async function addToCartFromImagePage(page: Page, designId: string) {
  const imageId = await primaryImageIdForDesign(designId);
  expect(imageId, "seeded design has no primary image").toBeTruthy();
  // The link's size pre-selects visibly (no silent default), so no extra click.
  await page.goto(`/d/${imageId}?order=1&product=${PRODUCT}&color=Black&size=M`);
  // The Total row renders only once the panel is open with a size, i.e. after
  // hydration, so the click below can't land before its handler.
  await expect(page.getByText("Total")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Add to cart" }).first().click();
  await page.waitForURL(/\/cart/);
  // #101 guard: hold the URL for a moment so a bounce back fails here, loudly.
  await page.waitForTimeout(1_000);
  await expect(page).toHaveURL(/\/cart/);
}
```

  Import `primaryImageIdForDesign`; rename both call sites; rewrite the header comment ("from /preview" → "from each image's image detail page") and the DB-check comment ("the image path pins the page image, which is each design's primary").

- [ ] **Step 2: `stripe-money-path.spec.ts`.** Make the same change to its `addToCartFromPreviewPage` helper (keep its 30s `waitForURL` timeout). Replace the `/preview` test with:

```ts
  test("an old /preview link → image detail page → embedded checkout → signed webhook → submitted order + sale/fee ledger", async ({ page }, testInfo) => {
```

  Body: the image-detail-page test's body, except the navigation is `await page.goto(\`/preview?id=${seeded[0]}&product=${PRODUCT}&color=Black&size=M\`)` followed by `await page.waitForURL((url) => url.pathname === \`/d/${imageId}\` && url.searchParams.get("size") === "M", { timeout: 30_000 })`, and it requires `EMBEDDED_CHECKOUT_ENABLED` as that test does. Keep its assertions on the order (`submitted`, dry-run Printful id, `sale` and `stripe_fee`, one `order_item` on `seeded[0]` with `placements.front` the primary). Remove every mention of `PREVIEW_EMBEDDED_CHECKOUT_ENABLED` from the file, and rewrite the header comment: three tests, the cart on hosted checkout, the image detail page on embedded checkout twice (once from an old `/preview` link).

- [ ] **Step 3: `stripe-e2e.yml`.** Delete `PREVIEW_EMBEDDED_CHECKOUT_ENABLED: "true"` and the comment above it that is about `/preview`; keep the publishable-key explanation, reattached to `EMBEDDED_CHECKOUT_ENABLED`. Fix the header comment's list of what pays where.
- [ ] **Step 4: `docs/stripe-e2e.md`.** Rewrite lines 12-17, 82-83 and 103-104 to match: no test reads `PREVIEW_EMBEDDED_CHECKOUT_ENABLED` since slice 4; the switch and its code go in slice 6.
- [ ] **Step 5: Run** `npm run e2e -- e2e/cart.spec.ts`. Expected: PASS. The nightly cannot run locally without Stripe; it is dispatched in the close task.
- [ ] **Step 6: Commit** — `"e2e: cart and nightly order from the image detail page; an old /preview link in the nightly (#278 slice 4)"`

### Task 8: remove what only the old `/preview` client used

**Files:**
- Modify: `src/app/preview/actions.ts`, `src/app/design/actions.ts`, `src/lib/mockup-render.ts`, `src/lib/placement-pins.ts`, `src/lib/nav.ts`, `src/lib/blanks.ts`, `src/app/__tests__/server-action-exports.test.ts`, `docs/products.md`
- Delete: `src/lib/mockup-prefetch.ts`, `src/lib/__tests__/mockup-prefetch.test.ts`, `src/lib/__tests__/mockup-prefetch-writeback.test.ts`, `src/app/preview/__tests__/generate-mockup-front-source.integration.test.ts`, `src/app/preview/__tests__/placement-render-anchor.integration.test.ts`, `src/app/preview/__tests__/generate-mockup-source-guard.integration.test.ts`
- Create: `src/lib/__tests__/mockup-render-source-guard.integration.test.ts`
- Test: `src/lib/__tests__/mockup-render.test.ts`, `src/lib/__tests__/placement-pins.test.ts`, `src/lib/__tests__/nav.test.ts`, `src/lib/__tests__/composition-read-swap.integration.test.ts`

**Interfaces:**
- Produces: `RenderMockupParams.sourceImageId: string` (required); `foldPrimaryFront` removed. The two callers, `getListingMockup` and `getListingBackMockup` (`src/app/d/actions.ts`), already pass a source.

- [ ] **Step 1: List callers first, in the task report.** For each of `generateMockup`, `getOrCreatePlacementRender`, `ensureMockupsPrefetched`, `getBackDesignSources`, `isMultiPlacementEnabled`, `getDesign`, `prefetchProductMockups`, `prefetchColors`, `foldPrimaryFront`, `normalizeFrontPin`, `swapPlacementPins`, `withFront`, `PlacementPins`: `grep -rn "\bNAME\b" src e2e scripts`. Expected: no product-code caller outside the files this task edits or deletes. If one exists, stop and report it.

- [ ] **Step 2: Port the source-guard test first** (it pins `aaf708d`, which lives in shared code). Create `src/lib/__tests__/mockup-render-source-guard.integration.test.ts` from `src/app/preview/__tests__/generate-mockup-source-guard.integration.test.ts`: same mocks for `@/lib/db`, `@/lib/printful`, `@/lib/r2` and `fetch`, same seed, but call `renderAndCacheMockup` directly with what `generateMockup` passed after its owner check:

```ts
const call = (ids: { sellerImg: string; theirDesign: string }) =>
  renderAndCacheMockup({
    designId: ids.theirDesign,
    productId: "bella-canvas-3001",
    colorName: "White",
    scale: 1.0,
    placementId: "back",
    sourceImageId: ids.sellerImg,
    userId: "stranger",
  });
```

  Keep all four cases with their assertions (refused after unpublish with the back render cached: rejects with "Source image is not available for this design" and Printful is not called; refused when admin-hidden; a cached mockup URL keyed on the unpublished source is refused and not returned; still served while the source is published). Then delete the old file.

- [ ] **Step 3: Run** `npx vitest run src/lib/__tests__/mockup-render-source-guard.integration.test.ts`. Expected: PASS against the current `renderAndCacheMockup`.

- [ ] **Step 4: Remove the actions.** `src/app/preview/actions.ts` keeps only `getLastPurchaseDefaults` (the image detail page and `src/app/shop/[slug]/[productId]/page.tsx` import it; slice 6 moves it). Delete the other five exports, `REFRAME_PROMPT` and the imports nothing uses any more. Update the pin in `server-action-exports.test.ts` to `"src/app/preview/actions.ts": ["getLastPurchaseDefaults"]`. Delete `generate-mockup-front-source.integration.test.ts` and `placement-render-anchor.integration.test.ts` (they test the removed actions; the anchored-lookup rule they pinned stays covered by `mockup-render.test.ts`'s `findPlacementRender` cases; name the case that covers it in the report, or port one if none does).

- [ ] **Step 5: Remove `getDesign`** from `src/app/design/actions.ts` and the `describe("getDesign backdrop reads the mirror product")` block (and the now-unused import) in `composition-read-swap.integration.test.ts`. The image detail page reads the backdrop through `getImagePage`, which has its own test. Fix the two comments that mention `getDesign` (`src/lib/design-thread.ts:31`, `src/app/cart/actions.ts:177`) so they describe what is true now.

- [ ] **Step 6: Make the mockup source required.** In `src/lib/mockup-render.ts`:
  - `sourceImageId: string` (required) and delete `foldPrimaryFront` from `RenderMockupParams`;
  - delete `keySourceId` and use `sourceImageId` for the cache key and the R2 key parts;
  - the source is always loaded and guarded before any cache answers (keep that block and its comment);
  - the image to print is the placement render anchored on `sourceImageId`, else the source's own URL; delete the `getDesignDisplayImageUrl` fallback and its import;
  - the write-back stores under `cacheKey` (with a source on every call, the source-less branch of `storeKey` is unreachable); keep the conditional `UPDATE … WHERE primary_image_id = …`, which stops a stale write from restoring entries a generation just cleared;
  - rewrite the header comment: two callers, both on the image detail page.

  In `mockup-render.test.ts`, delete the cases for a call with no source and for `foldPrimaryFront`, and list them by name in the report. Every other case must pass unchanged.

- [ ] **Step 7: Remove the prefetch.** Delete `src/lib/mockup-prefetch.ts` and its two test files. Delete `prefetchColors` from the `Blank` type and the Classic Tee entry in `src/lib/blanks.ts`. In `server-action-exports.test.ts`, delete the `["src/lib/mockup-prefetch.ts", "prefetchProductMockups"]` entry from `moved` and keep `"prefetchProductMockups"` in `bannedNames` with a one-line comment (the module is gone; the ban stops it from coming back as a Server Action). In `docs/products.md`, rewrite lines 106 and 117: no surface prefetches mockups since slice 4; the image detail page renders each colour on demand.

- [ ] **Step 8: Remove the pin helpers and the breadcrumb branch.** `src/lib/placement-pins.ts`: delete `normalizeFrontPin`, `swapPlacementPins`, `withFront` and `PlacementPins` (if Step 1 found no other user), and rewrite the header comment around what stays (`resolveBuyPageFront`, `buyPagePlacements`, `PlacementPick`); delete their tests. `src/lib/nav.ts`: delete the `/preview` branch and the `designStep` crumb if nothing else uses it; rewrite the comment at lines 84-88; delete the `/preview` cases in `nav.test.ts` (lines 45, 63, 106, 131 today).

- [ ] **Step 9: Sweep the exports left without importers.** For each name imported only by the deleted code (start from the import lists at the top of the old `src/app/preview/page.tsx` and `actions.ts`, e.g. `getBackSourceGroups`, `placementSourceUsable`, `insertDesignImage`, `editTransparent`, `EDIT_COST_PER_IMAGE`, the `instant-preview.ts` and `latest-wins.ts` exports): `grep -rn "\bNAME\b" src`. Delete an export only when nothing in `src` outside its own file and its own tests uses it. List each deleted and each kept export in the report. Do not delete a module the image detail page imports.

- [ ] **Step 10: Run** `npm run lint && npm run typecheck && npm test`. Expected: PASS.
- [ ] **Step 11: Commit** — `"Remove what only the old /preview page used; mockups always name their source (#278 slice 4, closes #288's /preview items)"`

### Task 9: guard against new `/preview` links, and the comment sweep

**Files:**
- Create: `src/lib/__tests__/no-preview-links.test.ts`
- Modify: comments in files this slice touched

- [ ] **Step 1: Write the guard.** It parses every product source file with TypeScript (as `src/app/__tests__/server-action-exports.test.ts` does) and flags string and template literals that start with `/preview`, so comments that mention the old page do not trip it.

```ts
// @vitest-environment node
/**
 * One buy surface, slice 4 (#278): nothing in product code links to /preview
 * any more. The route is a redirect for old links. A new link to it would put
 * buyers through a redirect for nothing, so this fails on one.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import ts from "typescript";

const ROOT = join(__dirname, "../../..");

// Files that may name /preview, each for a reason that outlives this slice.
const ALLOWED: Record<string, string> = {
  "src/app/order/page.tsx": "the legacy /order redirect forwards to /preview, which redirects on",
  "src/app/order/actions.ts": "createCheckoutSession: no caller since slice 4, removed in slice 6",
  "src/lib/preview-redirect.ts": "the sign-in detour returns to the redirect itself",
  "src/proxy.ts": "route list, not a link",
  "src/lib/funnel-routes.ts": "route list, not a link",
};

function productFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      out.push(...productFiles(path));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
      out.push(path);
    }
  }
  return out;
}

function previewLiterals(source: string, fileName: string): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node)
    ) {
      const text = node.text;
      if (text === "/preview" || text.startsWith("/preview?") || text.startsWith("/preview/")) {
        found.push(text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

describe("no product code links to /preview (#278 slice 4)", () => {
  const files = productFiles(join(ROOT, "src"));

  it("found source files to check", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  for (const path of files) {
    const rel = relative(ROOT, path);
    if (rel in ALLOWED) continue;
    it(`${rel} has no /preview link`, () => {
      expect(previewLiterals(readFileSync(path, "utf8"), rel)).toEqual([]);
    });
  }

  it("catches a link in a template and in a plain string", () => {
    expect(previewLiterals("const a = `/preview?id=${x}`; const b = '/preview';", "x.ts")).toEqual([
      "/preview?id=",
      "/preview",
    ]);
    expect(previewLiterals("// see /preview\nconst c = '/d/x';", "x.ts")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/lib/__tests__/no-preview-links.test.ts`. Expected: PASS. If a file fails, it is a link this plan's table missed: stop and report it, do not add it to `ALLOWED`.
- [ ] **Step 3: Comment sweep.** `grep -rn "/preview" src --include="*.ts" --include="*.tsx"` (outside `__tests__`). In the files this slice changed, rewrite comments that describe `/preview` as a live page (for example `src/lib/user-designs.ts:76`, `src/app/d/[imageId]/buy-panel.tsx:96,448,458`, `src/app/d/[imageId]/page.tsx:197`, `src/lib/mockup-cache.ts:45`). Leave historical references in money-path files that slice 6 removes (`order/actions.ts`, `checkout/page.tsx`, `embedded-checkout*.ts`, `flags.ts`, `cart/actions.ts`, `cart-line-check.ts`) and say so in the report.
- [ ] **Step 4: Run** `npm run lint && npm test`. Expected: PASS.
- [ ] **Step 5: Commit** — `"Guard: no product code links to /preview; comments follow the move (#278 slice 4)"`

### Slice 4 close

- [ ] Merge current main into the branch, `npm ci`, then the gate: `npm run lint && npm run typecheck && npm test && npm run db:generate && npm run build` (build env: the dummy block in `ci.yml`'s `check` job), then `npm run e2e`. `db:generate` prints "No schema changes".
- [ ] Confirm no money-path file changed: `git diff --stat origin/main...HEAD -- src/app/api src/lib/ledger* src/lib/order-fulfillment.ts src/lib/order-checkout.ts src/lib/order-emails.ts src/lib/email.ts src/app/checkout src/lib/embedded-checkout*.ts src/lib/flags.ts src/app/order/actions.ts src/app/cart/actions.ts src/app/d/actions.ts` prints nothing except comment-only changes; list any line here in the PR body.
- [ ] Whole-branch review (Opus), with the Review Focus list given as things to probe, and the Decisions section to check each departure against the code.
- [ ] Fix round, re-gate, open the PR (title: "Every entry point opens the image detail page; /preview redirects (#278 slice 4)"). The body carries the entry-point table, the departures (Decisions 1, 2, 6, 7, 9), what stays for slice 6 (Decision 8), and the smoke below.
- [ ] After the branch is pushed, dispatch the nightly on it (`gh workflow run stripe-e2e.yml --ref claude/278-slice-4`) and calibrate selectors from that run before the PR is called ready. CI's `check` and `e2e` green as well.
- [ ] Comment on #288: its two `/preview` items are closed by removal (`generateMockup`'s implicit branch and the prefetch are gone; `renderAndCacheMockup` now requires a source; the client that received `design.mockupUrls` and `getDesign` are gone). Its other items are unchanged.
- [ ] Comment on #278: slice 4 done; the URL sync after publishing with the panel open (#290's deferred item) is a follow-up of its own (Decision 13); slice 6's prefetch measurement now reads as Decision 9 says.
- [ ] After merge: merge main into #249 and re-gate. The new e2e helpers (`clearPrimaryImage`, `seedConversationImage`) touch only `design`, `image` and `conversation_image`, not `listing`.

`CLAUDE.md` lines to update in the PR:

- Routes: `/preview?id=` becomes "Redirects an old link to the image detail page of the image it showed, with the panel open and the same picks; no primary → `/design?id=`; signed out → sign-in (#278 slice 4)". Add `/preview` to the redirect-only line (`/order` → `/preview` → image detail page). Update the `/checkout` line: only the image detail page buys through it in practice; `PREVIEW_EMBEDDED_CHECKOUT_ENABLED` has no caller.
- Environment Variables: `PREVIEW_EMBEDDED_CHECKOUT_ENABLED` gets "no caller since slice 4; removed in slice 6".
- Key integration points, Stripe: the `/preview` embedded sentence becomes "no surface calls `createCheckoutSession` since slice 4".
- Current state, Batch 3 bullet: the `#274` sentence about `Blank.prefetchColors` and the mockup prefetch is replaced by "no surface prefetches mockups since #278 slice 4; the image detail page renders each colour on demand".
- Current state, One buy surface bullet: slice 3 merged (#290) and slice 4 merged, with one line each on what shipped; the front picker is gone and the links between a conversation's images carry the picks; "Next is slice 5".
- Current state, the embedded checkout bullet: the nightly's `/preview` test now opens an old `/preview` link and pays on the image detail page; the nightly no longer sets `PREVIEW_EMBEDDED_CHECKOUT_ENABLED`.
- Open issues: #288's `/preview` items closed.

Smoke for Nico (after merge, in a desktop browser at phone width, signed in):

1. Open https://prntd.org/studio and click an image in a row that has at least two images.
2. In the box that opens, click **Order**.
3. Click size **L**.
4. Scroll to "Other images from this design", click any image there, then click **Open**.

- PASS: the page now shows that other image with the size and colour options open and **L** selected, and the address bar starts with https://prntd.org/d/.
- FAIL: the options are closed, L is not selected, or the address bar shows `/preview`.

## Not in this slice

- Removing `createCheckoutSession`, `calculatePrice`, `PREVIEW_EMBEDDED_CHECKOUT_ENABLED` and its helpers, `/checkout`'s two-switch gate, `addToCart`'s `designId` path, and moving `getLastPurchaseDefaults` out of `src/app/preview/actions.ts`: slice 6.
- The cart line's Edit and quantity: slice 5.
- The URL sync after publishing with the panel open: its own follow-up (Decision 13).
- An unpublished image whose conversation was deleted still cannot be ordered (`order.design_id` is NOT NULL).
- #288's other items (hiding an unpublished image, the owner's notice, the zip export, images made from a hidden image).
