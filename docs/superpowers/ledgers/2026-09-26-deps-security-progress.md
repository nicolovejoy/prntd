# Ledger: dependency security bump (batch 2, slice D2)

Plan: `docs/superpowers/plans/2026-09-26-deps-security.md`. Branch
`claude/deps-security` from main `9901586`. Controller: Opus. Reviewers ran as
`claude -p` subprocesses (T3/T4 `sonnet`, whole-branch `opus`).

## Versions

- `next` 16.2.1 → 16.3.6, `eslint-config-next` 16.2.1 → 16.3.6 (exact pins
  kept). `react`/`react-dom` stay 19.2.4: next 16.3.6's peer range is
  `^18.2.0 || ^19.0.0`, so nothing forced a move. `@types/react*` untouched.
- `better-auth` 1.5.6 → 1.6.33 (`package.json` `^1.5.6` → `~1.6.33`), all
  `@better-auth/*` packages 1.6.33 in lockstep.
- `drizzle-orm` 0.45.1 → 0.45.3 (`package.json` `^0.45.1` → `^0.45.2`).
- `drizzle-kit` stays 0.31.x (0.31.11), `vitest` stays 3.2.4, `resend` stays
  6.10.0, `@anthropic-ai/sdk` stays 0.80.0.
- `npm audit`: 30 (3 critical, 13 high, 13 moderate, 1 low) → 10 (1 critical,
  9 moderate). Every high is gone.
- Transitive majors and removals (found by the T6 review; all expected, none
  a surprise):
  - `vite` 6.4.1 → 7.3.6 (dev-only, via vitest's `^5 || ^6 || ^7` range;
    `audit fix` took the newest in range for the vite ≤ 6.4.2 high advisory,
    though 6.4.3 would also have fixed it). Vite 7 needs Node
    `^20.19.0 || >=22.12.0`; local is 20.19.2, CI 22. Vercel builds never load
    vite. Left as is: tests are green.
  - `sharp` 0.34.5 → 0.35.4 + the `@img/*` packages (next 16.3.6 declares
    `sharp ^0.35.4`; fixes a high advisory).
  - `rou3` 0.7 → 0.9, `@better-auth/utils` 0.3.1 → 0.4.2 (plus 0.5.0 nested
    under `better-call`), both from better-auth 1.6.
  - Removed: `fast-xml-parser`, `strnum`, `fast-xml-builder`,
    `path-expression-matcher` (the `@aws-sdk/xml-builder` patch dropped them)
    and next's nested `postcss@8.4.31` (next now pins 8.5.23).
  - Two `@better-fetch/fetch` copies: `@better-auth/core`/`telemetry` 1.6.33
    declare an exact `1.3.1` peer while `better-call` hoists 1.3.2, so
    `npm ls @better-fetch/fetch` reports `invalid` (ELSPROBLEMS). `.npmrc` has
    `legacy-peer-deps=true`, so install and `npm ci` accept it. better-auth's
    client code resolves its nested 1.3.1; core uses the hoisted 1.3.2 only in
    social-provider modules we don't load. No `overrides` added.
- One copy each of react, react-dom, next, better-call (1.4.0), zod (4.6.5),
  kysely (0.28.17), drizzle-orm (0.45.3). Every new lockfile entry resolves to
  registry.npmjs.org with an `integrity` hash (T6 checked).

## Rulings

1. **better-auth pinned to the 1.6 line, not 1.7.** `npm audit fix` alone
   resolved `^1.5.6` to 1.7.6 (released 2026-09-24; 1.7.0 on 2026-08-18
   needed a hotfix a day later). The slice brief scopes the move to 1.6.x, and
   1.6.33 (2026-09-14, same day as 1.7.5) is the maintained 1.6 release and is
   past every fixed version `npm audit` names (≥ 1.6.22). Pinned with
   `npm install better-auth@1.6.33` and then the range set to `~1.6.33` (T6
   finding 6: `^1.6.33` would let `npm update` or a lockfile regeneration
   take 1.7.6). Moving to 1.7 is its own slice with its own changelog review.
2. **drizzle-orm range floor raised to `^0.45.2`.** `audit fix` moved the
   lockfile to 0.45.3 but left the declared range at `^0.45.1`, which still
   admits the vulnerable 0.45.1. better-auth 1.6 also declares
   `drizzle-orm ^0.45.2` as a peer. Two-character change; recorded because it
   is a `package.json` edit `audit fix` did not make itself.
3. **No exact pin moved by hand beyond next/eslint-config-next.** `vitest`
   (3.2.4) and `resend` (6.10.0) are exact pins whose fixes (3.2.7, 6.30.0)
   are outside the pinned version, so `audit fix` without `--force` leaves
   them. Out of scope for this slice; see "Remaining advisories" for the
   follow-up.
