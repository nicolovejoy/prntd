# Ledger — /studio hydration mismatch (slice F, 2026-09-25)

Plan: `docs/superpowers/plans/2026-09-25-studio-hydration-418.md`.
Branch: `claude/studio-hydration-418`.

## Process deviation

The controller session had no subagent tool (no Agent/Task tool in its
toolset), so the per-task implementer/reviewer dispatches in the batch brief
could not happen. The controller implemented each task, then reviewed its own
diff against the acceptance criteria in a separate pass, and did the
whole-branch review itself over `git diff origin/main...HEAD` plus the files
around it. None of these reviews is independent. The main session should
treat this branch as unreviewed by a second model before merge.

## Investigation

- Repro setup: `npm run db:migrate` on a `file:` DB in the session
  scratchpad, `next dev -p 3000` with the CI dummy env plus the prod flags
  (guest funnel, cart, multi-placement), a real account made through
  `/sign-up`, lanes seeded by SQL at several ages, Chromium 1194 via
  Playwright with `timezoneId: America/Los_Angeles`, console + pageerror
  capture. Page chunk delay via `page.route`.
- Baseline, no throttling: first runs clean; one later run showed the header
  mismatch with no throttling at all (timing-dependent).
- Page chunk delayed 2 s: header mismatch every time on `/studio` and
  `/orders`. Diff: server `<a href="/sign-in">`, client
  `<button aria-label="Account menu">` inside `SiteHeader`.
- Mechanism traced in library code: better-auth 1.5.6
  `client/react/react-store.mjs` (`useSyncExternalStore(subscribe, get, get)`,
  `useRef(store.get())`), nanostores 1.2.0 `atom.get()` mounts an unlistened
  atom, better-auth `client/query.mjs` `onMount` → `setTimeout(0)` →
  `/get-session`. A restarted hydration re-runs `useRef(store.get())` and
  sees the fetched session.
- Prod message `args[]=HTML`: checked in React 19.2.4's production build —
  `throwOnHydrationMismatch(fiber, fromText)` formats `"text"` for text
  mismatches and `"HTML"` otherwise. The header mismatch is an element
  mismatch, so it is the prod error. The two clock/zone mismatches below are
  the `text` variant.
- Running generation seeded (`image_generation`, started 20 s earlier): text
  mismatch `0:25` → `0:26` in the pending cell.
- Lane at 2026-08-11T03:00Z (45 days): text mismatch `8/11/2026` →
  `8/10/2026`. First attempts showed nothing because the 3-day idle sweep had
  already closed those lanes; reopening one (`closed_at = null`) reproduced it.
- Other pages: header issue is root-layout, so every page. `/orders`
  `formatDate` pins locale but not zone. Admin pages fetch client-side after
  mount (no hydrated dates). `design-client.tsx`, `feedback-widget.tsx`:
  clock reads only in handlers/refs.

## Rulings and judgment calls

