# Paper sweep — /orders, /cart, /order/confirm (slice 7, part 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the three post-purchase surfaces — `/orders`, `/cart`, `/order/confirm` — to the Paper look, and make `/order/confirm` render server-side so its first paint is the receipt rather than the string `Loading…`.

**Architecture:** Presentation only, plus one rendering-model change. `/orders` and `/cart` stay client components (both own local state: the status filter, the cart load/remove/checkout lifecycle) and lose their `Card`/`Badge` chrome in favour of ruled rows and mono text. `/order/confirm` becomes an async server component that awaits `searchParams` and calls the existing `getOrderBySession` loader directly, so the order arrives in the first response; the only client code left on that route is the `Breadcrumbs` island it already rendered. No schema change, no new server action, no data-shape change anywhere.

**Tech Stack:** Next.js 16 App Router (`searchParams` is a Promise — see `src/app/order/page.tsx` for the in-repo pattern, and `node_modules/next/dist/docs/` for anything else you are unsure of), React 19, Tailwind v4 with the Paper tokens from slice 1 (#213), Vitest + Testing Library, Playwright in CI only.

**Spec:** `docs/ux-design-review-2026-09.md` — the route verdicts for `/order/confirm`, `/cart` and `/orders` (~lines 173–182) and the "Shared components audit" bullets on Card, Badge and empty states (~lines 232–247). Rollout item 7 ("mechanical sweep"). Issue #188 tracks the eight-slice rollout.

## Global constraints

- **Do not touch `src/components/ui/*` or `src/app/globals.css`.** Other slices run in parallel in their own worktrees; a primitive edit collides. Everything here is call-site styling.
- **Do not touch** `src/app/studio/**`, `src/app/admin/**`, `src/app/(auth)/**`, `src/app/d/**`, `src/app/shop/**`, `src/components/published-grid.tsx`, `src/components/site-header.tsx`.
- **Paper vocabulary** (tokens already exist in `globals.css`):
  - mono label: `font-mono text-[11px] leading-4 tracking-[0.08em] uppercase`
  - body 14px (`text-sm`), titles 14px/500 (`text-sm font-medium`)
  - links underlined: `underline underline-offset-[3px]`
  - ruled row: hairline `border-b border-border` on the row, `border-t border-border` on the list container. No `Card` on a list surface.
  - no shadows, no dark literals (`bg-black`, `text-white`, `bg-gray-*`, hex darks), no new rounded pills
  - `--positive` / `--negative` (`text-positive` / `text-negative`) only for shipped/delivered and canceled
  - `--accent-rose` is **not** used on any of these three screens
  - 44px minimum tap targets on phone (`min-h-11`)
- **Copy:** reuse the existing strings verbatim. Persona C ("The Clean Label", `docs/design-system.md` Part 1): plain, literal, no marketing sentence, no exclamation mark. No string on these three pages changes in this slice.
- **One primary action per screen** (`Button variant="primary"`, which is the outlined-ink button). Everything else `secondary`, or an underlined link.
- **Migration-free.** If something appears to need a schema change, stop that part and report.
- `catch (err)` + `err instanceof Error ? err.message : String(err)`. `@typescript-eslint/no-explicit-any` is an error in product code, off in tests.
- **Do not weaken an existing assertion to make it pass.** Re-point it and keep its strength; if one looks wrong, say so in the task report instead of deleting it.
- **Every task ends green:** `npx vitest run <the files the task touched>` before its commit, and each commit message ends with:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_018gyyDkawjSPfsD7s4QeSsN
  ```
- **Local e2e cannot run here** (it needs secrets). No task in this plan edits an `e2e/*.spec.ts`; see "e2e contracts" below for the assertions that constrain the markup.

## e2e contracts that constrain this slice (do not break)

`e2e/cart.spec.ts` and `e2e/stripe-money-path.spec.ts` reach these pages by URL and assert:

1. `page.getByTestId("cart-line-item")` — every cart line keeps that test id.
2. `page.getByTestId("cart-line-item").locator("img")` returns **exactly one `<img>` per line** and the two lines' `src` values differ (#162). So a cart row renders one image element and no decorative `<img>`; keep the plain `<img>` (a `next/image` swap would rewrite the `src` and is not part of this slice).
3. `page.getByRole("button", { name: /^Checkout/ })` — the cart's primary stays a `<button>` whose accessible name starts with `Checkout`.
4. `page.waitForURL(/\/order\/confirm/)` — the confirm route keeps its path and must render (not throw) for a real `session_id`.
5. `e2e/guest-funnel.spec.ts` visits `/orders` as a guest and expects the sign-in bounce, which lives in `middleware.ts` / `requireRealUser` — untouched here.

## Owner ruling carried into this slice (W1)

`/orders` and `/cart` "make something" CTAs point at **`/design`, not `/studio`** — `/studio` sits behind `requireRealUser` and bounces an anonymous guest, and `/cart` is a guest-reachable surface. This overrides the design review's "CTAs retargeted to `/studio`" line. `/cart` already complies; `/orders` currently points at `/studio` (`orders-list.tsx:58, 86`) and Task 1 retargets it. Task 4 pins all four hrefs so a future sweep cannot silently re-point them.

## File structure

**Modified**
- `src/app/orders/orders-list.tsx` — ruled rows, mono status/id/date, underlined-text filter tabs, header CTA → `/design` as a secondary control.
- `src/app/orders/__tests__/orders-list.test.tsx` — keeps its two #167 back-thumbnail tests, gains the status/filter/CTA assertions.
- `src/app/cart/page.tsx` — ruled rows, paper well, mono totals, one primary.
- `src/app/cart/__tests__/cart-page.test.tsx` — keeps its four load-state tests, gains the row-shape assertions.
- `src/app/order/confirm/page.tsx` — async server component.

**Created**
- `src/app/order/confirm/__tests__/confirm-page.test.tsx`
- `src/app/__tests__/maker-cta-hrefs.test.tsx`

**Deliberately untouched**
- `src/app/order/confirm/actions.ts` — `getOrderBySession` keeps its exact behaviour and stays a server action (it is imported by the new server page directly; a `"use server"` export is an ordinary async function when called from the server). Its integration test keeps passing unchanged.
- `src/app/orders/page.tsx` — already a server component with the data read; nothing to change.
- `src/lib/user-orders.ts`, `src/lib/order-lines.ts`, `src/lib/order-line-identity.ts`, `src/app/cart/actions.ts` — data layer, out of scope.
- Every `e2e/*.spec.ts`.

## Task 1 — `/orders`: ruled rows, mono status, tab filters, CTA to `/design`

**Files:** `src/app/orders/orders-list.tsx`, `src/app/orders/__tests__/orders-list.test.tsx`

- [ ] **Tests first.** Extend the existing suite (keep both #167 tests exactly as they are — they pin front/back thumbnails and their mono `Front`/`Back` labels):
  - a shipped order renders its status label in a mono element carrying `text-positive`; a canceled order carries `text-negative`; a `paid` order carries neither (assert on the rendered element's `className`, found via `screen.getByText("Shipped")` etc.)
  - the short order id `order-1`.slice(0,8) renders in an element whose class list includes `font-mono`
  - the three filter controls are buttons named `Active (1)`, `Canceled (0)`, `All (1)`; clicking `Canceled (0)` shows `No canceled orders.`; the active one has `aria-pressed="true"` and the others `aria-pressed="false"`
  - the header link "New Design" has `href="/design"`
  - with `orders={[]}`, the empty-state action link has `href="/design"`
  - no `Badge`/`Card` regression guard is needed at unit level; the imports disappearing is enough
- [ ] **Implement.**
  - Drop the `Badge` and `Card` imports. Status becomes a `<span className={"font-mono text-[11px] leading-4 tracking-[0.08em] uppercase " + statusTone[status]}>` where `statusTone` maps `shipped`/`delivered` → `text-positive`, `canceled` → `text-negative`, everything else → `text-text-muted`. Label strings stay exactly as `statusLabel` has them.
  - List: `<ul className="border-t border-border">` with `<li key={order.id} className="border-b border-border py-5">` per order. No `rounded`, no `bg-surface-raised`, no shadow.
  - Order header line: status (mono) · display name (`text-sm font-medium truncate`) · short id (`font-mono text-[11px] text-text-faint`), total on the right as `font-mono text-sm`.
  - Thumbnails: keep the structure, the alts (`Front design` / `Back design`), the `Front`/`Back` mono captions and the `getColorHex` inline fill **exactly** — that fill is the real garment colour, not chrome. Replace `rounded` with a square `border border-border` well; the no-image fallback tile becomes `bg-surface-well` (not `bg-surface-raised`), still showing `—`.
  - Line meta stays `text-sm text-text-muted`; the `Designed by …` line stays `text-xs text-text-faint`.
  - Footer: date as `font-mono text-[11px] text-text-faint`; the tracking link becomes `text-sm text-foreground underline underline-offset-[3px]` with `min-h-11 inline-flex items-center` so it is a real tap target on a phone. Keep `target="_blank" rel="noopener noreferrer"` and the string `Track shipment`.
  - Filter row: mirror `src/components/studio-tabs.tsx` visually — container `flex items-center gap-4 border-b border-border mb-4`, each button `-mb-px min-h-11 flex items-center border-b-2 px-1 text-sm transition-colors`, active `border-foreground text-foreground`, inactive `border-transparent text-text-muted hover:text-foreground`. Add `aria-pressed={filter === f}`. Keep the existing order (`active`, `canceled`, `all`) and the existing labels with counts.
  - Header: `<h1 className="text-xl sm:text-2xl font-bold">My Orders</h1>` (string unchanged) and `<Link href="/design"><Button variant="secondary" size="sm">New Design</Button></Link>`.
  - Empty state: `<EmptyState message="No orders yet." action={<Link href="/design"><Button>Make your first design</Button></Link>} />` — strings unchanged, href retargeted per ruling W1.
  - Keep `main` at `max-w-4xl mx-auto`, but make the horizontal padding phone-friendly: `px-4 sm:px-6`.
- [ ] `npx vitest run src/app/orders` green.
- [ ] Commit.

## Task 2 — `/cart`: ruled rows, paper well, mono totals

**Files:** `src/app/cart/page.tsx`, `src/app/cart/__tests__/cart-page.test.tsx`

- [ ] **Tests first.** Keep all four existing load-state tests verbatim. Add:
  - a one-item cart renders exactly one `<img>` inside the `cart-line-item` element (query `within(item).getAllByRole("img")` after giving the fixture an `imageUrl`; the existing `ONE_ITEM` fixture has `imageUrl: null`, so add a second fixture rather than mutating that one — the null case is what proves no placeholder `<img>` is emitted)
  - the checkout button's accessible name matches `/^Checkout/`
  - the totals rows render `Items`, `Shipping (bundled)` and `Total` and the total amount `$24.12` appears in an element whose class list includes `font-mono`
  - the empty-state action link and the "Add another design" control both lead to `/design` (the latter is a `<button>` calling `router.push("/design")` today — assert on the mocked router being called with `/design` after a click, so the assertion survives either shape)
- [ ] **Implement.**
  - Rows: `<ul className="border-t border-border">`, each `<li data-testid="cart-line-item" className="border-b border-border flex items-center gap-4 py-4">`. Drop `divide-y`/`border-y` from the old `<ul>`.
  - Thumbnail well: `w-16 h-16 shrink-0 bg-surface-well border border-border overflow-hidden` — `bg-checkerboard` and `rounded-md` go. Keep the plain `<img>` and its `eslint-disable-next-line @next/next/no-img-element` comment, and keep it conditional on `item.imageUrl` (e2e contract 2).
  - Name `text-sm font-medium truncate`; meta line stays `text-sm text-text-muted` with its existing `·` composition.
  - Line price `font-mono text-sm`; `Remove` becomes an underlined text control: `min-h-11 inline-flex items-center text-xs text-text-muted underline underline-offset-[3px] hover:text-foreground disabled:no-underline disabled:text-text-faint`. Keep the `Removing…` label swap and the `disabled` binding.
  - Totals: each label a mono label (`font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted`), each amount `font-mono text-sm`; the total row keeps `border-t border-border pt-2` and uses `font-medium` instead of `font-bold`. Label strings unchanged.
  - Buttons: `Checkout — $X.XX` stays the single `variant="primary"` (default) `size="lg"` button with its `Redirecting…` swap; `Add another design` stays `variant="secondary"`. Both keep `w-full` inside the existing `flex flex-col sm:flex-row gap-3`.
  - Loading line: `<p className="font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-faint">Loading…</p>` — string unchanged.
  - Error and empty states keep their `EmptyState` usage, test ids and strings exactly.
  - `h1` becomes `text-xl sm:text-2xl font-bold` for consistency with the other two screens; string `Your cart` unchanged.
- [ ] `npx vitest run src/app/cart` green.
- [ ] Commit.

## Task 3 — `/order/confirm`: server-rendered receipt

**Files:** `src/app/order/confirm/page.tsx`, new `src/app/order/confirm/__tests__/confirm-page.test.tsx`

- [ ] **Tests first.** New file. Mock `../actions` (`getOrderBySession`) and `next/navigation` (`useRouter`, `usePathname` — `Breadcrumbs` is a client island that calls `useRouter`). Because the page is an async server component, call it and render what it returns:
  ```ts
  const ui = await ConfirmPage({ searchParams: Promise.resolve({ session_id: "cs_1" }) });
  render(ui);
  ```
  Assert:
  - `getOrderBySession` is called once with `"cs_1"`
  - the heading `Order confirmed.` renders and its element's class list includes `font-mono`
  - the short order id renders, both line thumbnails render with alts `Front design` / `Back design` when the line has a back pin, and only the front when it does not (two cases)
  - `Total paid` and the total amount render, the amount in a `font-mono` element
  - `View My Orders` links to `/orders`
  - with `session_id` absent, `getOrderBySession` is **not** called and `Order not found.` renders
  - with `getOrderBySession` resolving `null`, `Order not found.` renders and the recovery link points at `/design`
- [ ] **Implement.**
  - `export default async function ConfirmPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> })`. `const raw = (await searchParams).session_id; const sessionId = typeof raw === "string" && raw ? raw : null;` If `sessionId` is null, render the not-found state without calling the loader. Otherwise `const order = await getOrderBySession(sessionId)`.
  - Delete the `"use client"` directive, the `Suspense` wrapper, `useSearchParams`, `useState`, `useEffect`, the local order type (it is inferred from the loader now) and the `Loading…` branch. The whole point of the slice item is that there is no loading paint.
  - Keep the `Breadcrumbs` island (`trail={breadcrumbTrail("/order/confirm")} current="Confirmed"`) exactly.
  - Layout, receipt-shaped: heading `<h1 className="font-mono text-[13px] leading-5 tracking-[0.08em] uppercase">Order confirmed.</h1>` (string unchanged). Drop the decorative `<div className="text-5xl">✓</div>`.
  - Replace the `Card` with a ruled block: `<div className="border-t border-border text-sm">` and one `border-b border-border py-3` row each for the order id (mono label `Order ID` + `font-mono` value), each line, and the total (`Total paid` as a mono label, amount `font-mono font-medium`).
  - Keep every line's thumbnail markup, the `getColorHex` fills, the alts and the `Front`/`Back` mono captions; give the wells `border border-border` and drop `rounded`, matching Task 1.
  - Actions: one primary — `<Link href="/orders"><Button className="w-full">View My Orders</Button></Link>`; `Start another design` becomes a plain underlined link to `/design` (`text-sm underline underline-offset-[3px]`, `min-h-11 inline-flex items-center`), not a second button. Strings unchanged.
  - Not-found branch: keep `Order not found.` and the `Start a new design` link to `/design`, restyled as an underlined ink link; no breadcrumbs there (as today).
- [ ] `npx vitest run src/app/order` green (this also re-runs the untouched `get-order-by-session` integration test — it must stay green).
- [ ] Commit.

## Task 4 — the deferred maker-CTA href regression test

**Files:** new `src/app/__tests__/maker-cta-hrefs.test.tsx`

Runs after Tasks 1 and 2.

- [ ] **Test only, no product change.** One file, a docblock stating ruling W1 (`/studio` is behind `requireRealUser`, `/cart` is guest-reachable, so both surfaces' make-CTAs stay on `/design`), pinning all four:
  - `/orders` header link `New Design` → `/design`
  - `/orders` empty-state action `Make your first design` → `/design`
  - `/cart` empty-state action `Start a design` → `/design`
  - `/cart` `Add another design` → `router.push("/design")`
  Mock `@/app/cart/actions` and `next/navigation` the way `cart-page.test.tsx` does; render `OrdersList` with `[]` and with one order for the header case.
- [ ] `npx vitest run src/app/__tests__/maker-cta-hrefs.test.tsx` green.
- [ ] Commit.

## Verification (controller)

- [ ] `npm run lint` — 0 errors
- [ ] `npm run typecheck` — clean
- [ ] `npm test` — full suite green, note the count
- [ ] `npm run build` — succeeds, and `/order/confirm` appears in the route manifest as a dynamic (`ƒ`) route, since it now awaits `searchParams`
- [ ] Grep the three touched files for dark literals (`bg-black`, `text-white`, `bg-gray-`, `#0`, `#1`) and for `Card`/`Badge` imports — all absent
- [ ] Whole-branch Opus review of `git diff origin/main...HEAD`, then fix and re-review
