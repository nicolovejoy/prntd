# Nav model A (Paper slice 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the site's five "my work" surfaces and two "Shop"s into nav model A — header is Studio · Shop · Cart · account menu, the Studio owns bench/library/archive as three views, and the community feed lives at `/shop`.

**Architecture:** Route moves plus one shared sub-nav. `/designs` and `/prints` become permanent redirects to `/studio/library` and `/shop`; the pages they served move to those new paths unchanged. A new `src/app/studio/layout.tsx` renders the "Studio" heading and a three-tab strip over `/studio`, `/studio/library` and `/studio/archive`, so the three pages drop their own headings and the archive's ad-hoc back link. `SiteHeader` keeps its one dropdown but re-purposes it as the account menu at every breakpoint: Studio and Shop show in the bar on `sm:` and inside the dropdown on phones, Cart stays in the bar always, and Orders / Admin / Feedback / email / build date / Sign out move into the dropdown. Every link, `revalidatePath`, breadcrumb, middleware entry and e2e wait that named the old routes follows.

**Tech Stack:** Next.js 16 App Router (read `node_modules/next/dist/docs/` before using any API you are unsure of), React 19 client components, Tailwind v4 with the Paper tokens from slice 1, Vitest + Testing Library, Playwright for e2e.

**Spec:** `docs/ux-design-review-2026-09.md` — "Nav model" section (candidate A, lines ~75–103), "Rollout plan" item 2 (~line 332), and the owner decisions at lines ~350–360. Issue #188 tracks the eight-slice rollout; this is slice 2.

## Global Constraints

