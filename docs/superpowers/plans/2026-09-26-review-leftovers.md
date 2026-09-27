# Review leftovers (batch 2, slice L) — plan

Branch `claude/review-leftovers`, from `origin/main` at `9901586`. Four small,
independent follow-ups left over from the batch-1 reviews. Migration-free. One
commit per task. Ledger: `docs/superpowers/ledgers/2026-09-26-review-leftovers-progress.md`.

Order: task 2 (safe `next` on sign-up) lands before task 3 (publish CTA points
at sign-up with a `next`), because task 3's link is only useful once sign-up
honours `next`. Tasks 1 and 4 are independent of everything.

## Task 1 — Pacific dates on the admin pages

CLAUDE.md "UTC at rest, Pacific on display". Sites found (the brief named the
first two; the third is the same convention on the admin order list and is
included as a judgment call, see the ledger):

- `src/app/admin/errors/page.tsx` (~54): `toLocaleString(undefined, { dateStyle: "short", timeStyle: "medium" })` — a server component, so this prints in the server's zone (UTC on Vercel).
- `src/app/admin/published/page.tsx` (~92): `img.publishedAt.toLocaleDateString()` — server component, UTC.
- `src/app/admin/page.tsx` (~478): `toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })` — client component, prints in the viewer's zone and locale.

Change:

- Add two pure formatters to `src/lib/display-time-zone.ts`, both with an explicit `"en-US"` locale and `timeZone: DISPLAY_TIME_ZONE`:
  - `formatDisplayDate(date: Date | string | number): string` — calendar day, e.g. `9/25/2026`.
  - `formatDisplayDateTime(date: Date | string | number, opts?: { seconds?: boolean }): string` — day + time + short zone name, e.g. `9/25/26, 8:04:05 PM PDT`. The zone name is shown because this is the table an admin matches against Vercel logs (UTC); an unlabelled time invites the wrong conversion. (`timeZoneName` cannot be combined with `dateStyle`/`timeStyle` — `Intl` throws — so use explicit `year/month/day/hour/minute[/second]` fields.)
- Errors page → `formatDisplayDateTime(e.createdAt, { seconds: true })`. Published page → `formatDisplayDate(img.publishedAt)`. Admin order list → `formatDisplayDateTime(order.createdAt)`.
- Do not change `studio-view.ts` or `orders-list.tsx` (already Pacific) and do not touch `generation-quota.ts`'s UTC day key (a storage bucket, not a display).

Acceptance:
- The three sites use the helpers; no bare `toLocale*String()` / `undefined` locale remains in `src/app/admin/**`.
- Unit tests in `src/lib/__tests__/display-time-zone.test.ts`: a timestamp between 00:00 UTC and Pacific midnight (e.g. `2026-09-26T03:00:00Z`) formats as the Pacific day `9/25/2026`; the date-time variant shows the Pacific hour and a `PDT` label; a winter timestamp shows `PST`; `seconds: true` includes seconds and the default does not; string and number inputs are accepted. The tests must fail if the zone option is dropped on ANY machine (Nico's Mac runs Pacific, CI runs UTC): set the process zone to `Asia/Tokyo` in `beforeAll` (assigning `TZ` at runtime takes effect for `Date` and `Intl` in Node; vitest 3's default `forks` pool gives each file its own process) and restore it in `afterAll`, and pick instants whose Tokyo, UTC and Pacific calendar days differ.
- A component-level check that each of the three sites renders through the helper is not required (two are auth-gated server components); the reviewer verifies the call sites by reading them.

## Task 2 — Sign-up honours a safe `next`

Today sign-in validates `?next=` with `next.startsWith("/") && !next.startsWith("//")`, and sign-up ignores `next` entirely (always `/studio`). That check has a hole: browsers treat `\` as `/` in URLs, and the URL parser strips tab/newline, so `/\evil.example` and `/<TAB>/evil.example` pass the check and navigate off-origin when assigned to `window.location.href`.

Change:

- New `src/lib/safe-next.ts`:
  - `safeNextPath(raw: string | null | undefined, fallback = "/studio"): string` — returns a same-origin relative path or `fallback`. Requires `raw` to start with a single `/`; then resolves `new URL(raw, "http://prntd.invalid")` and requires the resolved origin to equal that base's origin; returns `pathname + search + hash` of the resolved URL. Anything that throws, is empty, or resolves off-origin returns `fallback`.
  - `withNext(path: string, next: string | null | undefined): string` — `path` plus `?next=<encodeURIComponent(next)>` when `next` is a safe path (per `safeNextPath` with no fallback match), otherwise `path` unchanged. Used by links that carry `next` along.
- `sign-in/page.tsx`: use `safeNextPath(searchParams.get("next"))` instead of the inline check (tightens the existing guard — judgment call in the ledger). Its "Sign up" link carries the same `next` via `withNext("/sign-up", next)`.
- `sign-up/page.tsx`: wrap the form in `<Suspense>` like sign-in (required for `useSearchParams` in a prerendered page — `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md`), redirect to `safeNextPath(searchParams.get("next"))` with the existing hard navigation, and carry `next` on its "Sign in" link via `withNext`.
- `src/app/studio/guest-keep-line.tsx`: optional `next?: string` prop; both links use `withNext`. The bench passes nothing (its hrefs stay `/sign-up` and `/sign-in`, which already land on `/studio`; `e2e/guest-funnel.spec.ts` asserts those exact hrefs); the library passes `next="/studio/library"` so a guest who signs up from the library returns there. Update the component's docblock ("Both sign-up and sign-in land on /studio afterwards").

Acceptance:
- `src/lib/__tests__/safe-next.test.ts`: accepts `/cart`, `/d/abc?x=1#h`, `/design?id=abc`; rejects and falls back on `null`, `""`, `cart`, `//evil.example`, `/\evil.example`, `/\\evil.example`, `/\t/evil.example`, `/\n/evil.example`, `https://evil.example`, `javascript:alert(1)`, `http:/evil.example`; `withNext` encodes the value and returns the bare path for an unsafe value.
- `src/app/(auth)/__tests__/sign-up-redirect.test.tsx` (new, mirrors the sign-in one): defaults to `/studio`; honours `next=/studio/library`; refuses `//evil.example.com` and `/\evil.example.com` → `/studio`; the "Sign in" link carries `next`.
- `sign-in-redirect.test.tsx` gains a `/\evil.example.com` case and a case that the "Sign up" link carries `next`; its header comment no longer claims sign-up hard-codes `/studio`.
- `guest-keep-line.test.tsx`: no-`next` hrefs unchanged; with `next="/studio/library"` both links carry `?next=%2Fstudio%2Flibrary`; the library page renders the line with that `next`.