1. **Fix the header by gating the session on hydration, not by reading the
   session on the server.** Reading it in the root layout would make every
   page dynamic, and `/` must read no session (#220 pins that).
2. **Fix all three mismatches, not only the prod one.** The brief lists the
   `nowMs` / `timeAgo` suspects and asks to check the rest of the `/studio`
   tree; both reproduced locally, so they are in scope. `/orders`'
   `formatDate` is the same zone bug on another page the brief asked about;
   one-line fix with a hydration test. Judgment call, flagged.
3. **Pacific, not the viewer's zone, for the date fallbacks.** The shared
   convention says a calendar day shown to a human is America/Los_Angeles.
   It is also the only choice that is identical on the server and the
   browser without deferring the label to after mount.
4. **`initialNowMs` is optional on `StudioClient`.** 73 test renders omit
   it, and slice A (#241) will likely edit the same test file; a required
   prop would force a 73-line churn and a conflict. The page-wiring test
   guards the one production caller instead.
5. **New test files rather than appending to `site-header.test.tsx` /
   `studio-client.test.tsx`**, to avoid end-of-file conflicts with slice A.
6. **`Date.now()` in the Studio page body carries a targeted
   `eslint-disable-next-line react-hooks/purity`** with the reason above it,
   rather than a helper that would hide the call from the rule. The page is
   an async server component: it renders once per request and never
   re-renders, which is the case the rule guards against.
7. **The header shape after hydration is unchanged.** Before and after the
   fix, the server HTML shows "Sign in" to a signed-in user until the
   session arrives. That flash predates this slice; removing it needs a
   server session read in the root layout, which ruling 1 excludes.

## Task log

- **Task 1** (`65568c3`): `useHydrated` + header gate. Test written first;
  against the old code it failed with the exact prod diff (server `<a
  href="/sign-in">`, client `<button aria-label="Account menu">`). Self-review
  tightened the header comment ("appears right after hydration commits, or
  when the fetch lands, whichever is later"). Existing `site-header.test.tsx`
  (11 tests) passes unchanged.
- **Task 2** (`90d9b23`): `initialNowMs` + mount refresh + page wiring. Test
  written first; old code failed with a text mismatch and the wiring test
  failed on the missing prop. Lint caught `react-hooks/purity` on the page's
  `Date.now()` → ruling 6. All 80 `studio-client.test.tsx` tests pass
  unchanged.
- **Task 3** (`ad037e7`): `DISPLAY_TIME_ZONE`, `timeAgo` fallback,
  `orders-list` `formatDate`. All three new tests failed on the pre-fix code
  (`8/11/2026` vs `8/10/2026`, `Aug 11` vs `Aug 10`). Self-review: the old
  `timeAgo` docblock claimed "/designs cards use" the same scale; those cards
  were deleted in #184, so the docblock was rewritten.

## Whole-branch review (controller, not independent — see deviation above)

Scope: `git diff origin/main...HEAD`, plus every `"use client"` module and
every lib module a client component imports that reads the clock, a zone,
randomness or storage, plus every comment in `src/` mentioning `nowMs`,
`useSession` or hydration.

- Finding (fixed, `9b3c379`): `useHydrated`'s docblock said a restarted
  hydration "re-reads every store". Imprecise; reworded to what actually
  happens (the restarted pass runs each component from scratch, so a hook
  that snapshots a store during render reads its current value).
- Checked, no change: `SiteHeader`'s `getHeaderState` effect fires the same
  number of times as before (mount with no session, then once the session id
  appears). `useExamplePrompts` already defers its random pick to mount.
  `user-orders` is a type-only import on the client. The admin pages load
  and format dates only after a client-side fetch. No stale comment refers
  to the old `nowMs` initialiser or to the header reading the session during
  hydration.

## Live verification (local, fixed branch)

Same Playwright harness, page chunk delayed 2 s, a running generation seeded
and a 45-day lane reopened, `/studio` then `/orders`, four runs: no
hydration error in any. Then the four source files swapped back to
`origin/main` under the dev server, identical conditions: both the date
text mismatch (`8/11/2026` → `8/10/2026`) and the header HTML mismatch
reappeared. Files restored; worktree clean.

## Gate

- `npm run lint`: 0 errors (22 pre-existing warnings, none in branch files)
- `npm run typecheck`: pass
- `npx vitest run`: 176 files, 1824 tests, all pass (main: 1812)
- `npm run build` with the CI dummy env: pass; `/studio` still dynamic
- `npm run db:generate`: "No schema changes, nothing to migrate"

## Independent review (main session, after push) and fix round

The main session ran an independent whole-branch review. No Critical or
Important findings. It confirmed that the prod `args[]=HTML` matches the
header mismatch and that 6 of the new tests fail on main. Three small
changes were asked for, all made:

1. **Mount clock sync is now a `useLayoutEffect`** (`studio-client.tsx`).
   With a passive effect, a back/forward remount from the router cache (where
   `initialNowMs` can be minutes old) painted one frame of stale labels
   before the effect ran. A state update in a layout effect re-renders before
   paint. It runs after the hydration commit, so the hydration render still
   uses `initialNowMs`. React 19 does not warn about `useLayoutEffect` on the
   server. The existing "switches to the browser's clock once hydrated" test
   still pins the switch.
2. **`display-time-zone.ts` docblock widened**: the Pacific rule covers
   every calendar day shown to a person (repo convention), with hydration as
   the second reason for server-rendered client components.
3. **The three hydration test files opt in to the act environment**
   (`IS_REACT_ACT_ENVIRONMENT = true` in `beforeAll`, previous value restored
   in `afterAll`). The setup file imports Testing Library, but Testing
   Library only sets this flag through global `beforeAll`, which this Vitest
   config does not expose (`globals` is off), so it was unset for these
   files. With it on, the three files print no act warnings. Also added:
   `getHeaderState` is called exactly twice when signed in (mount, then the
   session id appearing) and once when signed out, pinning review note 2
   above. Mutation check: dropping the header gate still fails the
   signed-in hydration test.

Re-gate after the fix round: lint 0 errors (same 22 pre-existing warnings,
none in branch files), typecheck pass, 176 files / 1824 tests pass, build
pass with the CI dummy env, `db:generate` "No schema changes".

## Follow-ups (not in this slice)

- `src/app/admin/errors/page.tsx:54` (`toLocaleString(undefined, …)`) and
  `src/app/admin/published/page.tsx:92` (`toLocaleDateString()`) format
  dates in the server's zone, UTC on Vercel. Both are server components, so
  there is no hydration mismatch; they break only the "Pacific on display"
  convention. Left unchanged per the main session; pass `DISPLAY_TIME_ZONE`
  and an explicit locale when they are next touched.
