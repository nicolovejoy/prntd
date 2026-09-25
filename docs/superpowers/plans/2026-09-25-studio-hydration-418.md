# /studio hydration mismatch (React #418) — plan

Slice F of the 2026-09-25 batch (`docs/superpowers/plans/2026-09-25-batch.md`).
Branch `claude/studio-hydration-418`. No migration.

## What was reproduced

Local repro: `next dev` against a migrated `file:` libSQL DB, a real
email/password account with seeded lanes, Chromium via Playwright capturing
console errors and page errors. Three separate mismatches, each seen with
React's unminified diff:

1. **Site header, every page, signed-in users only. This is the prod error.**
   The diff:

   ```
   <SiteHeader cartEnabled={true}>
     ...
   +   <button aria-label="Account menu" ...>
   -   <a className="hidden sm:inline ..." href="/sign-in">
   ```

   The server always renders the header signed out (`authClient.useSession()`
   has no data on the server). On the client, better-auth's `useSession` is
   nanostores' `useStore`, which calls `useSyncExternalStore(subscribe, get,
   get)`: the server snapshot is the live store value. Its first render calls
   `store.get()`, and nanostores' `get()` on an atom with no listeners mounts
   it, which starts the `/get-session` fetch (better-auth's `onMount` +
   `setTimeout(0)`). If hydration then restarts after that fetch has landed,
   the restarted `SiteHeader` render reads the session, drops the "Sign in"
   link, and renders the account-menu button in its place. The restart
   happens when the page's own client chunk is slow to arrive. The repro hit
   it without any throttling on one run, and every time with the
   `/studio` or `/orders` page chunk delayed 2 s. `args[]=HTML` in the prod
   message matches: React reports `text` for text mismatches and `HTML` for
   element mismatches like this one.

2. **Studio pending cell, whenever a generation is running at page load.**
   `nowMs = useState(() => Date.now())` reads the clock on the server and
   again at hydration. The elapsed label differs by a second (`0:25` server,
   `0:26` client), React #418 with `args[]=text`. The lane header's
   `timeAgo(lane.lastActiveAt, nowMs)` has the same exposure at minute
   boundaries (`just now` / `1m ago`).

3. **Studio lane date after 30 days.** `timeAgo` falls back to
   `date.toLocaleDateString()` with no locale or zone: `8/11/2026` on the UTC
   server, `8/10/2026` in a Pacific browser. Reachable on the first load after
   a long absence, before the 3-day idle sweep (which runs after the
   response) closes the lane.

Other pages checked: the header mismatch is in the root layout, so it can hit
any page for a signed-in user (reproduced on `/orders` too). `/orders`
also has the date-zone issue in `orders-list.tsx`'s `formatDate` (locale is
pinned to `en-US`, zone is not). The admin pages format dates only after a
client-side fetch, so they never hydrate a date. `design-client.tsx` and
`feedback-widget.tsx` read the clock only in handlers and refs.

## Tasks

### Task 1 — hydration-safe session in the site header

- New `src/components/use-hydrated.ts`: `useHydrated()` returns `false` for
  the server render and for the whole hydration pass, `true` after hydration
  and on any plain client mount. Implemented with `useSyncExternalStore` and
  a server snapshot of `false`, so React itself re-renders after hydration.
- `SiteHeader` uses the session only once hydrated
  (`const session = hydrated ? liveSession : null`).

Acceptance:
- Server-rendering the header signed out and hydrating it while the session
  store already holds a signed-in session produces no recoverable error, and
  the header then shows the signed-in shape (no "Sign in" link).
- Existing `site-header.test.tsx` passes unchanged.

Tests (`src/components/__tests__/site-header-hydration.test.tsx`):
- SSR with `useSession` → null, then `hydrateRoot` with `useSession` →
  signed-in user: `onRecoverableError` never called; afterwards no "Sign in"
  link in the bar. Fails on the old code with the #418 diff above.
- Signed-out on both sides: still no error, "Sign in" link present.
- `useHydrated`: `false` in `renderToString`, `true` after `hydrateRoot`
  commits, `true` on a plain client render.

### Task 2 — one clock reading for the Studio's first render

- `src/app/studio/page.tsx` passes `initialNowMs={Date.now()}` to
  `StudioClient`.
- `StudioClient` takes optional `initialNowMs` and seeds `nowMs` from it
  (fallback `Date.now()` for callers that do not server-render, i.e. tests).
  A mount effect then sets `nowMs` to the browser's clock, so labels are
  current after hydration and after a remount from the router cache (whose
  RSC payload carries an old `initialNowMs`).

Acceptance:
- Server-rendering `StudioClient` at time T and hydrating it at T + 1.5 s
  with the same `initialNowMs` produces no recoverable error, for a lane
  with a pending job and a `lastActiveAt` 59.5 s before T.
- After hydration the labels reflect the client's clock (`0:26`, `1m ago`).
- The page passes a numeric `initialNowMs`.

Tests (`src/app/studio/__tests__/studio-hydration.test.tsx`):
- The SSR → hydrate case above. Fails on the old code (`0:25` vs `0:26`).
- Labels after the mount refresh.
- Page wiring: `StudioPage()` with `requireRealUser`, `getStudioLanesData`
  and `after` mocked returns a `StudioClient` element whose `initialNowMs`
  is a number within the call's time window.

### Task 3 — calendar days in Pacific time on hydrated date labels

- New `src/lib/display-time-zone.ts`: `DISPLAY_TIME_ZONE =
  "America/Los_Angeles"`, per the shared convention (UTC at rest, Pacific on
  display). A pinned zone and locale also make the string identical on the
  server and in the browser.
- `timeAgo`'s fallback becomes
  `toLocaleDateString("en-US", { timeZone: DISPLAY_TIME_ZONE })`.
- `orders-list.tsx` `formatDate` adds `timeZone: DISPLAY_TIME_ZONE`.

Acceptance:
- `timeAgo` for 2026-08-11T03:00Z, 45 days on, returns `8/10/2026` whatever
  the process zone is (UTC and Asia/Tokyo both checked).
- `StudioClient` server-rendered with `TZ=UTC` and hydrated with
  `TZ=America/Los_Angeles` shows no mismatch for a 45-day-old lane.
- `OrdersList` server-rendered with `TZ=UTC` and hydrated with
  `TZ=America/Los_Angeles` shows no mismatch, and shows `Aug 10, 2026` for
  an order created at 2026-08-11T03:00Z.

Tests: the three cases above (studio-view unit test, the Studio hydration
file, a new `orders-list-hydration.test.tsx`). The two hydration cases fail
on the old code.

## Gate

`npm run lint`, `npm run typecheck`, `npx vitest run`, `npm run build` with
the CI dummy env, `npm run db:generate` → "No schema changes". Then re-run
the local Playwright repro against the fixed branch: no hydration error with
the page chunk delayed, with a running generation, or with a 45-day lane.
