# My Designs as a top-level destination — progress ledger (2026-09-27)

Branch `claude/my-designs-nav` from `origin/main` `f2792a5`. Plan:
`docs/superpowers/plans/2026-09-27-my-designs-nav.md`. Migration-free.
Implementers and task reviewers were `claude -p` subprocesses (sonnet),
scoped re-reviews haiku, whole-branch review opus.

## Commits

- `8768189` plan
- `93f14c8` Task 1 — `/designs` is the My Designs page; `/studio/library`
  and `/studio/archive` 308 to `/designs` carrying the query string
  (`src/lib/redirect-path.ts` `pathWithSearch`); links, `revalidatePath`,
  `?from=` markers, breadcrumbs, guest-line `next`, e2e URLs
- `6d87488` Task 1 comment corrections (controller's own review)
- `222fe1f` Task 2 — header Studio · My Designs · Shop · Cart · menu at every
  width, current-section state, phone running-jobs dot; Studio tab strip
  deleted
- `a80d261` Task 2 review fixes
- `21d3c19`, `20a53f1` Task 3 — docs/design-system.md and comment sweep;
  e2e step for the old-address redirect
- `3106c5b`, `bf56178` phone dot position, from a real 360px render
- `39f2915` whole-branch review fixes

## Rulings and judgment calls

1. **Phone header fits by tightening the gap, not the type.** Bar gap is
   `gap-2` below `sm:` (`sm:gap-4` above), labels stay `text-sm` (Paper's
   scale has no step between `text-xs` and `text-sm`, and a smaller nav label
   on phones goes against the phone-first rule). Measured in a production
   build with Playwright at 360×740: document `scrollWidth` 360 (no
   horizontal scroll), every bar item 44px tall, wordmark-to-Studio gap
   12.6px with a worst-case "Cart (12)". The account button's existing
   `-mr-2` still reaches 8px into the right gutter (pre-existing).
2. **Running-jobs badge on phones is a dot on the Studio link.** The
   "N generating" pill (~80px) cannot fit beside four items and the wordmark
   at 360px. From `sm:` up the pill is unchanged; below `sm:` a 6px ink dot
   sits on the corner of the "Studio" label (absolute, no layout width) with
   sr-only ", N generating" in the link. Ink, not rose (Paper "One Mark").
3. **Current section = path prefix with a `/` boundary** (`isCurrentSection`
   in `src/lib/nav.ts`): `/studio/*` lights Studio, `/designs` My Designs,
   `/shop` Shop, `/cart` Cart. `/design` and `/preview` do not light Studio,
   and `/d/...?from=/designs` does not light My Designs. The old header had
   no current state at all; widening it is a separate call.
4. **My Designs masthead is the mono label `/orders` and `/shop` use**, not
   the Studio's bold `<h1>`: it sits with its Shelf peer (`/orders`). The
   Studio heading is unchanged.
5. **Empty state button "Go to Bench" → "Go to Studio"**: "Bench" no longer
   names anything a user sees.
6. **Feedback launcher stays hidden on `/designs`** (added to
   `FUNNEL_PREFIXES`): it was hidden on `/studio/library` via the `/studio`
   prefix, so this keeps today's behaviour. My Designs has no fixed bottom
   chrome; this is continuity, not need.
7. **Middleware: comment edits plus one behaviour change.** The access lists
   and matcher are unchanged (`/designs` was already in both). The
   whole-branch review found that a signed-out visitor tapping the new
   My Designs link would land in the Studio after sign-in (middleware sent
   plain `/sign-in`, whose `safeNextPath` fallback is `/studio`). The sign-in
   redirect now carries `?next=<path+search>`; sign-in validates it with
   `safeNextPath` and passes it to sign-up. This applies to every protected
   route (`/studio`, `/orders`, `/admin`, and the funnel when the guest flag
   is off). Next strips its internal `_rsc` param before middleware sees the
   URL, so it never leaks into `next`. Another branch renames this file to
   `src/proxy.ts`; the edit is four lines inside the function body.
8. **One token in `src/app/studio/studio-client.tsx`** (owned by the #245
   branch): the bench `<main>` gets `pt-6` in select mode. With the tab strip
   gone, select mode (which unmounts the composer and its `py-6` wrapper) put
   the first lane's border directly under the "Studio" heading. Outside
   select mode the gap under the heading is the composer's 24px, the same 24px
   it had under the strip. `src/lib/studio-view.ts` untouched.
9. **Old URLs**: page-level `permanentRedirect` (the codebase's pattern for
   `/prints`), not `next.config` redirects. Verified against `next start`:
   `/studio/library?from=x&tag=a&tag=b` → 308 `location:
   /designs?from=x&tag=a&tag=b`. Sessionless `/studio/library` is caught by
   middleware first (→ `/sign-in?next=…`), as before.
10. **Internal names kept**: `LibraryGrid`, `library-view.ts`, `library-*`
    test ids. No user sees them; renaming churns e2e for nothing.
11. **Historical docs left alone**: plans and ledgers under
    `docs/superpowers/`. `docs/ux-design-review-2026-09.md` got a dated
    revision note instead of a rewrite. CLAUDE.md (route table, redirect
    list) is the main session's and is stale on this branch.

## Review findings

Task 1 (sonnet reviewer): none. Controller found two false comments
(`funnel-routes.ts` claimed My Designs had a fixed select bar;
`designs/page.tsx` cited the wrong PR) — fixed in `6d87488`, haiku clean.

Task 2 (sonnet reviewer):
1. Important — the phone dot was positioned against the 44px link box, so it
   floated ~15px above the word. Fixed: anchored to a `relative` span around
   the label; test pins the wrapper.
2. Minor — double space in class strings. Fixed.
3. Minor — questioned the gap-2 width budget (counted five gaps; the bar has
   four inside the flex row). Settled by the real render (ruling 1).
Controller additions: badge comment cited measurements that weren't in the
file; Cart's current check didn't use `isCurrentSection`; `orders-list.tsx`
comment was vague. All fixed in `a80d261`; haiku clean.

Task 3: controller found four false statements in the sweep (pill placement,
/orders filter compared to a different pattern, guest line gated wrongly,
"nav model A" credited with the 2026-09-27 change). Fixed; haiku clean.

Whole-branch review (opus), all fixed in `39f2915`, haiku clean:
1. Important — sign-in lost the destination (ruling 7).
2. Minor — select-mode gap under the Studio heading (ruling 8).
3. Minor — funnel-routes test comment repeated the false fixed-bar claim.
4. Minor — "Bench tab" wording in funnel-routes.
5. Minor — `docs/ux-design-review-2026-09.md` contradicted the shipped nav.
6. Minor — design-system guest-line paragraph read as My Designs only.
7. Minor — pre-existing comments about "/designs cards" warming the thread
   cache (`design-thread-cache.ts`, `design-client.tsx`, `design-images.ts`)
   read as current now that `/designs` is live again.
Checked clean by the opus pass: access parity, redirects and query strings,
`?from=` markers and breadcrumbs, `next` targets, every revalidate/push/
assign target, emails/OG/metadata, hydration of the header, `sm:` widths,
e2e reliance on the hamburger (only `store-compose` opens it, for Sign out).

## Gate (controller-run, 2026-09-27)

- `npm run lint`: 0 errors (22 pre-existing warnings)
- `npm run typecheck`: clean
- `npx vitest run`: 192 files, 2119 tests passed
- `npm run build` with CI dummy env: success
- `npm run db:generate`: "No schema changes, nothing to migrate"
- `next start` checks: redirects above; 360px header measurement (ruling 1)

## Not run

- e2e (CI only). Most at risk: `e2e/guest-funnel.spec.ts` (URLs, new
  redirect step, sessionless redirect now has `?next=`; its `/sign-in/`
  regexes still match), `e2e/store-compose.spec.ts` (opens the account
  menu), `e2e/landing.spec.ts` (header).
- The `/studio` page itself was not rendered (needs a session); its spacing
  was checked by reading the markup.

## Fix round (2026-09-27, second pass)

Merged `origin/claude/proxy-rename` (PR #255, itself stacked on the Next
16.3.6 / better-auth 1.6 dependency bump) into this branch first, then four
commits addressing review feedback. No e2e, no db commands, no build run in
this pass (not requested; `db:generate` explicitly out of scope).

### Merge: `origin/claude/proxy-rename`

`git merge` (not rebase), commit `a9eaae0`. Git's rename detection matched
`src/middleware.ts` → `src/proxy.ts` at the same path on both sides and
merged its two independent hunks (proxy-rename's function rename plus this
branch's `?next=` addition and "/designs" wording) automatically — no
conflict there. Manual resolution needed only in
`src/__tests__/middleware.test.ts` → `src/__tests__/proxy.test.ts`: combined
proxy-rename's `proxy(...)`-calling style, the `__Secure-` cookie case, and
the matcher-table tests with this branch's `/designs`-inclusive assertions
and the two new `?next=` cases, all rewritten to call `proxy(...)`. Checked
every other file the merge touched (`site-header.tsx`, `require-user.ts`,
`docs/design-system.md`) — all comment-only diffs on the proxy-rename side,
already carried correctly by the auto-merge. Fixed one stale comment the
merge didn't touch: `src/app/designs/page.tsx`'s docblock still said
"middleware sends them" — now "the proxy sends them". `node_modules` replaced
with a copy-on-write clone of the proxy-rename worktree's install (matching
next 16.3.6 / better-auth 1.6.33 in the merged `package.json`), not
`npm install`. Full suite green post-merge: 193 files, 2144 tests.

### 1. Header gap below 359px (`e0ca053`)

Reusing the ledger's own width model (base fixed-item width, independent of
gap, backed out from its stated "gap-4 needs 349px / gap-3 333px / gap-2
317px" progression): the five bar items need ~285px with zero gap. A 360px
phone has 328px inside the gutters (gap-2 fits, ~11px spare, matches ruling
1); 344px has only 312px (gap-2 overflows by exactly the ~5px the task
named); 320px has 288px (gap-2 overflows by exactly ~29px). Working the same
model backwards, only a full collapse to zero gap fits 320px (288 - 285 =
3px spare) — anything between gap-1.5 and gap-1 still overflows by double
digits. Added `max-[359px]:gap-0` to the bar's item-group div, alongside the
existing `gap-2 sm:gap-4`. Verified the cascade order isn't a Tailwind v4
sorting gamble by compiling the actual stylesheet with the project's own
`@tailwindcss/postcss` plugin against a throwaway probe file: the compiled
`.max-\[359px\]\:gap-0` rule (wrapped in `@media (width < 359px)`) is emitted
*after* the base `.gap-2` rule and *before* `.sm\:gap-4`, so it overrides
gap-2 only inside its own media query and never fights `sm:`'s wider range —
confirmed via `postcss([tw()]).process(...)` rather than trusting the
class-order-implies-cascade-order assumption. Test:
`site-header.test.tsx`'s new case renders with a two-digit cart count and
asserts the group div carries `gap-2`, `max-[359px]:gap-0`, and `sm:gap-4`
as class tokens (jsdom resolves no layout, so this is the class-presence
style the file's own 44px tests already use, not a measured width) and that
Cart's `min-h-11` class is untouched.

### 2. No prefetch for Studio/My Designs when signed out (`8bea912`)

`NO_SESSION_PREFETCH_OFF` (`/studio`, `/designs`) gates `prefetch={false}` on
those two `Link`s only while `!session`; `undefined` (Link's own default)
otherwise, covering both real and guest-funnel sessions — matching exactly
what the proxy's cookie check admits, not `isAuthed` (which excludes
guests). Shop is never gated. New dedicated test file
`site-header-prefetch.test.tsx`: `next/link` doesn't forward its `prefetch`
prop to the rendered `<a>`, so observing it needs a mock, and mocking
`next/link` file-wide would break `site-header.test.tsx`'s and
`site-header-hydration.test.tsx`'s reliance on the real `Link` — kept
isolated in its own file instead. Also mocks `useHydrated` to `true`
unconditionally so the four cases (no session / real user / guest / Shop
unaffected) don't have to fight the hydration-gate timing this component
otherwise imposes on `session`.

### 3. `requireRealUser`/`requireStudioUser` carry `?next=` (`cf10c35`)

Both now take a required `currentPath: string` parameter and redirect via
`withNext("/sign-in", currentPath)` (`src/lib/safe-next.ts`) instead of a
bare `/sign-in`. Went with an explicit parameter over reading `headers()`
inside the helper: every call site today (`/orders`, `/studio`, `/designs`)
is a static route that reads no `searchParams` of its own, so there is
nothing dynamic to preserve, and a literal string argument is trivially
testable without mocking a headers-derived pathname. Updated the three
callers and `require-user.test.ts` (every `requireRealUser()` /
`requireStudioUser()` call now passes a path; assertions check the encoded
`?next=` on the thrown redirect URL; added a second `requireStudioUser`
redirect case with a different path to prove the parameter, not a hardcoded
string, drives the value). The three existing mocks of `requireStudioUser`
in `guest-keep-line.test.tsx`, `studio-hydration.test.tsx`, and
`designs/__tests__/page.test.tsx` are zero-arg `vi.fn()`s and needed no
change — they don't care what they're called with.

### 4. `funnel-routes.test.ts` boundary case (`6711a4d`)

Added `isFunnelRoute("/designer")` → `false` as the replacement boundary
case: "/designer" shares the "/design" prefix as a substring but not the
"/design" or "/design/…" boundary `isFunnelRoute` requires, and isn't
swallowed by the separately-listed "/designs" prefix either (matching the
existing `/dashboard`-vs-`/d` and `/checkouts`-vs-`/checkout` cases already
in that same describe block). Fixed the stale "library and archive never had
any [fixed bottom chrome]" comment on the `/studio/library` assertion —
`/studio/library` is now only a 308 to `/designs`, not a real view with
chrome of its own; reworded to say that instead of describing a view that no
longer exists.

### Gate (this pass)

- `npx vitest run`: 194 files, 2150 tests passed
- `npm run typecheck`: clean
- `npm run lint`: 0 errors, 33 pre-existing warnings (none in a file this
  pass touched beyond the one `site-header.tsx` already had — the
  `window.location.href` sign-out warning predates this branch)
- No `npm run build`, no `db:generate`, no e2e run in this pass (out of
  scope per the fix-round instructions)
