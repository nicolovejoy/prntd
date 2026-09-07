# SDD ledger — plan: docs/superpowers/plans/2026-09-07-nav-model-a.md

Spec: docs/ux-design-review-2026-09.md (read; nav model A + owner decisions).
Worktree: /Users/nico/src/prntd/.claude/worktrees/nav-model-a, branch feat/nav-model-a.
Model policy (binding): implementers sonnet, task reviewers sonnet, scoped
re-reviews haiku, final whole-branch review opus.

## Pre-flight conflict scan

### Cross-task rows (shared file or interface)

| A | B | shared | produces vs consumes | finding |
|---|---|---|---|---|
| T1 | T2 | `src/app/studio/studio-client.tsx` | T1 rewrites the header row (~536-558) + the outer wrapper; T2 edits the empty-state Shop CTA (~569) | T1 shifts line numbers. T2 must locate by content, not by the plan's line number. Carried into T2's dispatch. |
| T1 | T2 | `src/app/studio/__tests__/studio-client.test.tsx` | T1 may drop an h1/Archive-link assertion; T2 re-points line 96 to `/shop` | Sequential, disjoint assertions. No conflict. |
| T1 | T2 | `src/app/designs/page.tsx` | T1 replaces it with a redirect; T2's new test imports and asserts on it | Ordered correctly — T2's `/designs` case passes on arrival. No conflict. |
| T1 | T4 | `?from=/studio/library` | T1's LibraryGrid produces it; T4's `nav.ts` consumes it | Between T1 and T4 the marker falls through to the Shop default. Transient, branch-internal, resolved by T4. No action. |
| T2 | T4 | `src/app/designs/actions.ts` | T2 changes 4 `revalidatePath("/prints")`; T4 changes line 176 `revalidatePath("/designs")` | Disjoint lines. No conflict. |
| T3 | T1,T2 | header link targets | T3 links `/studio` and `/shop` | Both routes exist by T3. No conflict. |
| T3 | T4 | `Sign in` destination | T3 renders the link; T4 changes where sign-in lands | Disjoint files. No conflict. |

### Per-task self-consistency rows

| task | check | finding |
|---|---|---|
| T1 | new tests vs new code | `StudioTabs` API matches the test exactly (no props, `aria-current`, exact-match active). Moved test's `../library-grid` import resolves unchanged after the move. OK. |
| T1 | files created vs files later touched | `src/app/studio/library/library-grid.tsx` imports `@/app/designs/actions`, which T1 deliberately leaves in place. OK. |
| T2 | new tests vs new code | Redirect tests mock only `permanentRedirect`; both redirect pages import only that. OK. |
| T2 | `existsSync` tests | Weak assertions — see Ruling P2. |
| T3 | test vs markup | jsdom does not apply `sm:hidden`, so the menu test correctly expects Studio+Shop inside the menu; the trigger's accessible name comes from `aria-label`, which beats its text. OK. |
| T3 | dependency | test uses `@testing-library/user-event`; the brief tells the implementer to check and fall back to `fireEvent`. OK. |
| T4 | plan text vs existing test file | **Conflict found** — see Ruling P1. |
| T4 | middleware | `/shop` absent from `ALWAYS_PROTECTED` and from the matcher; `/studio/:path*` already covers `/studio/library`. OK. |

### Pre-flight rulings

Ruling P1: `src/lib/__tests__/nav.test.ts:18-21` already asserts `/design`'s
parent is "My Designs". Task 4 moves that parent to the Studio but its brief
says "leave every other assertion exactly as it is", which would leave a
contradicting assertion behind. Ruling: Task 4 re-points lines 18-21 to
`["Home", "Studio"]` — the same change the plan makes elsewhere, not a
weakening. Carried verbatim into T4's dispatch. Cost if wrong: none; without
it Task 4 simply fails its own suite.

Ruling P2: Task 2's `/shop`-vs-`/shop/[slug]` non-collision is asserted with
`existsSync` on two page files, which a reviewer may fairly call a weak test.
Ruling: keep it. Next's route resolution cannot be exercised from a unit test
(the matcher lives in the build), so the honest unit-level proxy is "both
files exist and the static one is a real page"; the real proof is the build's
route manifest, which the controller checks in Final verification. Cost if
wrong: a reviewer's Minor finding I have pre-adjudicated; the assertion never
catches a routing regression on its own.

## Task log

