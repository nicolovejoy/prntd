# #241 guests in Studio — progress ledger

Slice A of the 2026-09-25 batch. Plan:
`docs/superpowers/plans/2026-09-25-241-guest-studio.md`. Branch
`claude/241-guest-studio`.

## Process deviation

The controller session had no subagent tool (no Agent/Task tool was
available; ToolSearch found none). The brief's per-task implementer and
reviewer subagents, and the separate whole-branch review model, could not be
dispatched. The controller did each role itself, in order, and recorded each
review below. Mitigations: every new guest test was mutation-checked (made to
fail by breaking the code it pins, then restored); the gate was run by the
controller, never taken from a report; the whole-branch pass read files
around the diff, not only the diff.

## Rulings (from planning)

- **R1 gate predicate.** `canUseStudio(user, guestFunnel)`: no user → no;
  real user → yes; anonymous user → yes only while `GUEST_FUNNEL_ENABLED` is
  on. Pages and the three Studio actions share it. Flag off = Studio exactly
  as before (guests go to sign-in, actions refuse them).
- **R2 cookie-less first visit → sign-in.** Middleware unchanged; `/studio`
  stays in `ALWAYS_PROTECTED`. Only its comment was rewritten.
- **R3 line in the pages, not the layout.** Next's layout docs and auth guide:
  layouts do not re-render on navigation, so session-dependent rendering
  belongs in the page. Each page already reads the session via the gate.
