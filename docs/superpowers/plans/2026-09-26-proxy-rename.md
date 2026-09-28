# `middleware.ts` → `proxy.ts` (batch 2, slice P)

Branch `claude/proxy-rename`, from `claude/deps-security` at `d6669ce` (next
16.3.6). Ledger: `docs/superpowers/ledgers/2026-09-26-proxy-rename-progress.md`.

## Why

Next 16 deprecated the `middleware` file convention in favour of `proxy`.
16.3 prints `The "middleware" file convention is deprecated. Please use
"proxy"` on every build. Guides read (next 16.3.6, installed):
`node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md`,
`.../03-api-reference/03-file-conventions/proxy.md`,
`.../02-guides/upgrading/version-16.md` §"`middleware` to `proxy`".

What the guide requires, and nothing more:

1. Rename the file: `src/middleware.ts` → `src/proxy.ts` (same level as
   `src/app`).
2. Rename the named export `middleware` → `proxy`.
3. `config.matcher` is unchanged (same syntax; must stay a static constant).
4. Runtime: proxy is always Node.js and `runtime` cannot be set (setting it
   throws). Our file sets no runtime today, so it ran on the Edge default;
   after the rename it runs on Node. The file reads only cookies, the URL and
   `process.env.GUEST_FUNNEL_ENABLED`, all available on Node. No code change
   follows from this; it is recorded in the ledger.
5. Config flags with "middleware" in the name are renamed
   (`skipMiddlewareUrlNormalize` → `skipProxyUrlNormalize`). `next.config.ts`
   sets none.

Behaviour must be identical: same `ALWAYS_PROTECTED` / `FUNNEL_ROUTES` lists,
same `GUEST_FUNNEL_ENABLED` branch (#26, #248), same redirect target
(`/sign-in`), same matcher. `/api/health` stays outside the matcher, as do
`/`, `/shop`, `/d/*`, `/cart`, `/sign-in`, `/sign-up`.

Out of scope: CLAUDE.md (main session's), auth pages (slice L), historical
records (`docs/session-log.md`, dated plans and ledgers under
`docs/superpowers/`, and older dated plan docs such as
`docs/guest-funnel-and-cart-plan.md`), which describe what was true when
written.

## Tasks

### T1 — rename the file, the export and its test

- `git mv src/middleware.ts src/proxy.ts`; rename `export function
  middleware` → `export function proxy`. File body otherwise byte-identical
  except for comment wording that names the convention.
- `git mv src/__tests__/middleware.test.ts src/__tests__/proxy.test.ts`;
  import `{ proxy, config } from "@/proxy"`; describe labels say `proxy`.
  Existing cases unchanged in substance.
- Add matcher cases to that test using next's experimental helper
  `unstable_doesMiddlewareMatch` from `next/experimental/testing/server`
  (16.3.6 ships it under this name; the proxy.md doc calls it
  `unstable_doesProxyMatch`, which 16.3.6 does not export). Assert the
  exported `config` matches: `/designs`, `/design`, `/design/x`, `/preview`,
  `/order`, `/order/confirm`, `/orders`, `/admin`, `/admin/errors`,
  `/studio`, `/studio/library`; and does NOT match: `/api/health`, `/`,
  `/shop`, `/d/abc`, `/cart`, `/sign-in`, `/sign-up`.

Acceptance: `npx vitest run src/__tests__/proxy.test.ts` passes; no file in
`src/` imports `@/middleware`; `src/middleware.ts` does not exist; `npm run
typecheck` and `npm run lint` clean.

### T2 — comments and current docs that name middleware

Replace "middleware" with "proxy" (or `src/proxy.ts`) where the text
describes today's code: `src/app/__tests__/maker-cta-hrefs.test.tsx`,
`src/app/cart/__tests__/get-cart-sessionless.test.ts`,
`src/app/cart/page.tsx`, `src/components/site-header.tsx`,
`src/lib/ensure-guest-session.ts`, `src/lib/flags.ts`,
`src/lib/require-user.ts`, `docs/design-system.md` (~803). References to the
test file path follow its rename. Comment-only; no code change.

Acceptance: `git grep -n -i middleware -- src` returns nothing (the
experimental helper's import name excepted); the doc line reads correctly;
lint/typecheck clean.

## Gate (controller)

`npm run lint`, `npm run typecheck`, `npx vitest run`, `npm run build` with
the CI dummy env (the deprecation warning is gone; the build's route summary
lists the proxy), `npm run db:generate` prints "No schema changes". e2e runs
in CI once the PR opens: `guest-funnel`, `cart`, `landing` exercise the gate.