4. **The new `@next/next/no-location-assign-relative-destination` lint rule
   stays a warning, and none of its 12 hits are changed.** eslint-config-next
   16.3 adds it at `warn`; lint is still 0 errors (34 warnings: 12 from this
   rule, 22 pre-existing). Every hit is a deliberate hard navigation: the
   sign-up hard-nav fix (`cb4d745`, the sign-in hang — the rule's
   suggested `router.push` is exactly what hung), `signOut`, Stripe checkout
   redirects, and conversation/start-from-image handoffs. Rewriting them is
   application behaviour, not a dependency bump. The T3 reviewer reported "no
   new rule fired"; that was wrong (it counted the warnings without reading
   their rules); the controller's `eslint -f json` rule tally is the record.
   The 12 hits: sign-up page (the sign-in page assigns a variable, which the
   rule does not flag), cart, buy-panel ×2, conversation-actions ×2,
   start-from-image, design-client, preview ×2, store-buy-panel, site-header.
5. **The build's new `BETTER_AUTH_SECRET` warnings are expected under the CI
   dummy env.** better-auth 1.6 `validateSecret` logs (never throws) when the
   secret is < 32 chars or estimated entropy < 120 bits
   (`node_modules/better-auth/dist/context/create-context.mjs`). The dummy
   `ci-skip-secret-not-real` trips both. It only throws for the library's
   default secret in production or a missing secret. If prod's secret is short,
   Vercel runtime logs will carry the same two WARN lines on every cold start;
   that is a signal to rotate, not a break.
6. **The `middleware` deprecation warning is not addressed here.** 16.3 prints
   `The "middleware" file convention is deprecated. Please use "proxy"`. The
   rename is slice P, which branches from this branch.

## T1/T2 — bumps (controller)

Commits `b904278` (next + eslint-config-next), `3cab20c` (audit fix +
better-auth pin + drizzle-orm floor). `npm install` ran in this worktree only.

## T3 — Next 16.2.1 → 16.3.6 changelog review (sonnet)

Verdict: no required code changes. Findings that matter:
- 16.3.0 middleware → proxy deprecation warning (cosmetic; slice P).
- 16.3.0 edge runtime deprecated: no `runtime = "edge"` in `src/`.
- 16.3.0 `validateRSCRequestHeaders` on by default (mismatched `_rsc` → 307):
  no CDN in front of Vercel, no `_rsc` handling in our code. Low risk; a
  client-nav check on the preview covers it.
- 16.3.0 prefetch changes (segment prefetch 404 instead of 204, prefetch
  inlining default): router-internal; we use no `cacheComponents`/PPR.
- `next/image`: `remotePatterns` + `qualities: [75]` unchanged; 16.3.3 fixes an
  AVIF optimizer RCE, 16.3.6 an `ImageResponse` (`next/og`) RCE
  (GHSA-vcvr-r3jv-pc5j) — we use both.
- 16.2.5/16.2.6/16.2.11: middleware/proxy bypass via segment-prefetch routes
  and dynamic-param injection, Server Actions DoS, Server Function endpoint
  disclosure — all relevant to how `src/middleware.ts` gates `/studio`,
  `/admin`, `/orders`, and to our server actions. Benefit, no code change.
- `error.tsx`/`global-error.tsx` `unstable_retry ?? reset`, `instrumentation.ts`
  `onRequestError`, route segment config, `after()`, `headers()`/`cookies()`:
  unchanged or fixes only. 16.3.0 makes `onRequestError` also report
  stale-ISR errors, so `app_error` may see a few more rows from the
  `revalidate` OG/Twitter image routes.
- Gap it stated itself: v16.3.0 notes were read in full to line ~120 and
  keyword-grepped after that.

## T4 — better-auth 1.5.6 → 1.6.33 changelog review (sonnet), plus controller checks

Verdict: no required code or schema changes. Findings:
- 1.6.0 `freshAge` counts from `createdAt`: we don't use fresh-session gating.
- 1.6.0 origin check on password-reset requests: `requestPasswordReset` sends
  a relative `redirectTo` from a same-origin client, which passes.
- 1.6.0 password hashing moved to `@better-auth/utils/password` (node:crypto
  scrypt, non-blocking). **Controller verified compatibility both ways** with
  a script (`.superpowers/sdd/deps-security/pw-compat.mjs`, not committed): a
  hash made with 1.5.6's exact algorithm (noble scrypt N=16384 r=16 p=1
  dkLen=64, `salt:key` hex) verifies under 1.6.33 (right password true, wrong
  false), and a 1.6.33 hash verifies under the 1.5.6 algorithm — so existing
  passwords keep working and a rollback would not strand accounts created
  after deploy.
