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
   it, and slice A (#241) edits the same test file; a required prop would
   force a 73-line churn and conflict. The page-wiring test guards the one
   production caller instead.
5. **New test files rather than appending to `site-header.test.tsx` /
   `studio-client.test.tsx`**, to avoid end-of-file conflicts with slice A.

## Task log

(filled in per task)
