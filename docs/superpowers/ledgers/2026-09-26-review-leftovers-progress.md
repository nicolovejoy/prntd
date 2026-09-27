# Review leftovers (batch 2, slice L) — ledger

Branch `claude/review-leftovers`, from `origin/main` `9901586`. Plan:
`docs/superpowers/plans/2026-09-26-review-leftovers.md`. Migration-free.

Process: Sonnet implementer and a fresh Sonnet task reviewer per task (`claude -p`
subprocesses), Haiku for the scoped re-review, one Opus whole-branch review.
Tasks 1, 2 and 4 ran in parallel in the same worktree (disjoint files); task 3
waited for task 2 because it builds on `withNext`.

## Task 1 — Pacific dates on the admin pages (706cd7d)

- New `formatDisplayDate` / `formatDisplayDateTime` in `src/lib/display-time-zone.ts`
  (en-US, `America/Los_Angeles`; the date-time variant carries the short zone
  name, e.g. `9/25/26, 8:04:05 PM PDT`, so a row can be matched against UTC
  Vercel logs). Explicit fields, because `timeZoneName` cannot be combined with
  `dateStyle`/`timeStyle`.
- Tests pin the process zone to `Asia/Tokyo` in `beforeAll`, so dropping the
  zone option fails on Nico's Mac (Pacific) and in CI (UTC) alike.
- Judgment call: the brief named `/admin/errors` and `/admin/published`. The
  admin order list (`admin/page.tsx`) and order detail (`admin/orders/[id]`,
  found by the implementer) had the same bare `toLocaleString`, so all four
  now use the helpers. Criterion used: no bare `toLocale*String` left in
  `src/app/admin/**`.
- Left alone: `generation-quota.ts`'s UTC day key (a storage bucket, not a
  display).
- Review: CLEAN, no findings.

## Task 2 — Sign-up honours a safe `next` (de0c35f)

- New `src/lib/safe-next.ts`: `safeNextPath(raw, fallback = "/studio")` and
  `withNext(path, next)`. Resolves the value against `http://prntd.invalid`,
  requires an unchanged origin and a resolved path that does not start with
  `//`, and returns the parser's own `pathname + search + hash`.
- **Security judgment call: sign-in's existing guard was tightened too.** Its
  inline check (`startsWith("/") && !startsWith("//")`) let `/\evil.example`
  (browsers read `\` as `/`) and `/<TAB>/evil.example` (the parser strips tab
  and newline) through to `window.location.href`, i.e. an open redirect on
  prod sign-in. The implementer additionally found that dot segments
  (`/.//evil`, `/..//evil`, `/%2e//evil`) resolve to a same-origin path of
  `//evil`, hence the extra `//` check on the resolved path. All cases are in
  `safe-next.test.ts`.
- Sign-up is wrapped in `<Suspense>` (required for `useSearchParams` on a
  prerendered page — Next docs, use-search-params.md). Sign-in and sign-up
  cross-links carry `next`.
- `GuestKeepLine` takes an optional `next`; the library passes
  `/studio/library`; the bench passes nothing, so its hrefs stay `/sign-up` /
  `/sign-in` (both already land on `/studio`) and `e2e/guest-funnel.spec.ts`'s
  bench assertions hold.
- Review: CLEAN. Minor 1 (over-long comment line in sign-in) fixed before
  commit. Minor 2 (the `try/catch` around `new URL` is unreachable for a
  `/`-prefixed input with a valid base) kept as harmless defence.

## Task 3 — Guests offered sign-up to publish (5742398)

- New `src/components/guest-publish-prompt.tsx`: "Sign up to publish. Have an
  account? Sign in." Plain links (the old lightbox nested a `<Button>` in a
  `<Link>`, invalid HTML), 44px phone tap targets, both links via `withNext`.
- `PublishCta` (image detail page) passes `next=/d/{imageId}`; the lightbox's
  `signInHref` prop became `guestPublishNext`, and `design-client.tsx` passes
  `/design?id={id}`. The other `ImageLightbox` callers (Studio,
  conversation-images) never passed the old prop.
- Review: CLEAN. Minor 1 acted on by the controller: `publishImage`'s
  anonymous refusal now throws "Sign up to publish" (was "Sign in to
  publish"), and `publish-gate.integration.test.ts` asserts the new string.
  Minor 2 (no e2e for the publish prompt) left: unit tests cover both hrefs,
  and a guest-publish e2e needs a seeded unpublished image on the image
  detail page — more than this slice's scope.

## Task 4 — Header badge counts guests (bf9d0eb)

- `runningJobsForCurrentUser` gates on `canUseStudio(user, guestFunnelEnabled())`
  instead of `isAnonymousUser`: the badge links to `/studio`, so it counts
  exactly the users who can follow it. Guests' count and sweep are scoped to
  the anonymous user id. Cost: one job-table query per guest page view while
  the funnel is on (accepted by the brief).
- Tests: flag on → counts the anon user and schedules the user-scoped sweep;
  flag off → 0, no query, no `after()`. `vi.unstubAllEnvs()` in `afterEach`.
- Review: CLEAN. Its Minor (CLAUDE.md "Deferred" still lists this) is for the
  main session.

## Whole-branch review (Opus) — CLEAN

Findings and rulings:
1. Minor, `site-header-actions.ts:56-57` "says the same line twice" — checked;
   the paragraph has no duplicated line. Not acted on (false positive).
2. Minor, `CLAUDE.md` "Deferred" still lists "admin pages still print UTC
   days", "'Sign in to publish' wording for guests" and "the running-jobs badge
   doesn't count guests" — all three fixed here. CLAUDE.md belongs to the main
   session; left for it.
3. Minor, `display-time-zone.ts` header should point at the helpers — fixed
   (40b0817).
4. Minor, e2e library guest line links unasserted — `guest-funnel.spec.ts` now
   asserts both `?next=%2Fstudio%2Flibrary` hrefs (40b0817). Haiku re-review:
   CLEAN.

Also noted (not a finding): the review said the two changed server admin
pages are client components; `/admin/errors` and `/admin/published` are server
components. Either way the explicit zone and locale make the output
deterministic.

## Gate (run by the controller, on 40b0817)

- `npm run lint`: 0 errors (22 pre-existing warnings, none in changed files)
- `npm run typecheck`: clean
- `npx vitest run`: 191 files, 2098 tests passed
- `npm run build` with the CI dummy env: success (`/sign-in`, `/sign-up` still static)
- `npm run db:generate`: "No schema changes, nothing to migrate"

## E2E most at risk (not run locally, per brief)

`e2e/guest-funnel.spec.ts` (guest line hrefs incl. the new library `next`
assertion), `e2e/helpers/auth.ts` (sign-up page structure and its `/studio`
landing).