- 1.6.0 `cookieCache`: new `cookieRefreshCache` is off when `refreshCache` is
  unset; our 5-min DB-backed cache behaves as in 1.5.6.
- Schema: `@better-auth/core` table definitions match `src/lib/db/schema.ts`
  for user/session/account/verification; `isAnonymous` present. The only
  1.6.x "Breaking Changes" entry (1.6.2) adds a column to the `twoFactor`
  table, a plugin we don't use. `npm run db:generate` prints "No schema
  changes" (controller ran it).
- Session cookie names unchanged (`better-auth.session_token`,
  `__Secure-better-auth.session_token`), which is what `src/middleware.ts`
  reads. 1.6.14 now prefers the `__Secure-` cookie over a non-secure leftover.
- Anonymous plugin after-hook order unchanged: read the anon session → run
  `onLinkAccount` (our `reparentUserData` batch) → `deleteUser(anon.id)`, and
  the skip when the new user is the same user or is anonymous was already in
  1.5.6 (controller diffed against the 1.5.6 tarball). **One real behaviour
  change (controller finding, T4 mentioned it only in passing):** 1.6.33
  wraps that `deleteUser` in try/catch and logs "Failed to clean up anonymous
  user during post-link cleanup" instead of throwing. Under 1.5.6 a failed
  anon delete failed the sign-in/sign-up request. The #171-era bug
  (`reparentUserData` missed `image_generation`, the anon delete hit the FK,
  guests could not sign up) would under 1.6 let the sign-up succeed and leave
  the un-moved rows plus the anon user row behind, visible only in logs. The
  per-table checklist test (`reparent-user` integration test) is now the only
  loud guard for that class; watch prod logs for that string after deploy.
  1.6.11 also calls `onLinkAccount` when email-verification auto sign-in
  links (we have no verification gate).
- Controller keyword pass over every 1.6.1–1.6.33 release note (T4 read 1.6.0
  in full plus the advisory list). Relevant beyond the above: 1.6.16 email
  sign-in/sign-up validate `Origin`/`Referer` against `trustedOrigins` whenever
  the request carries cookies (a guest converting always does — the anon
  cookie). Browsers send `Origin` on these POSTs, and `trustedOrigins` already
  covers `https://prntd-*.vercel.app`, `https://*.prntd.org` and (with
  `E2E_TRUST_LOCALHOST`) localhost:3000/3001/3100, so prod,
  preview and e2e pass; server-side `auth.api.*` calls have no `request` and
  skip the check. 1.6.17/1.6.18 make `getCookieCache` return null for an
  expired session instead of stale data. 1.6.12 fixes a `session_data` cookie
  leak/replay (2FA bypass; we have no 2FA).

### GHSA-2vg6-77g8-24mp (stale sessions after user deletion)

