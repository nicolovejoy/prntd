# Ledger — `middleware.ts` → `proxy.ts` (batch 2, slice P)

Branch `claude/proxy-rename`, from `claude/deps-security` at `d6669ce` (next
16.3.6). Plan: `docs/superpowers/plans/2026-09-26-proxy-rename.md`.
Implementers and task reviewers ran as `claude -p --model sonnet`, scoped
re-reviews as `haiku`, the whole-branch review as `opus`.

## Guide read (next 16.3.6, installed)

`01-app/01-getting-started/16-proxy.md`,
`01-app/03-api-reference/03-file-conventions/proxy.md`,
`01-app/02-guides/upgrading/version-16.md` §"`middleware` to `proxy`".
Required: rename the file, rename the named export to `proxy`, keep `config`
(matcher must stay a static constant), rename any `*Middleware*` config flag
(`next.config.ts` sets none). Proxy always runs on Node.js; `runtime` cannot
be set (setting it throws).

## Rulings

1. **Edge → Node.js runtime.** `src/middleware.ts` set no `runtime`, so it ran
   on the Edge default; `src/proxy.ts` runs on Node (build manifest:
   `.next/server/functions-config-manifest.json` → `/_middleware`
   `"runtime": "nodejs"`, same eight matcher sources). The file reads only
   cookies, `nextUrl` and `process.env.GUEST_FUNNEL_ENABLED`, all available on
   Node, so no code change. Platform effect (whole-branch review): on Vercel
   the proxy becomes a function in `pdx1` (`vercel.json` regions) instead of
   running at the Edge, so matched requests (including RSC fetches and
   server-action POSTs on `/studio`, `/design`, `/preview`) bill as function
   invocations rather than Edge Middleware. Not a behaviour change; the guide
   leaves no option (keeping Edge means keeping the deprecated `middleware`).
2. **Test helper name.** The proxy docs call the matcher helper
   `unstable_doesProxyMatch`; 16.3.6 exports only
   `unstable_doesMiddlewareMatch` (`next/experimental/testing/server`). Used
   the exported name with a comment. It builds matchers with the same
   functions as the build (verified by the task and whole-branch reviewers).
   Recheck the name on the next Next bump.
3. **Scope of text updates.** Current-description comments and
   `docs/design-system.md` updated. Left as historical records:
   `docs/session-log.md`, dated plans/ledgers under `docs/superpowers/`,
   `docs/guest-funnel-and-cart-plan.md`, `docs/maker-landing-plan.md`,
   `docs/organizer-pivot-plan.md`. `CLAUDE.md` lines 99 and 190 still name
   `src/middleware.ts` / list the rename as deferred: the main session's to
   update.

## T1 — rename file, export, test

Implementer (sonnet) created `src/proxy.ts` (only change: export name) and
`src/__tests__/proxy.test.ts` (import `{ proxy, config }`, describe labels,
docblock wording, new matcher block: 11 runs-on, 7 skips). Controller did the
`git rm` / `git add` so git records renames. Reviewer (sonnet): APPROVED.
Minor 1 (skip list on one long line) → folded into T2. Minor 2 (helper name
may change on a future bump) → ruling 2. Commit `cf35973`.

## T2 — comments and docs

Implementer (sonnet) reworded 8 files + the skip-list formatting. Reviewer
(sonnet): CHANGES REQUESTED.
- Important: `src/lib/ensure-guest-session.ts:12-13` read "off the / the
  proxy" (doubled "the"). Fixed (sonnet); haiku re-review RESOLVED.
- Important: the skip-list reformat is a code-shaped change outside T2's
  "comment-only" scope. Rejected: the controller asked for it explicitly from
  T1's review Minor 1; formatting only, test unchanged in substance.
Commit `718188f`.

## Whole-branch review (opus) over `d6669ce...HEAD`

APPROVED; no Critical, no Important. Confirmed: guide followed exactly;
`proxy.ts` picked up, no deprecation warning, route summary shows
`ƒ Proxy (Middleware)`; behaviour identical; matcher tests catch a catch-all,
adding `/api/:path*` or `/cart`, dropping `/studio/:path*` or `/preview`,
narrowing `/design/:path*`.
- Minor 1: narrowing `/orders/:path*` → `/orders` or `/preview/:path*` →
  `/preview` went uncaught. Fixed (sonnet): added `/orders/x`, `/preview/x`;
  mutation-checked (`/orders` narrowing fails `runs on /orders/x`); haiku
  re-review RESOLVED. Commit `1c1236a`.
- Minor 2: ledger missing → this file.
- Minor 3: nothing automated exercises the Node proxy on a Vercel deployment;
  put the runtime change in the PR body and make the prod smoke a sessionless
  `/studio` → `/sign-in` check (see ruling 1).

## Gate (controller, final tree)

- `npm run lint`: 0 errors, 34 warnings (pre-existing, none in changed files).
- `npm run typecheck`: clean.
- `npx vitest run`: 187 files, 2064 tests passed (proxy test 6 → 25 cases).
- `npm run build` (CI dummy env): passed at `718188f`; no middleware
  deprecation warning; `ƒ Proxy (Middleware)`; manifest runtime `nodejs`.
  `1c1236a` changes only the test file (typecheck covers it).
- `npm run db:generate`: "No schema changes, nothing to migrate".
- e2e: not run locally (batch rule); CI covers it. Most exposed specs:
  `e2e/guest-funnel.spec.ts` (sessionless redirect), `e2e/cart.spec.ts`,
  `e2e/landing.spec.ts`, and any signed-in spec that loads `/studio`.
