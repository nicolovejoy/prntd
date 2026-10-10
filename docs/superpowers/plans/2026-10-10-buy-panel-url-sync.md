# Buy panel URL sync: let Next's router see the picks

Date: 2026-10-10. Branch: `claude/buy-panel-url-sync`. No migration.

## Goal

The buy panel on the image detail page writes its picks into the address bar
with `window.history.replaceState(window.history.state, "", next)`
(`src/app/d/[imageId]/buy-panel.tsx`, two calls: the sync effect and
`removePicksFromUrl`). Next's router does not see those writes, so a later
`router.refresh()` or revalidating server action puts the address bar back to
the URL the page was loaded with. The panel's own comment records this as a
known limit. This slice makes the router see the writes.

The focused stage already does this: `src/app/studio/studio-client.tsx`,
function `go` and the comment above it.

## What the installed Next does (read 2026-10-10, Next 16.3.6)

Verify each against `node_modules/next/dist/client/components/` before relying
on it; line numbers may differ.

- `app-router.js`, the patched `replaceState`/`pushState`: when the state
  argument already carries Next's marker (`__NA`), the patch calls the original
  and returns. The router is not told. That is today's behaviour.
- With any other state (for example `null`), the patch copies Next's own entry
  state in and dispatches `ACTION_RESTORE` with the new URL, which updates the
  router's canonical URL, `usePathname` and `useSearchParams`. No server
  request is made.
- `app-router-instance.js`, `dispatchAction`: an `ACTION_RESTORE` that arrives
  while another action is pending marks that pending action `discarded` and
  runs first. A discarded action's router state is never applied.
- `router-reducer/reducers/server-action-reducer.js`: a server action's caller
  still gets its return value when the action was discarded (the reducer calls
  `resolve(actionResult)` either way). A discarded action that revalidated
  queues a refresh. A discarded action that ended in `redirect()` does not
  navigate.

## Global constraints

- No copy change, no price string, no new user-facing text.
- Do not change the checkout, cart or mockup server actions.
- Keep the `navigatingAway` guard and the `pageshow` handler as they are.
- Do not introduce `router.replace` or `router.push` (a `router.replace` next
  to a server-action call gets cancelled; that is why the panel uses the
  history API).
- Do not read, create or copy any `.env*` file. Playwright cannot run in this
  worktree; CI's `e2e` job runs it on the pull request.
- `@typescript-eslint/no-explicit-any` is an error in product code.
- Comments say what the code does and why, plainly. Any comment that this
  change makes false must be corrected in the same commit.
- Gate before reporting: `npm run lint`, `npm run typecheck`, `npm test`, from
  the worktree root. One commit per task.

## Task 1: investigate, and write the findings down before changing code

Write the findings into the report file, with `file:line` for each.

a. Every server action that can be in flight on the image detail page while
   the panel is open (the panel, the hero, the publish and naming controls,
   the conversation strip, the shared header). For each: does the client use
   its return value, does the action call `redirect()`, does it revalidate.
b. Every `useSearchParams` or `usePathname` consumer rendered on that page,
   shared header and navigation included, and what each does when the query
   string changes. Flag any effect that writes state or the URL from it.
c. `src/app/d/[imageId]/page.tsx`: which props derive from `searchParams`.
   After the change, a `router.refresh()` re-renders the server page with the
   picks in `searchParams`. For each such prop: does a mounted client
   component react to a changed value (an effect keyed on the prop, a `key`),
   and does the result match what is on screen.

Stop rule: if (a) finds an action that ends in `redirect()` and can be pending
when a pick changes while `navigatingAway` is not set, or (b) or (c) find a
loop or a visible reset of the panel, do not make the change. Report BLOCKED
with the evidence.

## Task 2: the change

File: `src/app/d/[imageId]/buy-panel.tsx`.

- Both `replaceState` calls pass `null` as the state argument.
- Rewrite the comment above the sync effect: drop the "Limit" paragraph, and
  say why the state is `null` (the reason in `studio-client.tsx`'s `go`).
- `src/app/d/[imageId]/buy-panel-picks-context.tsx` has a comment that says
  `useSearchParams` would not follow these writes. Correct it to what is now
  true, and say why the context is still used (or report that it no longer has
  a reason, without removing it).

Tests (`src/app/d/[imageId]/__tests__/`): the sync write and the Cancel removal
both call `replaceState` with `null` as the first argument and the expected
URL. The existing assertions in `buy-panel.test.tsx` and `buy-hero.test.tsx`
keep passing; if one has to change, say why in the report.

## Task 3: one end-to-end check

jsdom has no Next router, so the unit tests cannot see the behaviour this
slice is for. Add one Playwright check, in the existing spec whose flow
already has an owner on their own image detail page (`e2e/owner-buy.spec.ts`
is the likely one): open the panel, pick a size, trigger a `router.refresh()`
through the UI (`editable-naming.tsx` and `published-image-view.tsx` each call
one), then assert the URL still carries the picked size, the panel is still
open, and the size is still selected.

Use the helpers the spec already uses. It cannot be run here; confirm it at
least parses with `npx playwright test --list`.