Low severity (CVSS 3.8), affected < 1.6.11. With `secondaryStorage` configured
and `storeSessionInDatabase` false, four deletion paths (admin `removeUser`,
anonymous self-delete, the anonymous after-link hook, SCIM delete) deleted the
user without deleting sessions, so the session payload in secondary storage
kept authenticating for up to 7 days. The fix (1.6.11, #9162) makes
`internalAdapter.deleteUser` delete sessions first: secondary-storage
sessions, then database sessions when sessions live in the DB.

Our `onLinkAccount` flow: we configure no `secondaryStorage`, so sessions
were always DB rows and the vulnerable path never existed here. Nothing
changes for us: 1.5.6's `deleteUser` already deleted DB sessions, then
accounts, then the user when `secondaryStorage` is unset (verified in the
1.5.6 tarball, `dist/db/internal-adapter.mjs`), which is what lets the anon
delete pass `session.user_id`'s FK (no `ON DELETE CASCADE`). The fix only
makes that ordering hold if secondary storage is ever added. The fix does not change `cookieCache`: a signed `session_data` cookie
for a deleted user is honoured for up to 5 minutes with no DB read, as in
1.5.6. In the guest-claim flow that cookie is overwritten by the new user's
`session_token` + `session_data` in the same response, so it survives only if
copied out of the browser, and its `session_token` then matches no row.

## T5 — forced code changes

No executable code change is forced. One comment-only change, from T6
finding 5 (commit `e4a59d3`): `src/lib/auth.ts` said "better-auth 1.5.6
after-hook order", and `src/lib/reparent-user.ts` + its integration test said
a missed table makes the anon-user delete fail, without saying that 1.6 now
swallows that failure. All three now state the 1.6 behaviour. Same commit
narrows the better-auth range to `~1.6.33` (ruling 1). Process deviation: the
controller made this edit itself rather than through an implementer
subprocess (three comments), then ran a fresh `sonnet` task reviewer on it.

T5 review (`sonnet`, on `e4a59d3`): clean; it quoted the anon plugin's
after-hook (onLinkAccount awaited outside any try; deleteUser in try/catch
with the logged message) and confirmed the comments match. Three Minor
nits: (1) `reparent-user.ts` docblock's historical "(cart, store, product)"
aside — not about better-auth, `store` is being dropped by slice D (#249),
left alone to avoid a conflict there; (2) and (3) the integration test's file
header ("cascaded away") and the comment above its anon delete ("throws
there") had the same 1.5.6 staleness — fixed in `bf2439f`. Haiku scoped
re-review of `bf2439f`: clean.

## T6 — whole-branch review (opus, on `505c926`)

Verdict: clean, no code change required. It re-ran typecheck, lint (same rule
tally), vitest (2044 passed) and audit (10) itself, and independently
re-verified the anon-plugin diff against the 1.5.6 tarball, cookie names,
`validateSecret`, the password hash round trip (Unicode password, both
directions), the origin check, and the release dates. Findings:

1. Important — e2e is the only test of real sign-in/sign-up traffic and has
   not run (CI runs it on PRs only). The 1.6.16 origin check now applies to
   every guest sign-up (the anon cookie is always present), and a failed
   anon-user delete no longer fails the request. **Ruling:** the PR's green
   `e2e` job (guest-funnel, cart, signed-in helper specs) is a merge
   condition, and the prod smoke is a guest→sign-up claim.
2. Minor — two `@better-fetch/fetch` copies, `npm ls` exits 1. Recorded under
   Versions; no override.
3. Minor — `vite` 6 → 7 unrecorded. Recorded under Versions.
4. Minor — other majors/removals unrecorded. Recorded under Versions.
5. Minor — stale comments in `auth.ts` and `reparent-user.ts`. Fixed (T5).
6. Minor — `^1.6.33` doesn't hold the 1.6 line. Changed to `~1.6.33`.
7. Minor — ruling 4 named the sign-in page among the rule's hits; only
   sign-up is flagged. Corrected.

## Gate (controller; first run on `3cab20c`, re-run on `bf2439f` after T5 — same results)

- `npm run lint`: 0 errors, 34 warnings (12 new-rule, see ruling 4).
- `npm run typecheck`: clean.
- `npx vitest run`: 187 files, 2044 tests passed.
- `npm run build` (CI dummy env): passed. New output: the middleware
  deprecation warning and better-auth secret warnings (rulings 5, 6).
- `npm run db:generate`: "No schema changes, nothing to migrate".

## Remaining `npm audit` advisories (10: 1 critical, 9 moderate)

- `vitest` ≤ 4.1.10 (critical) and `@vitest/mocker` (moderate): dev-only test
  runner. GHSA-5xrq-8626-4rwp needs the Vitest UI server listening (we never
  run `--ui`); GHSA-82fw-gwwq-j7x9 is a mock-redirect path traversal when
  running untrusted test code. Fix is vitest 3.2.7, a patch outside the exact
  `3.2.4` pin, so `audit fix` without `--force` leaves it. **Follow-up:** bump
  `vitest` + `@vitest/coverage-v8` to 3.2.7 in a small PR.
- `drizzle-kit` 0.31.11 and its chain `@esbuild-kit/esm-loader`,
  `@esbuild-kit/core-utils`, `esbuild` (4 moderate): dev-only CLI. The esbuild
  advisories are its dev server answering cross-origin requests and a Windows
  file read; drizzle-kit never runs esbuild's serve mode and we're on macOS/
  Linux. The only offered fix is a breaking downgrade to drizzle-kit 0.18.
- `resend` 6.10.0, `svix`, `uuid` (3 moderate): uuid's missing bounds check
  applies only when a caller passes `buf` to v3/v5/v6; `svix` is resend's
  webhook-verification dependency and we use resend only to send email
  (`src/lib/email.ts`), no webhooks. Fix is resend 6.30.0, outside the exact
  pin; a 20-minor jump in the email SDK is its own change. **Follow-up** with
  a preview-email check.
- `@anthropic-ai/sdk` 0.80.0 (1 moderate, two GHSAs): both are the SDK's local
  filesystem Memory Tool helper; `src/` and `scripts/` never use it. Fix is
  0.128.0, a new major (0.x minor), excluded by the slice brief.

## e2e

Not run locally (batch rule). Most at risk, because better-auth 1.6 changes
sign-in/sign-up request handling and next 16.3 changes middleware/router
internals: `guest-funnel`, `cart`, specs using `e2e/helpers/auth.ts`
(`signUpFreshAccount`), `landing`. A green PR `e2e` job is a merge condition
(T6 finding 1).