- **R4 `requireRealUser` kept** for `/orders`.
- **R5 header running-jobs badge stays off for guests** (judgment call, not in
  #241's scope). Its docblock rationale ("a guest is looking at /design
  itself") was no longer accurate, so it now states the trade and names
  counting guests as a follow-up option.
- **R6 W1 reversal cost, accepted.** Both cart CTAs → `/studio`. A visitor
  with no session at all who opens an empty `/cart` and taps "Start a
  design" lands on sign-in (R2). Any cart with lines implies a session.
- **R7 copy.** "Sign up to keep these designs." (the issue's wording, persona
  C: sentence case, full stop). The whole line is the link, 44px tap target
  on phones. Target `/sign-up`, which already lands on `/studio` after
  success; sign-in re-parents too, reachable from the header and the sign-up
  page.

## Audit: actions reachable from the bench, library and image detail page

| Action | Gate before | Guest (funnel on) after |
|---|---|---|
| `getStudioLanes` (poll) | refused anon | allowed, user-scoped read |
| `deleteConversations` (bench bulk) | refused anon | allowed, owner-filtered |
| `deleteImages` (library bulk) | refused anon | allowed, per-image owner check |
| `generateDesign`, `closeConversation`, `cancelGeneration`, `deleteDesign` | session + owner | unchanged |
| `openConversation`, `setPrimaryImage`, `getConversationImages` (image detail page) | session + owner | unchanged |
| `publishImage` | refuses anon (#214) | unchanged; page shows "Sign in to publish" |
| Lightbox "Edit this one" / "Open" | client / link | work (owner may view own private image) |

The three changed actions use `requireStudioActionSession`, so they follow
the flag exactly like the pages. The single-lane actions are shared with
`/design` and already accepted any session; with the flag off they are not
reachable from the Studio anyway.

## Task reviews

- **Task 1 (gate).** Clean. Checked: TS narrowing through `redirect()`
  (never), flag read at call time via `guestFunnelEnabled()`, `isAnonymous`
  null/absent treated as real (matches `isAnonymousUser`). 14 unit tests.
- **Task 2 (pages + actions).** Clean. Mutation check: forcing
  `canUseStudio` to refuse guests fails exactly the 3 new guest-admitted
  action tests. Removed now-unused `auth`/`headers`/`isAnonymousUser`
  imports from `studio/actions.ts`.
- **Task 3 (line).** One finding, fixed: the library page docblock said "a
  plain server component… no client state to hydrate", stale since #195/#238
  gave `LibraryGrid` select mode and a filter. Rewritten. Mutation check:
  rendering the line unconditionally fails the 2 "no line for a real
  account" tests. Test harness note: the library page pulls
  `designs/actions` → better-auth → `@opentelemetry/api` (not installed), so
  the grid is stubbed in the page test, as the bench client is.
- **Task 4 (W1, comments, e2e).** Findings, fixed in-task: `cart-page.test.tsx`
  also pinned the old `/design` hrefs (a second pin besides
  `maker-cta-hrefs`); middleware comment first claimed `/admin` uses
  `requireRealUser` — it checks `ADMIN_EMAIL`; `design-system.md`'s
  `/orders` item still described the header New Design button removed in
  #232, rewritten while removing its W1 citation.

## Whole-branch review

Read `git diff origin/main...HEAD` plus the Studio client, library grid,
image detail page and its owner actions, cart actions, header, nav,
funnel-routes, error boundary, and the design docs. Findings:

1. Fixed (`ae236f9`): the cart "Add another design" comment claimed it
   "always reaches the bench"; true only while the guest funnel is on.
2. No change: `src/app/error.tsx` says `/studio` is behind sign-in for a
   signed-out reader — still true (no session → sign-in).
3. No change, out of scope: `src/lib/nav.ts` line 18 still describes the
   signed-in `/`→`/studio` redirect that #220 removed. Pre-existing, not
   #241's.
4. No change, noted: a guest owner on the image detail page sees "Sign in to
   publish" rather than a sign-up prompt. Publish stays gated (#214); the
   wording is outside #241.

## Local e2e

`e2e/guest-funnel.spec.ts` run locally against a compiled build (`next
start -p 3100`, GUEST_FUNNEL_ENABLED on) and a migrated file-backed libSQL.
The sandbox ships chromium 1194 while the repo's Playwright wants 1223, so
the run used a throwaway config pointing `executablePath` at the installed
build (not committed). The new test passed on both projects several times.
Every failure seen (on the new test and the existing "a guest on /design
gets an anonymous session") was the anonymous session never minting, with
`SQLITE_BUSY: database is locked` in the server log on `/sign-in` and
`/design` — file-DB write contention in the local harness. CI runs e2e on a
Turso branch over HTTP, where that lock does not exist.

## Fix round (after an independent whole-branch review from the main session)

The review found no Critical issues and confirmed the security audit. Three
fixes, all taken:

1. **Important: empty cart walled a first-time visitor.** `/`, `/shop` and
   `/cart` mint no session; Cart is always in the header bar. A visitor with
   no session who opened an empty cart and tapped "Start a design" hit
   middleware's sessionless `/studio` redirect to sign-in. **Controller
   ruling: W1 survives for the empty cart only.** The empty-state CTA is back
   on `/design` (open to them, mints the guest session); "Add another design"
   stays on `/studio` (a cart with lines implies a session). This replaces
   R6 above. Pins: `maker-cta-hrefs` and `cart-page` tests, a new
   `src/__tests__/middleware.test.ts` (sessionless `/design` passes,
   `/studio`, `/studio/library` and `/orders` go to sign-in, a session cookie
   passes `/studio`, flag off gates `/design`), and a new
   `get-cart-sessionless.test.ts` (no session → empty cart, no DB read).
   Mutation-checked: pointing the CTA at `/studio` fails both href pins.
2. **Important: a returning account holder read as a guest.** A session that
   expired, then a new start from the homepage composer, makes an account
   holder a guest; sign-up refuses their email, and on phones the header's
   Sign in is inside the menu. The line is now "Sign up to keep these
   designs. Have an account? Sign in." — two underlined links, `/sign-up`
   and `/sign-in`, each 44px on phones. Signing in from the same window
   re-parents via `onLinkAccount`; sign-in's default destination is
   `/studio`. Replaces R7's copy. Test ids: `guest-keep-line` is now the
   whole line, `guest-sign-up` / `guest-sign-in` the links (e2e updated).
3. **Minor: line beside an empty state.** Hidden when the view is empty:
   library when `images.length === 0`; bench when no lane is rendered. The
   bench line moved from the page into `StudioClient` (new `isGuest` prop)
   and keys off `renderedLanes`, optimistic lanes included, so a guest who
   starts a first conversation on the bench sees it as soon as the lane
   appears instead of after a reload. Known effect: that first appearance
   pushes the composer down by one line. Mutation-checked: always showing
   it fails the empty-bench and empty-library tests; keying off server
   `lanes` fails the "first lane" test.

Left as-is at the main session's direction (noted in the PR body): cart
CTAs ignore the flag when it is off; "Sign in to publish" wording on the
image detail page and lightbox; sign-up ignores `next`; the running-jobs
header badge does not count guests.

## Second fix round (re-review from the main session)

Re-review of `75637e6..81e095e` confirmed the three fixes and found no
hydration mismatch. One new Minor, taken:

- **The bench line moved the composer.** On a ~375px phone the line wraps to
  two 44px rows (~104px). Rendered above the composer, it appeared when a
  guest pressed Generate on an empty bench and shoved the composer down under
  their thumb; bulk-deleting their last lane did the reverse. **Ruling:** on
  the bench the line renders BELOW the composer panel, between it and the
  lanes, so its coming and going never moves the composer. It sits with the
  composer as the bench's top chrome, so select mode (which hides the
  composer) hides it too; it returns on Done. `GuestKeepLine` now renders
  just the line and takes a `className`; each caller places it.
- **Library unchanged in placement** (under the tab strip, now in its own
  gutter container in the page). The same jump does not apply: the library
  has no composer, and the line only changes on a full page render (the
  server decides from `images.length`); a bulk delete of the last image
  re-renders the page into its empty state, with the thumb on the fixed
  select bar, not on content below the line.
- Tests: placement pinned in `studio-client.test.tsx` (composer panel →
  line → first lane, line not inside the panel; the first-lane case asserts
  the line lands after the panel; select mode hides and Done restores).
  Mutation-checked: moving the line back above the composer fails all three.

## Gate after the second fix round

- `npm run lint`: 0 errors (22 pre-existing warnings).
- `npm run typecheck`: clean.
- `npx vitest run`: 176 files, 1849 tests, all pass (+2 over the first fix
  round).
- `npm run build` with the CI dummy env: exit 0.
- `npm run db:generate`: "No schema changes, nothing to migrate".

## Gate after the fix round (head `8ba0a52` + this ledger update)

- `npm run lint`: 0 errors (22 pre-existing warnings).
- `npm run typecheck`: clean.
- `npx vitest run`: 176 files, 1847 tests, all pass (+14 over the first
  round).
- `npm run build` with the CI dummy env: exit 0.
- `npm run db:generate`: "No schema changes, nothing to migrate".

## Gate, first round (head `ae236f9` + this ledger)

- `npm run lint`: 0 errors (22 warnings, all pre-existing, none in new code).
- `npm run typecheck`: clean.
- `npx vitest run`: 174 files, 1833 tests, all pass (main was 1812; +21).
- `npm run build` with the CI dummy env: exit 0.
- `npm run db:generate`: "No schema changes, nothing to migrate". No
  migration in this slice.