## Task 3 — Guests are offered sign-up to publish

A guest (anonymous guest-funnel session) sees "Sign in to publish" on the image detail page (`src/app/d/[imageId]/publish-cta.tsx`) and in the design-thread lightbox (`src/app/design/image-lightbox.tsx`, via `signInHref` from `design-client.tsx`). A guest has no account, so the primary offer is sign-up, with sign-in as the fallback — the same shape as #248's guest line: "Sign up to publish. Have an account? Sign in."

Change:

- New shared component `src/components/guest-publish-prompt.tsx`: `GuestPublishPrompt({ next, className? })` renders one line: link "Sign up to publish." → `withNext("/sign-up", next)`, muted "Have an account?", link "Sign in." → `withNext("/sign-in", next)`. Links underlined, 44px tap targets on phones (`min-h-11 … sm:min-h-0`), `data-testid="guest-publish-sign-up"` / `"guest-publish-sign-in"`, wrapper `data-testid="guest-publish-prompt"`. Plain `<Link>`s — no `<Link><Button>` nesting (a button inside an anchor is invalid HTML). Persona C copy; copy strings exported as constants.
- `PublishCta`: when `!canPublish`, render `<GuestPublishPrompt next={`/d/${imageId}`} />`. Docblock updated.
- `ImageLightbox`: replace the `signInHref?: string` prop with `guestPublishNext?: string` (the path to return to); rendered under the same conditions as today's sign-in button (`!onPublish && guestPublishNext && !isSeed && !image.publishedAt`) as `<GuestPublishPrompt next={guestPublishNext} />`. `hasActions` and the prop's docblock follow.
- `design-client.tsx`: pass `guestPublishNext={canPublish ? undefined : `/design?id=${designId.current}`}` (keep the existing comment's reasoning, reworded).

Acceptance:
- `publish-cta.test.tsx`: `!canPublish` renders no Publish button, the sentence "Sign up to publish. Have an account? Sign in.", a sign-up link to `/sign-up?next=%2Fd%2Fimg-1` and a sign-in link to `/sign-in?next=%2Fd%2Fimg-1`; no "Sign in to publish" text.
- `image-lightbox.test.tsx`: the three existing `signInHref` cases are rewritten for `guestPublishNext` (prompt shown with both hrefs; `onPublish` wins when both given; seed shows neither).
- New `src/components/__tests__/guest-publish-prompt.test.tsx`: sentence text, both hrefs, tap-target classes.
- No remaining "Sign in to publish" string in `src/`.

## Task 4 — The "N generating" badge counts guests

`runningJobsForCurrentUser` in `src/components/site-header-actions.ts` returns 0 for any anonymous user. Since #241 a guest can reach `/studio` (while `GUEST_FUNNEL_ENABLED` is on), which is where the badge links.

Change:

- Replace `if (!user || isAnonymousUser(user)) return 0;` with `if (!user || !canUseStudio(user, guestFunnelEnabled())) return 0;` (`canUseStudio` from `src/lib/require-user.ts`, `guestFunnelEnabled` from `src/lib/flags.ts`) — the badge counts exactly the users who can follow it to `/studio`. A guest's count and sweep are scoped to the anonymous user id, like a real user's.
- Rewrite the function's docblock paragraph about guests (it currently explains why guests are skipped and calls counting them "a real option — deliberately left out of #241's scope"). Check `site-header.tsx`'s comments for the same claim.

Acceptance (in `src/components/__tests__/site-header-actions.test.ts`):
- Anonymous user + `GUEST_FUNNEL_ENABLED=true`: returns the mocked count for the anon user id, schedules the user-scoped sweep via `after()`.
- Anonymous user + flag off: 0, no job-table query, no `after()` scheduled (the existing guest test, now explicit about the flag).
- Signed-out and real-user tests unchanged and passing. Env is restored after each test.

## Whole-branch

After task 4: one Opus review over `git diff origin/main...HEAD` and the files around it. Then the gate: lint, typecheck, `npx vitest run`, `npm run build` with the CI dummy env, `npm run db:generate` → "No schema changes".

E2E most at risk: `e2e/guest-funnel.spec.ts` (guest line hrefs, lightbox), `e2e/helpers/auth.ts` (sign-up page structure / redirect).