Task 1: implemented (commit 8969478, base d52958f). Implementer reported DONE,
full suite 147 files / 1598 tests green, typecheck + lint clean. Task review
dispatched (sonnet).
Task 1: review clean — spec compliant, quality Approved, 0 Critical / 0 Important.
Task 1: minor (deferred): the implementer's report mis-explains why `flex-1` on
  studio-client's `<main>` stays live (it does stay live — `<main>` is a direct
  flex item of the layout's `min-h-screen flex flex-col`). Report prose only, no
  code defect.
Task 1: minor (deferred): plan-mandated double top padding — `studio/layout.tsx`
  header wrapper has `pt-8` above `<main>`'s own `py-8`, where the header row
  previously shared main's single `py-8`. Slightly more whitespace under the tab
  strip. Needs a visual eyeball, not a code fix. Carry to the final review.
Task 1: complete (commits d52958f..8969478, review clean)
Task 2: implemented (commit 75cc6f2, base 8969478). DONE, 148 files / 1602 tests
green, typecheck clean. Task review dispatched (sonnet).
Task 2: review clean — spec compliant, quality Approved, 0 Critical / 0 Important.
Task 2: Ruling: the reviewer found a PRE-EXISTING gap outside Task 2's scope —
  `setImageHidden` (src/app/admin/actions.ts) revalidates `/`, `/d/<id>` and
  `/admin/published` but never revalidated the feed route (not `/prints` before,
  not `/shop` now), so an admin hide/unhide leaves the feed showing a stale card.
  Decision: fix it inside Task 4 (which already edits revalidatePath sites) rather
  than file it — it is one line, zero-risk, and shipping a nav slice that renames
  the feed while leaving it stale on hide is incoherent. Cost if wrong: one extra
  cache bust on an admin action; no behavioural downside.
Task 2: minor (deferred): the implementer's report miscounted nav.test.ts /prints
  hits as 4 (actually 5). File untouched and out of scope; report prose only.
Task 2: minor (deferred): nothing outside src/ and e2e/ was grepped for `/prints`
  (e.g. .github/workflows/prod-smoke.yml). Controller to check before the PR.