- **Labels are exactly these strings, no others:** `Studio`, `Shop`, `Cart`, `Orders`, `Admin`, `Feedback`, `Sign in`, `Sign out`, `Account`. Sub-nav tabs are exactly `Bench`, `Library`, `Archive`. No new whimsy, no marketing sentences — persona C ("The Clean Label", `docs/design-system.md` Part 1): plain, nearly invisible copy.
- **Do not touch the Paper tokens or the `src/components/ui/*` primitives.** Slice 1 (#213) shipped them; this slice only re-arranges navigation. Reuse `Button`, `EmptyState`, `Card` as they are.
- **Out of scope:** any Paper re-skin of individual screens (later slices), removal of the mothballed organizer routes under `src/app/shop/[slug]/**` (#201 drops those), and any schema change. This slice is migration-free.
- **`@` maps to `src/`** (tsconfig + vitest config).
- **Lint policy:** `@typescript-eslint/no-explicit-any` is an error in product code and off in tests. `catch (err)` with narrowing, never `err: any`.
- **Every task ends green:** `npx vitest run <the files the task touched>` before the commit, and every task's commit message ends with the two trailer lines:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_018gyyDkawjSPfsD7s4QeSsN
  ```
- **Do not weaken an existing assertion to make it pass.** Re-point it at the new route and keep the same strength. If an assertion looks wrong, say so in the task report rather than deleting it.
- **Local e2e cannot run here** (it needs secrets). Playwright specs are edited but never executed in this worktree; CI runs them on the PR.

## Route map after this slice

| Old | New | Mechanism |
| --- | --- | --- |
| `/designs` (My Designs) | `/studio/library` | old path becomes `permanentRedirect` |
| `/prints` (community feed) | `/shop` | old path becomes `permanentRedirect` |
| `/studio` (bench) | `/studio` | unchanged, gains the tab strip |
| `/studio/archive` | `/studio/archive` | unchanged, gains the tab strip |
| `/shop/[slug]`, `/shop/[slug]/[productId]` | unchanged | mothballed organizer storefront, `STORES_ENABLED` off |

`/shop` (static) and `/shop/[slug]` (dynamic) do not collide: a dynamic segment requires a non-empty path segment, so `/shop` can only ever match `src/app/shop/page.tsx`. Task 2 pins that with a test and with the build's route manifest.

## File structure

**Created**
- `src/components/studio-tabs.tsx` — client component; the three-tab strip, active tab from `usePathname()`. Its only job is the strip.
- `src/app/studio/layout.tsx` — server component; renders the "Studio" heading + `<StudioTabs />` above `{children}` for `/studio`, `/studio/library`, `/studio/archive`.
- `src/app/studio/library/page.tsx` — My Designs, moved verbatim from `src/app/designs/page.tsx` minus its own `<h1>`.
- `src/app/studio/library/library-grid.tsx` — moved from `src/app/designs/library-grid.tsx`; only its `./actions` import and its `?from=` value change.
- `src/app/shop/page.tsx` — the community feed, moved from `src/app/prints/page.tsx`.
- `src/components/__tests__/studio-tabs.test.tsx`
- `src/app/studio/library/__tests__/library-grid.test.tsx` — moved from `src/app/designs/__tests__/library-grid.test.tsx`.
- `src/app/__tests__/route-redirects.test.tsx` — the two redirect pages, plus the `/shop` vs `/shop/[slug]` non-collision assertion.

**Modified**
- `src/app/designs/page.tsx` → a `permanentRedirect("/studio/library")` page.
- `src/app/prints/page.tsx` → a `permanentRedirect("/shop")` page.
- `src/app/designs/actions.ts` — stays put (10+ importers); only its `revalidatePath` targets change.
- `src/app/studio/studio-client.tsx` — drops its `<h1>Studio</h1>` and the Archive link (both now in the layout); Shop CTA retargeted.
- `src/app/studio/archive/page.tsx` — drops its `<h1>Archive</h1>` and `← Studio` back link.
- `src/components/site-header.tsx` — nav model A.
- `src/lib/nav.ts` — breadcrumb parents follow the new routes.
- `src/middleware.ts` — matcher/protection for `/studio/library`; `/shop` stays public.
- `src/app/page.tsx`, `src/app/preview/page.tsx`, `src/app/cart/page.tsx`, `src/app/orders/orders-list.tsx`, `src/app/(auth)/sign-in/page.tsx`, `src/app/(auth)/sign-up/page.tsx`, `src/app/d/[imageId]/published-image-view.tsx`, `src/app/d/[imageId]/conversation-actions.tsx`, `src/app/d/conversation-actions.ts`, `src/app/design/actions.ts`, `src/app/admin/actions.ts` — link and `revalidatePath` retargets.
- Tests: `src/components/__tests__/site-header.test.tsx`, `src/lib/__tests__/nav.test.ts`, `src/app/studio/__tests__/studio-client.test.tsx`, `src/app/d/[imageId]/__tests__/conversation-images.test.tsx`.
- e2e: `e2e/helpers/auth.ts`, `e2e/guest-funnel.spec.ts`.

**Deliberately untouched**
- `e2e/landing.spec.ts` — it asserts on the hero composer and the example
  chips only, never on nav text or a nav test id, so the header rewrite does
  not reach it. Verified by reading it; do not "fix" it.
- `e2e/cart.spec.ts`, `e2e/stripe-money-path.spec.ts`, `e2e/store-compose.spec.ts`
  — they reach the funnel by URL, not through the header. `store-compose` and
  `stripe-money-path` do call `signUpFreshAccount`, so they pick up Task 4's
  new post-sign-up wait for free.
- `src/components/feedback-launcher.tsx` and `src/lib/funnel-routes.ts` — the
  floating launcher's `isFunnelRoute` gating is unchanged by this slice.

**Deleted**
- `src/app/designs/library-grid.tsx` and `src/app/designs/__tests__/library-grid.test.tsx` (moved, not rewritten).

---

### Task 1: Studio sub-nav, `/studio/library`, and the `/designs` redirect

**Files:**
- Create: `src/components/studio-tabs.tsx`
- Create: `src/components/__tests__/studio-tabs.test.tsx`
- Create: `src/app/studio/layout.tsx`
- Create: `src/app/studio/library/page.tsx`
- Create: `src/app/studio/library/library-grid.tsx` (git-mv of `src/app/designs/library-grid.tsx`)
- Create: `src/app/studio/library/__tests__/library-grid.test.tsx` (git-mv of `src/app/designs/__tests__/library-grid.test.tsx`)
- Modify: `src/app/designs/page.tsx` (whole file replaced)
- Modify: `src/app/studio/studio-client.tsx` (the header row, ~lines 536–558)
- Modify: `src/app/studio/archive/page.tsx` (the header block, ~lines 21–33)
- Modify: `src/app/studio/__tests__/studio-client.test.tsx` (only if it asserts on the removed `<h1>`/Archive link)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `export function StudioTabs(): JSX.Element` in `src/components/studio-tabs.tsx` — no props.
  - The route `/studio/library` exists and renders `LibraryGrid`.
  - `export function LibraryGrid({ images }: { images: LibraryImage[] })` now lives at `@/app/studio/library/library-grid` and links cells to `` `/d/${img.imageId}?from=/studio/library` ``. Task 4 relies on that `?from=` value when it teaches `src/lib/nav.ts` the new parent.

- [ ] **Step 1: Write the failing test for the tab strip**

Create `src/components/__tests__/studio-tabs.test.tsx`:

```tsx
/**
 * Studio sub-nav (nav model A): one strip across the bench, the library and
 * the archive. Asserts label AND destination — a tab pointing at the wrong
 * route must fail, not just a wrong word — plus which tab is marked current
 * for each of the three pathnames.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { StudioTabs } from "../studio-tabs";

const h = vi.hoisted(() => ({ pathname: "/studio" }));
vi.mock("next/navigation", () => ({ usePathname: () => h.pathname }));

function tabs() {
  return screen
    .getAllByRole("link")
    .map((a) => [a.textContent, a.getAttribute("href")]);
}

beforeEach(() => {
  h.pathname = "/studio";
});

describe("StudioTabs", () => {
  it("is exactly Bench, Library, Archive in order", () => {
    render(<StudioTabs />);
    expect(tabs()).toEqual([
      ["Bench", "/studio"],
      ["Library", "/studio/library"],
      ["Archive", "/studio/archive"],
    ]);
  });

  it.each([
    ["/studio", "Bench"],
    ["/studio/library", "Library"],
    ["/studio/archive", "Archive"],
  ])("marks the %s tab current on %s", (pathname, label) => {
    h.pathname = pathname;
    render(<StudioTabs />);
    const current = screen.getByRole("link", { current: "page" });
    expect(current.textContent).toBe(label);
  });

  it("marks no tab current on an unrelated pathname", () => {
    h.pathname = "/orders";
    render(<StudioTabs />);
    expect(screen.queryByRole("link", { current: "page" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/nico/src/prntd/.claude/worktrees/nav-model-a && npx vitest run src/components/__tests__/studio-tabs.test.tsx`
Expected: FAIL — cannot resolve `../studio-tabs`.

- [ ] **Step 3: Write the tab strip**

Create `src/components/studio-tabs.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The Studio's three views (nav model A, docs/ux-design-review-2026-09.md):
 * the bench you are working on, the library of everything you have made, and
 * the archive of conversations that have left the bench. They were three
 * top-level destinations; this is the one strip that makes them one place.
 *
 * Exact-match active state: /studio must not light up while you are on
 * /studio/library, so `startsWith` is wrong here.
 */
const TABS = [
  { href: "/studio", label: "Bench" },
  { href: "/studio/library", label: "Library" },
  { href: "/studio/archive", label: "Archive" },
] as const;

export function StudioTabs() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Studio views"
      className="flex items-center gap-4 border-b border-border"
      data-testid="studio-tabs"
    >
      {TABS.map((tab) => {
        const current = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={current ? "page" : undefined}
            className={`-mb-px min-h-11 flex items-center border-b-2 px-1 text-sm transition-colors ${
              current
                ? "border-foreground text-foreground"
                : "border-transparent text-text-muted hover:text-foreground"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/nico/src/prntd/.claude/worktrees/nav-model-a && npx vitest run src/components/__tests__/studio-tabs.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Add the Studio layout**

Create `src/app/studio/layout.tsx`:

```tsx
import { StudioTabs } from "@/components/studio-tabs";

/**
 * One frame for the Studio's three views (nav model A). The heading and the
 * tab strip live here rather than on each page, so the bench, the library and
 * the archive cannot disagree about what they are called or how you get
 * between them — that disagreement was the "five surfaces claim my work"
 * problem this slice exists to fix.
 *
 * The pages own their own auth gate (requireRealUser); a layout renders
 * before that resolves, but the strip is static links, so there is nothing
 * here to leak.
 */
export default function StudioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col">
      <div className="px-4 sm:px-6 pt-8 max-w-4xl mx-auto w-full">
        <h1 className="text-xl sm:text-2xl font-bold mb-4">Studio</h1>
        <StudioTabs />
      </div>
      {children}
    </div>
  );
}
```

- [ ] **Step 6: Move the library grid and its test**

Run:

```bash
cd /Users/nico/src/prntd/.claude/worktrees/nav-model-a
mkdir -p src/app/studio/library/__tests__
git mv src/app/designs/library-grid.tsx src/app/studio/library/library-grid.tsx
git mv src/app/designs/__tests__/library-grid.test.tsx src/app/studio/library/__tests__/library-grid.test.tsx
```

Then make exactly three edits:

1. In `src/app/studio/library/library-grid.tsx`, change the actions import (the file is no longer a sibling of `actions.ts`, which stays at `src/app/designs/actions.ts` because a dozen other modules import it):

```ts
import { deleteImages } from "@/app/designs/actions";
```

2. In the same file, the cell link at ~line 283 changes its origin marker:

```tsx
    <Link href={`/d/${img.imageId}?from=/studio/library`} className="group block">
```

3. In `src/app/studio/library/__tests__/library-grid.test.tsx`, fix the import path to `../library-grid`, re-point any `vi.mock("./actions"…)`/`vi.mock("../actions"…)` to `vi.mock("@/app/designs/actions", …)`, and update the `?from=` expectation:

```ts
    ).toBe("/d/i1?from=/studio/library");
```

- [ ] **Step 7: Create the library page and turn `/designs` into a redirect**

Create `src/app/studio/library/page.tsx`:

```tsx
import Link from "next/link";
import { requireRealUser } from "@/lib/require-user";
import { getUserImageLibrary } from "@/lib/user-designs";
import { Button, EmptyState } from "@/components/ui";
import { LibraryGrid } from "./library-grid";

/**
 * Library — every image this user has made (studio-plan slice 5). Moved here
 * from /designs by nav model A: the bench holds the conversations you are
 * working on, this holds what came out of them, and they are two views of one
 * Studio rather than two top-level destinations.
 *
 * The heading and the tab strip come from src/app/studio/layout.tsx.
 *
 * A plain server component: the grid is links, so there is no client state to
 * hydrate. Per-image actions live one tap deeper, on the image detail page.
 */
export default async function StudioLibraryPage() {
  const session = await requireRealUser();
  const images = await getUserImageLibrary(session.user.id);

  return (
    <main className="px-4 sm:px-6 py-8 max-w-4xl mx-auto w-full">
      {images.length === 0 ? (
        <EmptyState
          message="No designs yet."
          action={
            <Link href="/studio">
              <Button>Open the Studio</Button>
            </Link>
          }
        />
      ) : (
        <LibraryGrid images={images} />
      )}
    </main>
  );
}
```

Replace the whole of `src/app/designs/page.tsx` with:

```tsx
/**
 * /designs is retired (nav model A, docs/ux-design-review-2026-09.md): My
 * Designs is the Studio's Library view. The redirect keeps every bookmark,
 * shared link and `?from=/designs` marker working.
 *
 * permanentRedirect (308) rather than redirect (307) because the move is
 * permanent and we want crawlers and browsers to stop asking.
 *
 * Note src/app/designs/actions.ts stays where it is — a dozen modules import
 * it, and a non-route file inside app/ is just a module.
 */
import { permanentRedirect } from "next/navigation";

export default function DesignsPage(): never {
  permanentRedirect("/studio/library");
}
```

- [ ] **Step 8: Strip the now-duplicated headings out of the bench and the archive**

In `src/app/studio/studio-client.tsx`, the header row (~lines 536–558) currently holds `<h1>Studio</h1>`, the Select button and an Archive link. The heading and the Archive link are both in the layout now. Replace the outer `<div className="min-h-screen flex flex-col">` wrapper's heading block so the row keeps only Select:

```tsx
        <div className="flex items-baseline justify-end gap-3 mb-6">
          {/* Only when there is something to select; in select mode the
              bottom bar's Done is the way out, so the control hides. The
              heading and the Archive door moved to the Studio layout's tab
              strip (nav model A) — one door per destination. */}
          {renderedLanes.length > 0 && !selectMode && (
            <button
              type="button"
              onClick={enterSelectMode}
              className="text-sm text-text-muted hover:text-foreground transition-colors"
              data-testid="select-mode"
            >
              Select
            </button>
          )}
        </div>
```

Also remove the now-unused `min-h-screen flex flex-col` wrapper duplication: the layout already provides it, so change `studio-client.tsx`'s outermost element from `<div className="min-h-screen flex flex-col">` to `<>` … `</>` (a fragment), keeping `{confirmSheet}` and `<main>` inside. If `Link` is no longer used anywhere in the file after removing the Archive link, drop the `import Link from "next/link"` line — but check first: the empty state still uses `Link`, so it most likely stays.

In `src/app/studio/archive/page.tsx`, delete the `← Studio` link and the `<h1>Archive</h1>`, keeping the explanatory line and the wrapper:

```tsx
  return (
    <main className="px-4 sm:px-6 py-8 max-w-4xl mx-auto w-full">
      <p className="text-sm text-text-faint mb-6">
        Designs with no activity for three days leave the Studio.
      </p>
```

Remove the `import Link from "next/link";` line only if nothing else in the file uses `Link` — the row still links to `/design?id=…`, so it stays.

- [ ] **Step 9: Run the tests this task touched**

Run:

```bash
cd /Users/nico/src/prntd/.claude/worktrees/nav-model-a
npx vitest run src/components/__tests__/studio-tabs.test.tsx src/app/studio src/app/designs
```

Expected: PASS. If `src/app/studio/__tests__/studio-client.test.tsx` fails because it asserted on the removed `<h1>Studio</h1>` or the removed Archive link, re-point that assertion at `StudioTabs` (which the client no longer renders — so the correct fix is to delete just that assertion and say so in the report, not to weaken any other one). Its `"/prints"` assertion is Task 2's job; leave it failing there if it does, and note it.

- [ ] **Step 10: Typecheck and commit**

Run: `cd /Users/nico/src/prntd/.claude/worktrees/nav-model-a && npm run typecheck`
Expected: no errors.

```bash
cd /Users/nico/src/prntd/.claude/worktrees/nav-model-a
git add -A
git commit -m "$(cat <<'EOF'
feat(nav): Studio sub-nav, /studio/library, /designs redirect

Bench, Library and Archive become three views of one Studio behind a shared
tab strip. My Designs moves from /designs to /studio/library; /designs is a
308 to it. The bench and the archive drop their own headings, which the new
studio layout now owns.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018gyyDkawjSPfsD7s4QeSsN
EOF
)"
```

---

### Task 2: The community feed moves to `/shop`, `/prints` redirects

**Files:**
- Create: `src/app/shop/page.tsx`
- Create: `src/app/__tests__/route-redirects.test.tsx`
- Modify: `src/app/prints/page.tsx` (whole file replaced)
- Modify: `src/app/designs/actions.ts` (four `revalidatePath("/prints")` sites: ~179, ~281, ~340, ~383, plus the comment at ~211 and ~347)
- Modify: `src/app/admin/actions.ts:419-421`
- Modify: `src/app/page.tsx:55` ("See all →")
- Modify: `src/app/studio/studio-client.tsx:569` (empty-state Shop CTA)
- Modify: `src/app/studio/__tests__/studio-client.test.tsx:96`
- Modify: `src/components/published-grid.tsx:12` (comment only)

**Interfaces:**
- Consumes: Task 1's edits to `studio-client.tsx` (the empty state survives that task untouched).
- Produces: the route `/shop` renders the community feed with `from="/shop"` on every card. Task 4 relies on `"/shop"` being a valid `?from=` value in `src/lib/nav.ts`.

- [ ] **Step 1: Write the failing tests for both redirects and the non-collision**

Create `src/app/__tests__/route-redirects.test.tsx`:

```tsx
/**
 * Nav model A retires two top-level routes. Both keep serving as permanent
 * redirects so bookmarks, shared links and stale `?from=` markers survive.
 *
 * The third test is the one worth having: `/shop` (static) now sits beside
 * the mothballed organizer `/shop/[slug]` (dynamic). A dynamic segment
 * requires a non-empty path segment, so `/shop` can only match the static
 * page — this asserts the two files both exist and that the static one is a
 * real page, which is what would break if someone "helpfully" folded the
 * feed into the slug route.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const h = vi.hoisted(() => ({
  permanentRedirect: vi.fn((url: string): never => {
    // next/navigation's permanentRedirect throws; mirror that.
    throw new Error(`NEXT_PERMANENT_REDIRECT:${url}`);
  }),
}));

vi.mock("next/navigation", () => ({
  get permanentRedirect() {
    return h.permanentRedirect;
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("retired routes", () => {
  it("/designs permanently redirects to /studio/library", async () => {
    const { default: DesignsPage } = await import("../designs/page");
    expect(() => DesignsPage()).toThrow("NEXT_PERMANENT_REDIRECT:/studio/library");
    expect(h.permanentRedirect).toHaveBeenCalledWith("/studio/library");
  });

  it("/prints permanently redirects to /shop", async () => {
    const { default: PrintsPage } = await import("../prints/page");
    expect(() => PrintsPage()).toThrow("NEXT_PERMANENT_REDIRECT:/shop");
    expect(h.permanentRedirect).toHaveBeenCalledWith("/shop");
  });
});

describe("/shop does not collide with the organizer /shop/[slug]", () => {
  const app = resolve(__dirname, "..");

  it("has a static page for /shop", () => {
    expect(existsSync(resolve(app, "shop/page.tsx"))).toBe(true);
  });

  it("leaves the organizer slug route in place", () => {
    expect(existsSync(resolve(app, "shop/[slug]/page.tsx"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/nico/src/prntd/.claude/worktrees/nav-model-a && npx vitest run src/app/__tests__/route-redirects.test.tsx`
Expected: FAIL — `/prints` still exports the feed page (no redirect thrown) and `shop/page.tsx` does not exist. The `/designs` case should already PASS from Task 1.

- [ ] **Step 3: Create `/shop` and turn `/prints` into a redirect**

Create `src/app/shop/page.tsx`:

```tsx
import { getDiscoverFeed } from "../d/actions";
import { PublishedGrid } from "@/components/published-grid";
import { EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * The Shop — the community feed, moved here from /prints by nav model A so
 * that the word "Shop" names exactly one thing. The organizer storefronts at
 * /shop/[slug] are retired (#191) and drop out entirely with #201; a dynamic
 * segment needs a non-empty path segment, so they never shadow this page.
 */
export default async function ShopPage() {
  const images = await getDiscoverFeed(60);

  return (
    <main className="flex-1 px-4 py-10">
      <div className="max-w-6xl mx-auto">
        <header className="mb-8 text-center">
          <h1 className="text-3xl font-bold">Shop</h1>
          <p className="text-text-muted mt-2">
            Designs published by other makers.
          </p>
        </header>

        {images.length > 0 ? (
          <PublishedGrid images={images} from="/shop" />
        ) : (
          <EmptyState message="No published designs yet." />
        )}
      </div>
    </main>
  );
}
```

Replace the whole of `src/app/prints/page.tsx` with:

```tsx
/**
 * /prints is retired (nav model A, docs/ux-design-review-2026-09.md): the
 * community feed is /shop, and "Shop" now names exactly one thing. 308 so the
 * old links — including every published-design card that carried
 * `?from=/prints` — keep resolving.
 */
import { permanentRedirect } from "next/navigation";

export default function PrintsPage(): never {
  permanentRedirect("/shop");
}
```

- [ ] **Step 4: Run the redirect tests to verify they pass**

Run: `cd /Users/nico/src/prntd/.claude/worktrees/nav-model-a && npx vitest run src/app/__tests__/route-redirects.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Follow every `/prints` reference**

`src/app/designs/actions.ts` — replace each `revalidatePath("/prints")` with `revalidatePath("/shop")` (four sites, around lines 179, 281, 340 and 383). The retired `/prints` page is static and has nothing to revalidate. Update the two prose comments that name the route (~line 211 "the PUBLIC `/` feed and `/prints`", ~line 347 "the discover feed (`/`, `/prints`)") to say `/shop`.

`src/app/admin/actions.ts:419-421`:

```ts
  // The Shop feed renders on / and /shop; bust both plus the admin grid.
  revalidatePath("/");
  revalidatePath("/shop");
```

`src/app/page.tsx:55` — the "See all →" link:

```tsx
                href="/shop"
```

`src/app/studio/studio-client.tsx:569` — the bench empty state's Shop CTA:

```tsx
              <Link
                href="/shop"
```

`src/app/studio/__tests__/studio-client.test.tsx:96` — the matching assertion:

```ts
    ).toBe("/shop");
```

`src/components/published-grid.tsx:12` — comment only: `Shared grid of published (Shop, /shop) designs.`

- [ ] **Step 6: Verify no live `/prints` reference survives**

Run:

```bash
cd /Users/nico/src/prntd/.claude/worktrees/nav-model-a
grep -rn '"/prints"' src e2e --include='*.ts' --include='*.tsx'
```

Expected: exactly zero hits. (`src/app/prints/page.tsx` names `/shop`, not `/prints`; `src/lib/__tests__/funnel-routes.test.ts` passes the string as an argument — if that one shows up, leave it: `isFunnelRoute("/prints")` returning false is still true of the redirect page and costs nothing. Report it if you leave it.)

- [ ] **Step 7: Run the tests this task touched**

Run:

```bash
cd /Users/nico/src/prntd/.claude/worktrees/nav-model-a
npx vitest run src/app/__tests__ src/app/studio src/app/designs src/components/__tests__/published-grid.test.tsx
npm run typecheck
```

Expected: PASS, no type errors. (If `published-grid.test.tsx` does not exist, drop it from the command.)

- [ ] **Step 8: Commit**

```bash
cd /Users/nico/src/prntd/.claude/worktrees/nav-model-a
git add -A
git commit -m "$(cat <<'EOF'
feat(nav): community feed moves to /shop, /prints redirects

"Shop" now names exactly one thing. The feed renders at /shop; /prints is a
308 to it. revalidatePath, the homepage "See all", the bench empty state and
the admin cache bust all follow. The mothballed organizer /shop/[slug] is
untouched — a dynamic segment needs a non-empty segment, so it never shadows
the static page.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018gyyDkawjSPfsD7s4QeSsN
EOF
)"
```

---

### Task 3: Header nav model A — Studio · Shop · Cart · account menu

**Files:**
- Modify: `src/components/site-header.tsx`
- Modify: `src/components/__tests__/site-header.test.tsx`

**Interfaces:**
- Consumes: `/studio/library` (Task 1) and `/shop` (Task 2) both exist.
- Produces: no new exports. `SiteHeader`'s props are unchanged (`{ cartEnabled: boolean }`).

**What changes, precisely.** Today the bar is a flat row of every link plus a mobile-only hamburger dropdown. Model A splits it:

- **Bar, always:** wordmark, running-jobs badge (unchanged), `Cart` with its count (funnel-critical, so never buried), the menu trigger.
- **Bar, `sm:` and up:** `Studio`, `Shop`, and — signed out — `Sign in`.
- **Dropdown (the account menu), every breakpoint:** on phones only, `Studio` and `Shop` (they are in the bar on `sm:`, so those two items carry `sm:hidden`); then, signed in, the account email, `Orders`, `Admin` when `isAdmin`, `Feedback`, the build date and `Sign out`; signed out, `Feedback` and the build date.
- The trigger renders the hamburger bars on phones and the word `Account` on `sm:`, with `aria-label="Account menu"`. One `menuOpen` state, one outside-click/Escape effect — the existing ones, unchanged.
- `My Designs` leaves the header entirely: it is the Studio's Library tab now.
- The floating feedback launcher and `isFunnelRoute` are **not** touched.

- [ ] **Step 1: Rewrite the header test to describe model A**

Replace the whole of `src/components/__tests__/site-header.test.tsx` with:

```tsx
/**
 * Nav model A (docs/ux-design-review-2026-09.md): the bar is Studio · Shop ·
 * Cart plus an account menu. Orders, Admin, Feedback, the signed-in email,
 * the build date and Sign out live inside the menu; My Designs is gone from
 * the header entirely (it is the Studio's Library tab).
 *
 * `useSession`/`getHeaderState` are mocked so the assertions are about the
 * link sets, not the round trips underneath them. Assertions carry label AND
 * destination — a label pointing at the wrong route must fail, not just a
 * wrong word.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SiteHeader } from "../site-header";

const h = vi.hoisted(() => ({
  session: null as { user: { id: string; email?: string } } | null,
  headerState: { isAdmin: false, cartCount: 0, runningJobs: 0 },
}));

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({ data: h.session }),
    signOut: vi.fn(async () => {}),
  },
}));

vi.mock("@/components/site-header-actions", () => ({
  getHeaderState: vi.fn(async () => h.headerState),
}));

vi.mock("@/components/feedback-launcher", () => ({
  FeedbackPanel: () => null,
}));

import { getHeaderState } from "@/components/site-header-actions";

// Every nav word the header can render. Filtering by this set isolates nav
// links from the wordmark and the running-jobs badge. Retired entries stay in
// the set on purpose: a regression that re-adds "My Designs" or "Dashboard"
// shows up as an extra link, not a silent pass.
const NAV_LABELS = [
  "Studio",
  "Shop",
  "Orders",
  "Admin",
  "My Designs",
  "Dashboard",
];

function linksWithin(container: HTMLElement) {
  return within(container)
    .getAllByRole("link")
    .filter((a) => NAV_LABELS.includes(a.textContent ?? ""))
    .map((a) => [a.textContent, a.getAttribute("href")]);
}

function bar() {
  return screen.getByTestId("header-bar");
}

async function openMenu() {
  await userEvent.click(screen.getByRole("button", { name: "Account menu" }));
  return screen.getByTestId("header-menu");
}

async function settle() {
  await waitFor(() => expect(getHeaderState).toHaveBeenCalled());
}

beforeEach(() => {
  vi.clearAllMocks();
  h.session = null;
  h.headerState = { isAdmin: false, cartCount: 0, runningJobs: 0 };
});

describe("SiteHeader bar (signed in)", () => {
  it("is exactly Studio then Shop — no My Designs, no Orders, no Dashboard", async () => {
    h.session = { user: { id: "u1" } };
    render(<SiteHeader cartEnabled={false} />);
    await settle();

    expect(linksWithin(bar())).toEqual([
      ["Studio", "/studio"],
      ["Shop", "/shop"],
    ]);
  });

  it("keeps Cart visible in the bar with its count", async () => {
    h.session = { user: { id: "u1" } };
    h.headerState = { isAdmin: false, cartCount: 3, runningJobs: 0 };
    render(<SiteHeader cartEnabled />);
    await settle();

    const cart = within(bar()).getByRole("link", { name: "Cart (3)" });
    expect(cart.getAttribute("href")).toBe("/cart");
  });
});

describe("SiteHeader account menu", () => {
  it("holds Orders and, for an admin, Admin", async () => {
    h.session = { user: { id: "u1", email: "a@b.test" } };
    h.headerState = { isAdmin: true, cartCount: 0, runningJobs: 0 };
    render(<SiteHeader cartEnabled={false} />);
    await settle();

    const menu = await openMenu();
    expect(linksWithin(menu)).toEqual([
      // Studio and Shop repeat inside the menu for phones (sm:hidden in the
      // bar's place); the account items follow.
      ["Studio", "/studio"],
      ["Shop", "/shop"],
      ["Orders", "/orders"],
      ["Admin", "/admin"],
    ]);
    expect(within(menu).getByText("a@b.test")).toBeTruthy();
    expect(within(menu).getByRole("button", { name: "Feedback" })).toBeTruthy();
    expect(within(menu).getByRole("button", { name: "Sign out" })).toBeTruthy();
  });

  it("omits Admin for a non-admin", async () => {
    h.session = { user: { id: "u1" } };
    render(<SiteHeader cartEnabled={false} />);
    await settle();

    const menu = await openMenu();
    expect(linksWithin(menu).map(([label]) => label)).not.toContain("Admin");
  });

  it("never shows Dashboard or My Designs anywhere", async () => {
    h.session = { user: { id: "u1" } };
    h.headerState = { isAdmin: true, cartCount: 0, runningJobs: 0 };
    render(<SiteHeader cartEnabled />);
    await settle();
    await openMenu();

    expect(screen.queryByRole("link", { name: "Dashboard" })).toBeNull();
    expect(screen.queryByRole("link", { name: "My Designs" })).toBeNull();
    expect(screen.queryByText("New Design")).toBeNull();
  });
});

describe("SiteHeader signed out", () => {
  it("shows Studio, Shop and Sign in in the bar, and no Orders anywhere", async () => {
    render(<SiteHeader cartEnabled={false} />);
    await settle();

    expect(linksWithin(bar())).toEqual([
      ["Studio", "/studio"],
      ["Shop", "/shop"],
    ]);
    expect(within(bar()).getByRole("link", { name: "Sign in" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();

    const menu = await openMenu();
    expect(linksWithin(menu).map(([label]) => label)).not.toContain("Orders");
    expect(within(menu).getByRole("button", { name: "Feedback" })).toBeTruthy();
  });
});

describe("running-jobs badge", () => {
  it("links to /studio", async () => {
    h.session = { user: { id: "u1" } };
    h.headerState = { isAdmin: false, cartCount: 0, runningJobs: 2 };
    render(<SiteHeader cartEnabled={false} />);

    const badge = await screen.findByTestId("running-jobs-badge");
    expect(badge.getAttribute("href")).toBe("/studio");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/nico/src/prntd/.claude/worktrees/nav-model-a && npx vitest run src/components/__tests__/site-header.test.tsx`
Expected: FAIL — there is no `header-bar` / `header-menu` test id and no `Account menu` button.

If `@testing-library/user-event` is not a dependency, check first:

```bash
cd /Users/nico/src/prntd/.claude/worktrees/nav-model-a && node -e "console.log(require('./package.json').devDependencies['@testing-library/user-event'] ?? 'MISSING')"
```

If it reports `MISSING`, do **not** add a dependency — replace the two `userEvent.click(...)` calls with `fireEvent.click(...)` from `@testing-library/react` and adjust the import. Say which you used in the task report.

- [ ] **Step 3: Rewrite the header's link model**

In `src/components/site-header.tsx`, replace the `links` block (~lines 91–107) with:

```tsx
  // Nav model A (docs/ux-design-review-2026-09.md): two verbs in the bar plus
  // an account menu. Studio is where you make; Shop is where you buy; Cart is
  // funnel-critical so it never goes behind a tap. Everything about *you* —
  // Orders, Admin, Feedback, which account this is, the build, signing out —
  // is one tap into the menu.
  //
  // "My Designs" is gone from the header: it is the Studio's Library tab now
  // (src/components/studio-tabs.tsx). Organizer storefronts are retired
  // (#191), so there is no Dashboard entry.
  //
  // Studio shows signed-out too. It bounces an unauthenticated visitor to
  // /sign-in via middleware, which is the honest answer to "where do I make
  // one" — the alternative is hiding the product's main verb from everyone
  // who has not signed up.
  const primaryLinks: NavLink[] = [
    { href: "/studio", label: "Studio" },
    { href: "/shop", label: "Shop" },
  ];

  // Account-menu links. Cart is deliberately absent — it lives in the bar.
  const accountLinks: NavLink[] = isAuthed
    ? [
        { href: "/orders", label: "Orders" },
        ...(isAdmin ? [{ href: "/admin", label: "Admin" }] : []),
      ]
    : [];
```

- [ ] **Step 4: Rewrite the bar**

Replace the `{/* Desktop nav */}` block and the `{/* Mobile: hamburger */}` block with one bar. Add `data-testid="header-bar"` to the row that holds the wordmark and the links, so the test can tell bar from menu:

```tsx
      <div className="flex items-center justify-between" data-testid="header-bar">
        <Link href="/" className="font-bold tracking-tight text-accent-rose">
          PRNTD
        </Link>

        {/* Always in the bar itself, not inside the account menu: a phone
            user who left the Studio mid-generation has to see it without
            opening a menu. Links to the Studio, where a running generation
            renders as a pending cell. */}
        {runningJobs > 0 && (
          <Link
            href="/studio"
            className="ml-3 mr-auto rounded-full border border-border px-2 py-0.5 text-xs text-text-muted hover:text-foreground transition-colors"
            data-testid="running-jobs-badge"
          >
            {runningJobs === 1 ? "1 generating" : `${runningJobs} generating`}
          </Link>
        )}

        <div className="flex items-center gap-4">
          {/* The two verbs: in the bar from sm: up, inside the menu on a
              phone, where there is no room for them beside Cart. */}
          {primaryLinks.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="hidden sm:inline text-sm text-text-muted hover:text-foreground transition-colors"
            >
              {l.label}
            </Link>
          ))}

          {/* Cart never moves into the menu: it is the funnel, and a count
              behind a tap is a count nobody sees. */}
          {showCart && (
            <Link
              href="/cart"
              className="text-sm text-text-muted hover:text-foreground transition-colors"
            >
              {cartLabel}
            </Link>
          )}

          {!isAuthed && (
            <Link
              href="/sign-in"
              className="hidden sm:inline text-sm text-text-muted hover:text-foreground transition-colors"
            >
              Sign in
            </Link>
          )}

          <button
            ref={menuButtonRef}
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Account menu"
            aria-expanded={menuOpen}
            className="flex items-center p-2 -mr-2 sm:mr-0 sm:p-0"
          >
            <span className="hidden sm:inline text-sm text-text-muted hover:text-foreground transition-colors">
              Account
            </span>
            <span className="sm:hidden flex flex-col gap-1" aria-hidden>
              <span className="block w-5 h-0.5 bg-foreground" />
              <span className="block w-5 h-0.5 bg-foreground" />
              <span className="block w-5 h-0.5 bg-foreground" />
            </span>
          </button>
        </div>
      </div>
```

- [ ] **Step 5: Rewrite the dropdown as the account menu**

Replace the `{menuOpen && (…)}` block with:

```tsx
      {/* The account menu — anchored to the right edge under its trigger,
          solid raised panel so it reads over page content. Same panel at
          every breakpoint; the two primary verbs appear inside it only on
          phones, where the bar has no room for them. */}
      {menuOpen && (
        <div
          ref={menuRef}
          data-testid="header-menu"
          className="absolute right-2 top-full z-50 mt-1 w-64 max-w-[calc(100vw-1rem)] flex flex-col rounded-md border border-border bg-surface-raised py-1"
        >
          {primaryLinks.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setMenuOpen(false)}
              className="sm:hidden flex min-h-11 items-center justify-end px-4 text-lg text-foreground hover:bg-surface transition-colors"
            >
              {l.label}
            </Link>
          ))}

          {/* Which account is signed in (#126) — with two accounts the only
              other tell is whether Admin shows. */}
          {isAuthed && session?.user?.email && (
            <span className="truncate px-4 pt-2 pb-1 text-right text-xs text-text-faint">
              {session.user.email}
            </span>
          )}

          {accountLinks.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setMenuOpen(false)}
              className="flex min-h-11 items-center justify-end px-4 text-lg text-foreground hover:bg-surface transition-colors"
            >
              {l.label}
            </Link>
          ))}

          <button
            onClick={() => {
              setMenuOpen(false);
              setFeedbackOpen(true);
            }}
            className="flex min-h-11 items-center justify-end px-4 text-lg text-foreground hover:bg-surface transition-colors"
          >
            Feedback
          </button>

          {isAuthed ? (
            <button
              onClick={signOut}
              className="flex min-h-11 items-center justify-end px-4 text-lg text-foreground hover:bg-surface transition-colors"
            >
              Sign out
            </button>
          ) : (
            <Link
              href="/sign-in"
              onClick={() => setMenuOpen(false)}
              className="sm:hidden flex min-h-11 items-center justify-end px-4 text-lg text-foreground hover:bg-surface transition-colors"
            >
              Sign in
            </Link>
          )}

          <span className="px-4 pt-2 pb-1 text-right text-[10px] leading-none text-text-faint font-mono">
            {buildDate}
          </span>
        </div>
      )}
```

Note the test's signed-out case opens the menu and expects a `Feedback` button — it does not assert on `Sign in` inside the menu, so the `sm:hidden` copy above is safe. If `getAllByRole("link")` in the test trips over the duplicate `Sign in` (bar + menu), that is a real duplicate-name ambiguity: scope the bar assertion with `within(bar())`, which the test already does.

- [ ] **Step 6: Run the header tests to verify they pass**

Run: `cd /Users/nico/src/prntd/.claude/worktrees/nav-model-a && npx vitest run src/components/__tests__/site-header.test.tsx`
Expected: PASS.

- [ ] **Step 7: Typecheck, lint the file, commit**

Run:

```bash
cd /Users/nico/src/prntd/.claude/worktrees/nav-model-a
npm run typecheck
npx eslint src/components/site-header.tsx
```

Expected: no errors.

```bash
cd /Users/nico/src/prntd/.claude/worktrees/nav-model-a
git add -A
git commit -m "$(cat <<'EOF'
feat(nav): header becomes Studio, Shop, Cart and an account menu

Two verbs in the bar plus Cart with its count; Orders, Admin, Feedback, the
signed-in email, the build date and Sign out move into one account menu at
every breakpoint. My Designs leaves the header — it is the Studio's Library
tab. On phones the two verbs live inside the menu, where the bar has no room.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018gyyDkawjSPfsD7s4QeSsN
EOF
)"
```

---

### Task 4: Retarget every destination — auth, empty states, breadcrumbs, middleware, e2e

**Files:**
- Modify: `src/lib/nav.ts`
- Modify: `src/lib/__tests__/nav.test.ts`
- Modify: `src/middleware.ts`
- Modify: `src/app/(auth)/sign-in/page.tsx:42-45`
- Modify: `src/app/(auth)/sign-up/page.tsx:32`
- Modify: `src/app/orders/orders-list.tsx:56,82`
- Modify: `src/app/cart/page.tsx:119,197`
- Modify: `src/app/preview/page.tsx:813`
- Modify: `src/app/d/[imageId]/published-image-view.tsx:68`
- Modify: `src/app/d/[imageId]/conversation-actions.tsx:70`
- Modify: `src/app/d/conversation-actions.ts:62`
- Modify: `src/app/design/actions.ts:1006`
- Modify: `src/app/designs/actions.ts:176`
- Modify: `src/app/d/[imageId]/__tests__/conversation-images.test.tsx:27`
- Modify: `e2e/helpers/auth.ts:29-33`
- Modify: `e2e/guest-funnel.spec.ts:26`

**Interfaces:**
- Consumes: `/studio/library` (Task 1), `/shop` (Task 2), the header (Task 3).
- Produces: nothing new. `breadcrumbTrail` / `upTarget` keep their existing signatures.

- [ ] **Step 1: Write the failing breadcrumb tests**

Open `src/lib/__tests__/nav.test.ts` and re-point the existing cases, then add the new ones. The edits, precisely:

- The top-level-hub loop at line ~10 becomes:

```ts
    for (const hub of ["/shop", "/studio", "/studio/library", "/orders", "/admin"]) {
```

- The `?from=` cases at lines ~48–65 become (keeping the legacy fallbacks, so a link someone shared last week still resolves):

```ts
  it("uses the recorded origin as the detail page's parent", () => {
    expect(breadcrumbTrail("/d/img1", { from: "/studio/library" }).at(-1)).toEqual({
      label: "My Designs",
      href: "/studio/library",
    });
    expect(breadcrumbTrail("/d/img1", { from: "/orders" }).at(-1)).toEqual({
      label: "Orders",
      href: "/orders",
    });
    expect(breadcrumbTrail("/d/img1", { from: "/shop" }).at(-1)).toEqual({
      label: "Shop",
      href: "/shop",
    });
  });

  it("still resolves the retired origins /designs and /prints", () => {
    // Links shared before nav model A carry the old markers; they must not
    // fall through to the Shop default.
    expect(breadcrumbTrail("/d/img1", { from: "/designs" }).at(-1)).toEqual({
      label: "My Designs",
      href: "/studio/library",
    });
    expect(breadcrumbTrail("/d/img1", { from: "/prints" }).at(-1)).toEqual({
      label: "Shop",
      href: "/shop",
    });
  });

  it("falls back to the Shop when there is no recorded origin", () => {
    expect(breadcrumbTrail("/d/img1").at(-1)).toEqual({
      label: "Shop",
      href: "/shop",
    });
  });
```

- Add a case for the funnel's new parent:

```ts
  it("puts the thread and the preview under the Studio", () => {
    expect(upTarget("/design")).toEqual({ label: "Studio", href: "/studio" });
    expect(breadcrumbTrail("/preview", { id: "d1" })).toEqual([
      HOME,
      { label: "Studio", href: "/studio" },
      { label: "Design", href: "/design?id=d1" },
    ]);
  });
```

- Line ~98's `expect(upTarget("/prints")).toEqual(HOME);` becomes `expect(upTarget("/shop")).toEqual(HOME);`.

Leave every other assertion in the file exactly as it is.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/nico/src/prntd/.claude/worktrees/nav-model-a && npx vitest run src/lib/__tests__/nav.test.ts`
Expected: FAIL — the trail still names `/designs`, `/prints` and "My Designs" as `/design`'s parent.

- [ ] **Step 3: Update `src/lib/nav.ts`**

Replace `detailParent` with:

```ts
/**
 * A design detail (/d/[id]) is reachable from several hubs. We record the
 * origin in ?from so "up" returns there; shared links with no origin fall
 * back to the Shop, the public storefront.
 *
 * The retired markers /designs and /prints still resolve — links carrying
 * them were shared before nav model A and outlive the route move.
 */
function detailParent(from: string | undefined): Crumb {
  switch (from) {
    case "/studio/library":
    case "/designs":
      return { label: "My Designs", href: "/studio/library" };
    case "/orders":
      return { label: "Orders", href: "/orders" };
    case "/shop":
    case "/prints":
    default:
      return { label: "Shop", href: "/shop" };
  }
}
```

In `breadcrumbTrail`, replace the two locals and the hub list:

```ts
  const studio: Crumb = { label: "Studio", href: "/studio" };
  const designStep: Crumb = {
    label: "Design",
    href: `/design${query(params, ["id"])}`,
  };

  if (pathname === "/") return [];

  if (
    pathname === "/shop" ||
    pathname === "/studio" ||
    pathname === "/studio/library" ||
    pathname === "/orders" ||
    pathname === "/admin"
  ) {
    return [HOME];
  }

  if (pathname === "/cart") return [HOME];
  // The thread and the preview hang off the Studio bench, not the library:
  // the bench is where a conversation you are still working on lives.
  if (pathname === "/design") return [HOME, studio];
  if (pathname === "/preview") return [HOME, studio, designStep];
```

`/studio/archive` is left out of the hub list on purpose — the tab strip is its way back up, and adding it would put a second, differently-shaped door beside the tabs.

- [ ] **Step 4: Run the nav tests to verify they pass**

Run: `cd /Users/nico/src/prntd/.claude/worktrees/nav-model-a && npx vitest run src/lib/__tests__/nav.test.ts`
Expected: PASS.

- [ ] **Step 5: Update the middleware**

In `src/middleware.ts`, the `startsWith` on `/studio` already covers `/studio/library` and `/studio/archive`, but the `matcher` must actually run for those paths — it does, via `"/studio/:path*"`. The one real change is keeping `/designs` gated (its redirect target is protected, so a signed-out visitor should reach `/sign-in` in one hop, not two) and stating why `/shop` stays public:

```ts
// Personal-records routes — always behind sign-in. Note startsWith matching:
// "/designs" stays protected even when "/design" is opened (the funnel route),
// because "/design/x".startsWith("/designs") is false. Same for /orders vs
// /order. "/studio" covers /studio/library and /studio/archive.
//
// "/designs" is now only a 308 to /studio/library (nav model A), but it stays
// on this list so a signed-out visitor lands on /sign-in in one hop instead of
// bouncing through the redirect. "/shop" is deliberately absent — the
// community feed is public, and so is the mothballed organizer /shop/[slug].
const ALWAYS_PROTECTED = ["/designs", "/orders", "/admin", "/studio"];
```

The `matcher` array is unchanged. Verify `/shop` appears nowhere in it.

- [ ] **Step 6: Retarget the auth defaults**

`src/app/(auth)/sign-in/page.tsx:42-45`:

```tsx
    // Honor ?next= for post-sign-in redirects. Restricted to same-origin
    // paths to prevent open-redirect. The default is the Studio — under nav
    // model A that is where a signed-in user's work lives.
    const next = searchParams.get("next");
    const safeNext = next && next.startsWith("/") && !next.startsWith("//")
      ? next
      : "/studio";
    router.push(safeNext);
```

`src/app/(auth)/sign-up/page.tsx:32`:

```tsx
    router.push("/studio");
```

- [ ] **Step 7: Retarget the empty-state and post-action destinations**

`src/app/orders/orders-list.tsx` — the header button at ~line 56 and the empty-state action at ~line 82 both become `/studio`:

```tsx
          <Link href="/studio">
            <Button size="sm">New Design</Button>
          </Link>
```

```tsx
              <Link href="/studio">
                <Button>Make your first design</Button>
              </Link>
```

`src/app/cart/page.tsx` — the empty-state CTA at ~line 119 and the "Add another design" button at ~line 197:

```tsx
              <Link href="/studio">
                <Button size="lg">Start a design</Button>
              </Link>
```

```tsx
                onClick={() => router.push("/studio")}
```

`src/app/preview/page.tsx:813` — the load-failure escape hatch:

```tsx
        <Link href="/studio/library" className="underline">My Designs</Link>
```

`src/app/d/[imageId]/published-image-view.tsx:68` — after un-publishing:

```tsx
      // The page is no longer public — send the owner back to their library.
      router.push("/studio/library");
```

`src/app/d/[imageId]/conversation-actions.tsx:70` — after deleting a conversation:

```tsx
    window.location.assign("/studio/library");
```

- [ ] **Step 8: Retarget the `revalidatePath` calls that named `/designs`**

Three sites, each becomes `/studio/library`:

- `src/app/design/actions.ts:1006`
- `src/app/designs/actions.ts:176`
- `src/app/d/conversation-actions.ts:62`

```ts
  revalidatePath("/studio/library");
```

In `src/app/d/conversation-actions.ts` also fix the comment two lines up so it names the view, not the route: `// … and the Library's Archived marker is now wrong.`

- [ ] **Step 9: Fix the one component test that hard-codes the old origin**

`src/app/d/[imageId]/__tests__/conversation-images.test.tsx:27`:

```tsx
      from="/studio/library"
```

If the test asserts on a resulting `href` containing `from=/designs`, update that expectation to `from=/studio/library` as well.

- [ ] **Step 10: Re-point the e2e waits (edited here, run by CI)**

`e2e/helpers/auth.ts` — the docblock at line ~7 and the wait at lines ~29–33:

```ts
 * Email/password sign-up has no verification gate (it redirects straight to
 * the Studio), so we can mint a real organizer through the UI. The freshly
 * created user owns whatever the spec seeds (designs) and builds (stores).
```

```ts
  // Sign-up routes to /studio on success; surface a sign-up error otherwise.
  await expect(
    page,
    "sign-up did not complete (still off /studio)"
  ).toHaveURL(/\/studio/, { timeout: 30_000 });
```

`e2e/guest-funnel.spec.ts:26` — the personal-route gate now names the live route:

```ts
  await page.goto("/studio/library");
  await expect(page).toHaveURL(/sign-in/);
```

Leave the following `/orders` assertion exactly as it is.

- [ ] **Step 11: Verify no live `/designs` link survives**

Run:

```bash
cd /Users/nico/src/prntd/.claude/worktrees/nav-model-a
grep -rn 'href="/designs"\|push("/designs")\|assign("/designs")\|revalidatePath("/designs")\|from=/designs' src e2e --include='*.ts' --include='*.tsx'
```

Expected: zero hits. Imports of `@/app/designs/actions` and the `case "/designs":` legacy branch in `nav.ts` are correct and must remain — this grep does not match them.

- [ ] **Step 12: Run the whole suite and commit**

Run:

```bash
cd /Users/nico/src/prntd/.claude/worktrees/nav-model-a
npm run lint && npm run typecheck && npm test
```

Expected: lint clean, no type errors, every test passing. Any failure here is in scope for this task — fix it, do not weaken the assertion.

```bash
cd /Users/nico/src/prntd/.claude/worktrees/nav-model-a
git add -A
git commit -m "$(cat <<'EOF'
feat(nav): retarget every destination to the model A routes

Sign-in/sign-up land on /studio; the Orders, Cart and preview CTAs point at
/studio or /studio/library; breadcrumbs put the thread and the preview under
the Studio and resolve both the new and the retired ?from= markers;
revalidatePath follows the library move; middleware keeps /designs gated and
/shop public; the e2e sign-up wait and the guest-funnel gate name the live
routes.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018gyyDkawjSPfsD7s4QeSsN
EOF
)"
```

---

## Final verification (controller, after all four tasks)

```bash
cd /Users/nico/src/prntd/.claude/worktrees/nav-model-a
npm run lint && npm run typecheck && npm test && npm run build
```

The build must succeed and its route manifest must list `/shop` and `/shop/[slug]` as separate routes, and `/studio/library` as a route. Local e2e is not runnable here (it needs secrets); CI runs it on the PR.

## Rulings this plan makes

Each is a judgment call the spec left open. If a reviewer disagrees with one, it is a design change, not a bug.

1. **`src/app/designs/actions.ts` stays put.** A dozen modules import it and it is not a route file. Only `page.tsx` and `library-grid.tsx` move. Cost if wrong: a directory named for a retired route keeps existing, which is mildly confusing to read.
2. **The Studio heading and the tab strip live in `src/app/studio/layout.tsx`,** so the three pages drop their own `<h1>` and the archive drops its `← Studio` link. Cost if wrong: one heading for three views may read as too little labelling; the fix is a subtitle per page, not a second heading.
3. **`permanentRedirect` (308), not `redirect` (307),** for `/designs` and `/prints`. Cost if wrong: browsers and crawlers cache the move, so reversing it later needs a cache-busting deploy.
4. **`?from=/designs` and `?from=/prints` keep resolving** in `breadcrumbTrail`. Cost if wrong: two dead branches carried forever; the alternative is breaking every link shared before today.
5. **`/design` and `/preview` hang off `/studio` (the bench), not the Library.** Cost if wrong: Escape from a thread lands on the bench rather than the grid of finished images.
6. **`/studio/archive` is not a breadcrumb hub.** The tab strip is its way up. Cost if wrong: no visible back affordance on that page for someone who ignores tabs.
7. **The account-menu trigger reads "Account" on `sm:` and is a hamburger on phones, with `aria-label="Account menu"` at both.** Cost if wrong: a signed-out visitor sees an "Account" button holding only Feedback and a build date.
8. **Studio shows in the nav for signed-out visitors** (spec-mandated), which means tapping it bounces to `/sign-in` via middleware. Cost if wrong: a dead-end tap for someone who has not signed up; the alternative hides the product's main verb.
9. **Cart never moves into the account menu**, at any breakpoint. Cost if wrong: the bar is one item busier on a 390px phone.
10. **`/designs` stays in `ALWAYS_PROTECTED`.** Cost if wrong: nothing functional — it saves one hop for a signed-out visitor on an old bookmark.
11. **Cart's "Add another design" is retargeted to `/studio` too,** though it is not an empty state. Cost if wrong: adding a second item starts at the bench instead of straight in a fresh thread — one extra tap.
