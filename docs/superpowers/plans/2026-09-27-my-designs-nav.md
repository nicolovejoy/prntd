# My Designs as a top-level destination — plan (2026-09-27)

Branch `claude/my-designs-nav`, from `origin/main` `f2792a5`. Migration-free.

## Decision (Nico, 2026-09-27, verbatim scope)

- The header becomes **Studio · My Designs · Shop · Cart · menu**.
- "Library" is renamed **"My Designs"** everywhere a user sees it.
- The page lives at **`/designs`**. Today `/designs` 308s to `/studio/library`;
  flip it: `/designs` is canonical and `/studio/library` 308s to `/designs`,
  preserving the query string.
- Studio's tab strip goes away, since only the bench is left.

His reason: "it's hard to find my designs" (on a phone it is three taps deep:
hamburger → Studio → Library tab), and "My Designs" is a better name than
"Library".

## Invariants

1. `/designs` has exactly the access rules `/studio/library` has today:
   - no session cookie → middleware sends the visitor to `/sign-in` (the
     matcher already lists `/designs`, and `ALWAYS_PROTECTED` already holds
     it; no functional middleware change);
   - a session → the page gate `requireStudioUser()` decides: a real account
     always, an anonymous guest-funnel session only while
     `GUEST_FUNNEL_ENABLED` is on (#241/#248), otherwise `/sign-in`.
2. The Active/All filter (#238), select mode and bulk delete (#195/#200) are
   unchanged. Internal identifiers (`LibraryGrid`, `library-view.ts`, the
   `library-*` test ids) keep their names — no user sees them, and renaming
   them churns e2e for nothing.
3. Old URLs keep working: `/studio/library` and `/studio/archive` both 308
   to `/designs` in ONE hop, carrying the query string. The `?from=` markers
   `/designs`, `/studio/library` and `/prints` all still resolve in
   `src/lib/nav.ts`.
4. Copy is persona C. Visible strings: "My Designs" (header, masthead,
   breadcrumbs), "Go to Studio" (empty-state button; "Bench" no longer names
   anything a user can see).
5. `src/app/studio/studio-client.tsx` and `src/lib/studio-view.ts` are being
   edited on another branch (#245): not touched here.
6. Phone-first: the header fits a 360px-wide viewport with no horizontal
   scroll; every bar item is a 44px-tall tap target below `sm:`.

## Task 1 — routes, links and the page move

- `src/app/designs/page.tsx` becomes the My Designs page (the content of
  today's `src/app/studio/library/page.tsx`), under `requireStudioUser()`.
  Layout mirrors `/orders` (`src/app/orders/orders-list.tsx`): outer
  `min-h-screen flex flex-col`, `main` `flex-1 px-4 sm:px-6 py-8 max-w-4xl
  mx-auto w-full`, a mono masthead `<h1>` "My Designs" with the exact class
  string `/orders` and `/shop` use, in a `mb-6` wrapper. Guest line
  (`GuestKeepLine next="/designs"`) under the masthead, only for a guest with
  at least one image (today's rule). Empty state: "No designs yet." with a
  "Go to Studio" button linking `/studio`.
- `git mv` `src/app/studio/library/library-grid.tsx` →
  `src/app/designs/library-grid.tsx` and its test →
  `src/app/designs/__tests__/library-grid.test.tsx`. Tile href becomes
  `/d/{imageId}?from=/designs`.
- New pure helper `src/lib/redirect-path.ts`:
  `pathWithSearch(path, searchParams)` → `path` plus the query string built
  from a Next `searchParams` object (`string | string[] | undefined` values;
  arrays repeat the key; undefined dropped; no `?` when empty). Unit tests.
- `src/app/studio/library/page.tsx` and `src/app/studio/archive/page.tsx`
  become async redirect pages: `permanentRedirect(pathWithSearch("/designs",
  await searchParams))`. Docblocks say why.
- `src/lib/nav.ts`: `/designs` is a top-level hub (`[HOME]`); drop
  `/studio/library` from the hub list (it only redirects now);
  `detailParent` maps `/designs` and `/studio/library` to
  `{ label: "My Designs", href: "/designs" }`.
- Every `/studio/library` href / push / assign / revalidatePath in `src/`
  becomes `/designs`: `src/app/preview/page.tsx`,
  `src/app/d/[imageId]/unpublish-action.tsx`,
  `src/app/d/[imageId]/conversation-actions.tsx`,
  `src/app/d/conversation-actions.ts`, `src/app/design/actions.ts` (×2),
  `src/app/designs/actions.ts`.
- `src/lib/funnel-routes.ts`: add `/designs` so the floating feedback
  launcher stays hidden there, as it is on `/studio/library` today (the
  header's Feedback menu item still reaches it). Note `/designs` is NOT
  matched by the `/design` prefix (`/design/` boundary), so it must be listed.
- `src/middleware.ts`: comments only (it no longer says `/designs` is a
  redirect). Matcher and lists unchanged. (Another branch renames this file
  to `src/proxy.ts`; keeping the diff to comments keeps that merge trivial.)
- Comments in files this task touches, plus `src/lib/require-user.ts`,
  `src/app/studio/guest-keep-line.tsx`, `src/app/designs/actions.ts`
  docblocks that name `/studio/library` or "the library is a Studio view".
- Tests: `route-redirects.test.tsx` (`/designs` no longer redirects;
  `/studio/library` and `/studio/archive` 308 to `/designs` and carry a query
  string incl. a repeated key); `middleware.test.ts` (sessionless `/designs`
  → `/sign-in`, with a cookie passes; `/studio/library` sessionless still →
  `/sign-in`); `guest-keep-line.test.tsx` (imports the `/designs` page; guest
  line `next=%2Fdesigns`; a guest with images sees it, empty library does not,
  a real user does not); `nav.test.ts`; `funnel-routes.test.ts`;
  `unpublish-action.test.tsx`; `conversation-images.test.tsx`;
  `sign-up-redirect.test.tsx` and `safe-next.test.ts` sample paths →
  `/designs`; new `redirect-path.test.ts`; a page test that the masthead reads
  "My Designs" and the empty-state button links `/studio` with "Go to Studio".
- `e2e/guest-funnel.spec.ts`: `/studio/library` → `/designs` (URL assertion,
  sign-up/sign-in `next=%2Fdesigns`, sessionless redirect check).

Acceptance: no `/studio/library` string left in `src/` or `e2e/` except the
two redirect pages, the `nav.ts` legacy `from` case, and tests that pin those.

## Task 2 — header and the Studio frame

- Delete `src/components/studio-tabs.tsx` and its test. `src/app/studio/
  layout.tsx` keeps the "Studio" `<h1>` with no bottom margin (so the bench's
  own 24px — `py-6` around the composer — is the gap under the heading, the
  same 24px it had under the strip). Docblock rewritten: one view now.
- `src/lib/nav.ts`: pure `isCurrentSection(pathname, href)` → `pathname ===
  href || pathname.startsWith(href + "/")`. Tests: `/designs` is not current
  for `/design`; `/design` is not current for `/designs`; `/studio/x` is
  current for `/studio`.
- `src/components/site-header.tsx`:
  - `primaryLinks` = Studio `/studio`, My Designs `/designs`, Shop `/shop`,
    rendered in the bar at every width (no `hidden sm:inline`), each
    `flex items-center min-h-11 sm:min-h-0 text-sm`.
  - Current section: `aria-current="page"` and
    `text-foreground underline underline-offset-[3px]`; otherwise
    `text-text-muted hover:text-foreground`. Same treatment for Cart on
    `/cart`.
  - The menu's phone-only copies of Studio/Shop are removed (the bar has
    them now). Sign in keeps its bar (`hidden sm:inline`) / menu
    (`sm:hidden`) split.
  - Bar spacing `gap-2 sm:gap-4`. Measured in Geist 14px: wordmark 47px,
    Studio 41, My Designs 75, Shop 33, "Cart (12)" 53, hamburger 44 with
    `-mr-2`: at 360px (328px inside the 16px gutters) `gap-4` needs 349px and
    `gap-3` 333px; `gap-2` needs 317px, leaving ~11px in the worst case
    (two-digit cart count) and ~36px normally.
  - Running-jobs badge: the full "N generating" pill (`data-testid=
    running-jobs-badge`, links `/studio`) shows from `sm:` up
    (`hidden sm:inline-flex`). On a phone it cannot fit beside four items, so
    the Studio link carries a 6px ink dot (`data-testid=running-jobs-dot`,
    `sm:hidden`, absolutely positioned so it takes no width) plus sr-only
    text ", N generating" (`sr-only sm:hidden`). Ink, not rose: rose is kept
    to the wordmark and Generate (Paper "One Mark").
  - Docblocks updated (nav model A now has three verbs; My Designs is back
    in the bar).
- `src/app/orders/orders-list.tsx`: the comment citing `studio-tabs.tsx`
  points at a file that no longer exists; reword it (comment only).
- Tests (`site-header.test.tsx`): bar links exactly Studio, My Designs,
  Shop (label + href) signed in, signed out and as a guest; no nav verb in
  the menu; `min-h-11` on each bar link and Cart; `aria-current` on exactly
  one link for `/designs`, `/studio`, `/shop`, `/cart`, none on `/design`
  and `/`; the phone dot + sr-only text when `runningJobs > 0` and the badge
  keeps its href; no "Library" anywhere.

## Task 3 — docs and comment sweep

- `docs/design-system.md`: every place describing Bench · Library tabs,
  `/studio/library`, "My Designs is gone from the header", the `/designs`
  retired section — rewritten to the new shape (three verbs + Cart + menu;
  My Designs at `/designs`; Studio is one view; old URLs 308).
- Remaining comments in `src/` and `e2e/` that describe the tab strip, the
  "Studio's two views", or `/studio/library` as the library's home (e.g.
  `src/lib/archive-conversations.ts`, `user-designs.ts`, `delete-image.ts`,
  `studio.ts`, `funnel-routes.ts`, `e2e/guest-funnel.spec.ts` header). Not
  `studio-client.tsx` / `studio-view.ts` (invariant 5) — any stale comment
  there is listed in the ledger instead.
- Historical plan/ledger docs under `docs/superpowers/` are records; leave
  them.

## Gate

`npm run lint`, `npm run typecheck`, `npx vitest run`, `npm run build` with
the CI dummy env, `npm run db:generate` → "No schema changes". Plus a
production-build check at 360px with Playwright (header scrollWidth ≤
viewport, bar items ≥ 44px tall) and `curl -I` on `/studio/library?x=1` →
308 `location: /designs?x=1`.

## e2e most at risk

`e2e/guest-funnel.spec.ts` (URLs), `e2e/store-compose.spec.ts` (opens the
Account menu to sign out — menu still there), `e2e/landing.spec.ts` (header).
