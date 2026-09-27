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
