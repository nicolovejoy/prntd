# The embedded session's return origin trusts only the deployment it runs on (#317 item 5): implementation plan

> Built subagent-driven on 2026-10-13: one Sonnet implementer in its own worktree, the controller re-runs the CI gate, one Opus whole-branch review. The ledger with every ruling is `docs/superpowers/ledgers/2026-10-13-317-item-5-return-origin.md`.

**Goal:** `resolveReturnOrigin` (`src/lib/embedded-checkout.ts:192`), which decides the origin an embedded Stripe session's `return_url` points at, stops accepting every host that matches a regular expression of this project's Vercel preview shape. It accepts the app origin (`NEXT_PUBLIC_APP_URL`, which also covers local dev and the e2e harness), and, only when the deployment is a Vercel Preview, the deployment's own two hosts as Vercel names them in `VERCEL_URL` and `VERCEL_BRANCH_URL`. Anything else falls back to the app origin, as today.

**Source of the work:** https://github.com/nicolovejoy/prntd/issues/317, item 5 (from the #314 adversarial review): `PREVIEW_HOST_RE` is wider than its comment, is honoured in Production too, and accepts names that are not deployment URL shapes and any port. The review named the tighter rule this plan builds.

**Why it is safe:** Vercel sets `VERCEL_ENV` (`production`, `preview`, `development`), `VERCEL_URL` (the deployment's own host, `prntd-<hash>-nico-lovejoys-projects.vercel.app`, no scheme) and `VERCEL_BRANCH_URL` (`prntd-git-<branch>-nico-lovejoys-projects.vercel.app`, no scheme) at build and run time; a request to a Preview arrives at one of those two hosts. Nico's Preview smokes open the link from the Vercel comment on the PR, which is one of them. Production serves `prntd.org`, which is the app origin. Nothing in product code reads these three variables today (grep of `src/` at `548ce4b`), so this slice introduces them.

**Architecture:** `resolveReturnOrigin` gets a third parameter, a plain object of the three env strings, so it stays a pure function of its inputs. One env-reading helper, `vercelDeployment()`, builds that object from `process.env`. The three callers pass it. No schema change. No new user-facing string.

**Branch and worktree:** `claude/317-item-5-return-origin` at `.claude/worktrees/317-item-5`, off `origin/main` at `548ce4b`.

## Review focus

- The e2e harness and local dev: `NEXT_PUBLIC_APP_URL` is a localhost URL there and `VERCEL_ENV` is unset; the Origin equals the app origin, so the result is unchanged.
- A Preview whose `VERCEL_URL` is set but whose request arrives on `VERCEL_BRANCH_URL` (the link the Vercel bot posts), and the reverse.
- Production must never accept a `*.vercel.app` origin, including its own `VERCEL_URL`, because a Production buyer is on `prntd.org` and a session that returns to a `vercel.app` host would land on a host with no auth cookie for the buyer.
- Scheme: only `https:` for the Vercel hosts; the app origin comparison is exact (`origin.origin === fallback`), so a plain-http localhost app origin still matches itself.
- Comments: the long docblock on `resolveReturnOrigin` and the `PREVIEW_HOST_RE` comment describe the regular-expression rule; both must describe the new rule, and the comparison to `src/lib/auth.ts`'s `trustedOrigins` must still be true.

---

## Global Constraints

These bind every task. They come from `CLAUDE.md`, `AGENTS.md` and the issue.

1. **No new user-facing string.**
2. **No schema change.** `npm run db:generate` must print "No schema changes" and leave `drizzle/` untouched.
3. **Tests:** TDD. Unit tests for the pure function; the two real-DB integration tests for the embedded order-creation paths are checked, and extended only if they assert on the return origin. `src/lib/**` tests run under node, not jsdom.
4. **Do not edit** `src/lib/__tests__/factories.ts`, `src/lib/__tests__/test-db.ts`, `CLAUDE.md`, `AGENTS.md`, `src/lib/auth.ts`, or anything under `docs/`.
5. **Stay inside the file list** of each task. If the work needs a file outside it, say so in your report and explain why before (or instead of) editing it.
6. **Server Actions:** a `"use server"` file exports async functions only. Pure helpers live in `src/lib/`.
7. **Lint policy:** no `any` in product code (tests may use it). `catch (err)` and narrow with `err instanceof Error ? err.message : String(err)`.
8. **Comments and docs:** plain statements of what the code does and why. No hyperbole. Update every comment your change makes untrue (grep for `PREVIEW_HOST_RE`, `resolveReturnOrigin`, `preview host`, `nico-lovejoys-projects`, `returnOrigin`).
9. **This is Next.js 16.** If you touch anything Next-specific, read the relevant guide in `node_modules/next/dist/docs/` first.
10. **Never read `.env*` files or any secret material.** No network calls. Do not run the dev server. Do not run `npm run e2e` or `npm run e2e:stripe`.
11. **Git:** work only in your worktree, on its branch. Commit per task with a descriptive message ending with the line `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Do not push, do not open a pull request, do not touch other worktrees or branches, do not delete branches.
12. **Do not dispatch subagents.** Review comes from the controller after your report.

## Gate (run before reporting; all four must pass)

```
npm run lint
npm run typecheck
npm test
npm run db:generate
```

`npm test` is the full suite (about 265 files, under two minutes). Run it in the foreground and read the summary line. If a test you did not touch fails, run it again on its own before concluding anything, and report it either way. `npm run build` is not part of your gate (the worktree's `node_modules` is a symlink, which Turbopack refuses); the controller builds.

## Report (in your reply, not in a file)

Under 400 words:

- Status: `DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT` or `BLOCKED`.
- Commits: short sha and subject, in order.
- Gate: the summary line of each of the four commands.
- Files changed, one line each, with what changed.
- Every comment you updated because it had become untrue, and every comment you found that describes the old behaviour and decided to leave (say why).
- Anything you did that the plan did not say, and anything the plan said that you did not do, with the reason.
- Concerns, if any.

---

## Task 1: `resolveReturnOrigin` takes the deployment's own hosts

### Files

- `src/lib/embedded-checkout.ts`
- `src/lib/__tests__/embedded-checkout.test.ts`

### The change

Add, next to the function:

```ts
/**
 * The three Vercel system variables this module reads. Pure data so
 * `resolveReturnOrigin` stays a function of its inputs; `vercelDeployment()`
 * fills it from `process.env`. Vercel sets `VERCEL_ENV` to `production`,
 * `preview` or `development`, and `VERCEL_URL` / `VERCEL_BRANCH_URL` to the
 * deployment's own hosts (no scheme). All three are absent outside Vercel.
 */
export type VercelDeployment = {
  env: string | undefined;
  url: string | undefined;
  branchUrl: string | undefined;
};

export function vercelDeployment(): VercelDeployment {
  return {
    env: process.env.VERCEL_ENV,
    url: process.env.VERCEL_URL,
    branchUrl: process.env.VERCEL_BRANCH_URL,
  };
}
```

`resolveReturnOrigin(originHeader, appUrl, deployment: VercelDeployment)`: keep every existing step up to and including `if (origin.origin === fallback) return origin.origin;`. Replace the block after it with:

```ts
if (deployment.env === "preview" && origin.protocol === "https:") {
  const own = [deployment.url, deployment.branchUrl]
    .map((h) => (h ?? "").trim().toLowerCase())
    .filter((h) => h !== "");
  if (own.includes(origin.host.toLowerCase())) return origin.origin;
}
return fallback;
```

`origin.host` (not `hostname`) so an origin with an explicit port only matches a `VERCEL_URL` that carries the same port (Vercel's never do). Delete `PREVIEW_HOST_RE` and its comment. The `prntd.org` / `*.prntd.org` branch goes too: in Production the app origin is `https://prntd.org` and is matched by the exact comparison above; no other `prntd.org` host serves the app (ruling 2 in the ledger).

Rewrite the docblock of `resolveReturnOrigin` to describe this rule in the same plain register: what is trusted (the app origin anywhere; on a Vercel Preview, the deployment's own two hosts over https), what is not (Production never trusts a `vercel.app` host, including its own `VERCEL_URL`, because the buyer is on `prntd.org` and has no session cookie on any other host; a `vercel.app` host whose name happens to look like ours; plain http), why (the value decides where a live payment session returns), and that Next's own Origin check on server actions is the first guard. Keep the paragraph about hosted checkout and the one about never throwing. Keep the comparison with `src/lib/auth.ts`'s `trustedOrigins` only if it is still true after you read that file (do not edit it).

The module docblock at the top lists the exported helpers; add `vercelDeployment` to it if it lists the env-reading wrappers.

### Tests (`src/lib/__tests__/embedded-checkout.test.ts`, the `resolveReturnOrigin` describe)

Define two deployments at the top of the describe:

```ts
const OUTSIDE_VERCEL = { env: undefined, url: undefined, branchUrl: undefined };
const PREVIEW = {
  env: "preview",
  url: "prntd-abc123def-nico-lovejoys-projects.vercel.app",
  branchUrl: "prntd-git-feature-x-nico-lovejoys-projects.vercel.app",
};
const PRODUCTION = {
  env: "production",
  url: "prntd-9f8e7d6c-nico-lovejoys-projects.vercel.app",
  branchUrl: "prntd-git-main-nico-lovejoys-projects.vercel.app",
};
```

Every existing test passes a deployment. Expected results:

- No header, unparsable header, header equal to the app origin, localhost with a localhost app origin, `javascript:`, `evil.example`, `not-a-url` app URL, undefined app URL: unchanged, with `OUTSIDE_VERCEL`.
- The two existing "trusts a branch/hash preview host" tests: now pass `PREVIEW` with the matching `branchUrl` / `url` and expect the origin; and the same headers with `OUTSIDE_VERCEL` → the app origin (the shape alone no longer counts).
- New: `PREVIEW` with an origin on a different `nico-lovejoys-projects` host (`https://prntd-git-other-nico-lovejoys-projects.vercel.app`) → the app origin.
- New: `PRODUCTION` with `https://prntd-9f8e7d6c-nico-lovejoys-projects.vercel.app` (its own `VERCEL_URL`) → the app origin.
- New: `PRODUCTION` with `https://prntd-git-main-nico-lovejoys-projects.vercel.app` → the app origin.
- New: `PREVIEW` with `http://prntd-abc123def-nico-lovejoys-projects.vercel.app` (plain http) → the app origin.
- New: `PREVIEW` with `https://prntd-abc123def-nico-lovejoys-projects.vercel.app:8443` → the app origin (port does not match).
- New: `PREVIEW` whose `url` is `undefined` and whose `branchUrl` matches → the origin; both undefined → the app origin.
- New: `PREVIEW` with the host in a different case in `VERCEL_URL` → the origin (case-insensitive host match).
- The existing "staging.prntd.org" test (line 254) now expects the app origin (ruling 2).
- The existing path-stripping test (line 294) passes `PREVIEW` and still expects the bare origin.

---

## Task 2: the three callers pass the deployment

### Files

- `src/app/d/actions.ts` (the `resolveReturnOrigin` call near line 767)
- `src/app/cart/actions.ts` (near line 771)
- `src/app/order/actions.ts` (near line 189; the `/preview` action, dead since one-buy-surface slice 4 but still compiled)
- `src/app/d/__tests__/buy-published-design-embedded.integration.test.ts`
- `src/app/cart/__tests__/checkout-cart-embedded.integration.test.ts`
- `src/app/order/__tests__/preview-embedded-checkout.integration.test.ts` (only if it asserts on the return origin)

### The change

Each call becomes `resolveReturnOrigin(originHeader, process.env.NEXT_PUBLIC_APP_URL!, vercelDeployment())` (import `vercelDeployment` next to `resolveReturnOrigin`). The comment in `src/app/cart/actions.ts` above the call ("An embedded session returns to the deployment it was created on, so a purchase on a Preview lands on that Preview") stays true; leave it.

### Tests

Read the two (or three) integration tests for any case that sets an `origin` header to a preview host and expects the `return_url` to use it. If one exists, it must now also stub `VERCEL_ENV=preview` and `VERCEL_URL` to that host (`vi.stubEnv`, restored in `afterEach`); if none sets such a header, add one case to the cart test: `origin: https://prntd-abc123def-nico-lovejoys-projects.vercel.app` with `VERCEL_ENV=preview` and `VERCEL_URL` set to that host → `return_url` starts with that origin; the same without the env → `return_url` starts with the app origin. Follow the file's existing way of supplying headers and env.

---

## What a reviewer will attack

- A Preview request arriving on a host that is neither `VERCEL_URL` nor `VERCEL_BRANCH_URL` (a custom alias; this project has none) now returns to Production's `/order/confirm`, where the order does not exist. Say so in the report if you find a third host shape Vercel documents for this project.
- `origin.host` versus `origin.hostname` and the default-port edge (`https://host:443` parses to `host` with no port in `origin.host`; that is the same string Vercel sets).
- Any remaining reference to `PREVIEW_HOST_RE`, in comments or tests.
- The `/preview` action's call site compiling and its integration test passing untouched.