Task 2: complete (commits 8969478..75cc6f2, review clean)
Controller check (following Task 2's ⚠️): `.github/workflows/prod-smoke.yml:99`
  probes `/prints` for `data-testid="published-grid"` with a bare `curl` (no `-L`),
  so after this slice it would receive HTTP 308 and FAIL on every prod deploy.
Ruling: re-point the prod-smoke probe (and its explanatory comment at line ~73) at
  `/shop`, inside Task 4. In scope by the spec's "everything naming the old routes
  follows"; the plan simply did not enumerate the workflow. Cost if wrong: none —
  the alternative is a red prod-smoke and a filed issue on the first deploy.
Task 3: implemented (commit 551686a, base 75cc6f2). DONE_WITH_CONCERNS — 1604/1604
  tests pass in 4 of 5 full-suite runs; one non-reproducible flake in the header
  suite, traced to the brief's own `settle()` helper waiting on the mocked call
  rather than the resulting state flush.
Task 3: Ruling: fix the flaky helper now rather than ship it. The plan authored
  that helper verbatim, but a test that flakes is a defect no matter who wrote it
  (the reviewer rubric says plan-mandated defects are still findings), and this
  suite runs on every PR — a flake here costs a rerun on unrelated PRs forever.
  Resuming the implementer with it as a finding before the task review. Cost if
  wrong: a slightly more verbose wait helper in one test file.
Task 3: fix round 1/5 (1 addressed, 0 open — flaky settle() helper now awaits the
  same promise the component's effect chains off, inside act(); 27 consecutive
  isolated header-suite runs green, 5 consecutive full-suite runs green;
  commits 551686a..031eebf). Incidental: vi.mocked() wrapper for typed mock access.
  Task review dispatched over the full range 75cc6f2..031eebf (sonnet).
Task 3: review — spec ✅, quality "Needs fixes": 1 Important, 4 Minor.
Task 3: ⚠️ resolved by controller — commit trailers verified present on 551686a,
  031eebf and 75cc6f2 via `git log --format=%b`.
Task 3: Ruling: the Important finding is MY plan's defect and the reviewer is
  right. Before this slice, a phone user only ever saw Cart inside the dropdown,
  where it carried `min-h-11 px-4 text-lg` (a real 44px target). My Step 4 markup
  made the bar copy the only copy at every breakpoint as an unpadded `text-sm`
  link — a tap-target regression on the single most funnel-critical control,
  against a binding constraint (44px) and the project's phone-first principle.
  Fixing in round 2. Cost if wrong: a slightly taller header row on phones.
Task 3: Ruling: also fixing the account-menu trigger's sub-44px tap target
  (reviewer's Minor 1, pre-existing at ~36x30px). It is now the ONLY route a
  phone user has to Orders and Sign out, this task already rewrites that exact
  button, and the 44px constraint is binding. Cost if wrong: two extra classes
  on one button; scope widened by one element.
Task 3: parked — settle()'s technique reaches into the mock's returned promise
  rather than waiting on the DOM (reviewer Minor 2). Ruling: leave it. The
  reviewer independently re-derived the ordering argument and called it genuinely
  deterministic, and it has 27 consecutive green isolated runs behind it;
  rewriting a proven-deterministic helper to a stylistically nicer one risks
  re-introducing the flake it just fixed.
Task 3: parked — jsdom cannot exercise the `hidden sm:inline` / `sm:hidden` split
  (reviewer Minor 3). Ruling: real and unfixable in a jsdom test; a swapped
  responsive class would pass unnoticed. Inherent to the harness, noted for the
  PR body, not worth an e2e assertion for a nav class.
Task 3: fix round 2/5 (2 addressed, 0 open — Cart bar link now `min-h-11 sm:min-h-0`,
  trigger now `min-h-11 min-w-11 sm:min-h-0 sm:min-w-0`, plus the scoped-query comment;
  2 new class-presence tests, honestly labelled as unable to verify rendered pixels
  under jsdom; 9/9 focused, 12/12 consecutive isolated runs, full suite 1606/1606;
  commits 031eebf..d2f8a37). Scoped re-review dispatched (haiku).
Task 3: re-review — all 3 findings ADDRESSED, no new breakage, parked items
  confirmed untouched.
Task 3: complete (commits 75cc6f2..d2f8a37, review clean after 2 fix rounds, 2 parked)
Task 4: implemented (commit 6197055, base d2f8a37). DONE — lint clean, typecheck
  clean, 1608/1608 tests, build succeeds under CI dummy env; route manifest lists
  /shop, /shop/[slug], /shop/[slug]/[productId] and /studio/library (confirms the
  static-vs-dynamic non-collision that Ruling P2 could only prove weakly in a unit
  test). Task review dispatched (sonnet).
Task 4: review clean — spec compliant, quality Approved, 0 Critical / 0 Important.
  Reviewer independently verified both controller additions against running code:
  setImageHidden now matches setFeedRank's existing `/` + `/shop` pattern, and the
  prod-smoke probe works (published-grid testid confirmed present on the live /shop
  200 route, not a redirect). Middleware list/matcher agree, /shop ungated.
Task 4: minor (deferred): stale docblock in src/app/d/conversation-actions.ts:15-17
  still says the feed renders on `/` and `/prints`. Same class as the benign hit in
  designs/page.tsx:4. Documentation drift only.
Task 4: complete (commits d2f8a37..6197055, review clean)

## Final verification (controller)
lint clean, typecheck clean, 148 files / 1608 tests pass, `npm run build` green
under CI's dummy env. Route manifest resolves Ruling P2 with real evidence:
  ○ /designs   ○ /prints   (static 308 pages)
  f /shop      f /shop/[slug]   f /shop/[slug]/[productId]
  f /studio    f /studio/archive   f /studio/library
So the static /shop and the dynamic /shop/[slug] are separate routes and neither
shadows the other — the thing the existsSync unit test could only weakly proxy.
Local e2e not runnable here (needs secrets); CI runs it on the PR.

## Whole-branch review (opus) — 3 Important, 9 Minor, "not ready" pending fixes

Ruling W1 (Important 1 — cart CTAs dead-end guests): REVERSING MY OWN RULING 11.
  The plan retargeted /cart's "Start a design" and "Add another design" to /studio.
  /cart is public and is a SHIPPED GUEST SURFACE (e2e/cart.spec.ts is "guest cart:
  two items"), but /studio is real-account-only twice over — middleware bounces a
  cookie-less visitor and requireRealUser bounces an anonymous guest-funnel session.
  So both CTAs now put a guest into a sign-in wall on the purchase path. src/app/
  page.tsx:20-22 documents that exact outcome as the thing it refuses to cause, and
  /order/confirm kept /design, so the branch is internally inconsistent too.
  The spec's rollout bullet does list cart/page.tsx among the files to sweep, so this
  deviates from the spec's LETTER: a bullet naming files to grep cannot be read as
  authorising a sign-in wall on a shipped, flag-on guest funnel. Decision: both cart
  CTAs go back to /design. Making /studio guest-tolerant is the better long-term
  answer and is a bigger decision than this slice. Cost if wrong: the cart's two CTAs
  open a bare thread instead of the bench — one extra tap for a signed-in user, which
  is the cost the original ruling mispriced in the opposite direction.

Ruling W2 (Important 3 — "Feedback off /d" dropped): the spec assigns it to THIS
  slice (rollout item 2) and names the concrete defect (the floating pill sits over
  "Add to cart" on /d). My plan asserted the opposite — "isFunnelRoute is not
  touched" — without listing it among the eleven rulings or costing it. That is a
  plan-contradicts-spec omission, not a decision. Decision: implement it; it is one
  string plus test cases, and the reviewer verified the prefix trap is safe
  (`/d` and `/d/...` match; `/dashboard`, `/design`, `/designs` do not). Cost if
  wrong: the floating launcher disappears from the image detail page, where the
  account-menu Feedback item still reaches it.

Ruling W3 (Important 2 — e2e/store-compose.spec.ts): real. Its comment now asserts
  the opposite of what Task 3 made true (the trigger is visible at every breakpoint
  and Sign out is menu-only, so the guarded click is load-bearing on desktop, not a
  no-op), and `name: "Menu"` resolves only by Playwright's case-insensitive substring
  match against "Account menu". Fix both. Cost if wrong: none.

Ruling W4 (Minors 4,5,6,7,8,9,10,11): fold into the same fix wave. The stale-docblock
  class is exactly what bit #214 in this repo (a false claim in design-system.md was
  about to be reinstated by the next copy sweep), and Minor 11's two class-presence
  assertions close the branch's largest untestable surface at the same fidelity the
  task already accepted for the 44px rule. Cost if wrong: a slightly larger diff.

Ruling W5 (Minor 12 — Studio top padding + missing flex-1 on the library/archive
  mains): NOT fixing in code. It is cosmetic, has no consequence today (nothing sits
  below those mains), and the honest test is a phone eyeball. Goes in the PR body as
  a smoke item. Cost if wrong: ~32px of extra whitespace under the tab strip ships
  and is fixed in a later Paper slice.

Ledger triage accepted as the reviewer gave it: the settle() park STANDS (reviewer
  re-derived the ordering argument independently); Ruling P2 STANDS (only its
  docblock overclaim needs trimming); the jsdom responsive-split park is CLOSED by
  Minor 11 rather than left parked.

Fix wave: commit 40375ea (base 6197055). All F1-F11 fixed; lint 0 errors,
  typecheck clean, 148 files / 1610 tests pass. Two implementer pushbacks, both
  CORRECT and accepted: (a) my F3 text implied `/design` was a negative case for
  the new `/d` prefix — it is not, `/design` already matches isFunnelRoute true via
  its own prefix entry, so no contradicting assertion was added; (b) my F4 asked to
  re-point the `/designs` boundary case at `/studio/library`, which would have
  flipped a false-bucket assertion into a true one — `/designs` correctly stays in
  the false bucket and `/studio/library` was added to the true bucket instead.
  Scoped re-review dispatched (haiku).
Fix wave: re-review — all F1-F11 ADDRESSED, both pushbacks confirmed as described,
  no new breakage, all three do-not-touch items verified untouched.
Fix wave: parked — F1's fix has no test asserting the cart CTA hrefs. Ruling: real
  and worth doing, but it does not reopen the loop (the process allows one fix wave,
  and every finding is addressed). The in-code comments naming the guest funnel are
  the durable guard shipped now; a regression test is a named follow-up in the PR
  body. Cost if wrong: a future sweep could re-retarget those two CTAs and only a
  human reading the comment would catch it.

## Final verification after the fix wave
lint 0 errors, typecheck clean, 148 files / 1610 tests pass, production build green.
Route manifest unchanged and correct: static 308 pages at /designs and /prints;
/shop, /shop/[slug], /shop/[slug]/[productId], /studio, /studio/archive and
/studio/library all resolve as distinct routes.
Branch complete: e035795..40375ea, 9 commits.
