# SDD ledger — plan: docs/superpowers/plans/2026-09-07-210-header-sweep.md

## Pre-flight scan

Single-task plan, so there are no cross-task interface pairs to check. Rows:

| Check | What was compared | Finding |
|---|---|---|
| Task 1 internal: tests vs code | Step 2's assertions (`sweepStaleJobs` not called before return; `afterQueue.callbacks` length 1; drain then assert args) vs Step 4's implementation (`after(() => sweepUserJobsAfterResponse(user.id))` before `countActiveGenerationsForUser`) | Agree. The mock records the callback without running it, so "not called before return" and "called with the right args after drain" are both reachable. |
| Task 1 internal: files created vs files touched | Step 2 and Step 4 both touch only `src/components/site-header-actions.ts` and `src/components/__tests__/site-header-actions.test.ts`; Step 7 stages exactly those two | Agree. |
| Task 1 vs Global Constraints | Constraint "do not invent after() semantics" vs Step 4(a) import + call shape | Agree — copied verbatim from `src/app/studio/actions.ts:5,40`. |
| Task 1 vs Global Constraints | Constraint "no `catch (err: any)`" vs Step 4(b) | Agree — `catch (err)` + `err instanceof Error` narrowing. |
| Task 1 vs Global Constraints | "out of scope: sweep semantics" vs the reuse ruling | Agree — the ruling exists precisely to avoid a semantics change. |
| Plan mandate vs review rubric | Step 2(d) test "a sweep that never settles cannot hold up the header state" uses a never-resolving promise; a reviewer could call that a hang risk | Not a defect: the promise is only ever awaited inside an `after()` callback the test never drains, and the assertion is on `getHeaderState`'s own resolution. Left as mandated. |
| Plan mandate vs review rubric | Step 2(e) deletes assertions from an existing passing test | Legitimate — the invariant those lines asserted (sweep on the response path) is exactly what this change removes. Not a coverage regression: Step 2(a)/(d) replace it with stronger assertions. |

Scan clean; no rulings needed before dispatch.

## Rulings made while writing the plan (carried forward)

Ruling: do NOT reuse `sweepStudioForUser` for the header's sweep — it also runs `sweepIdleConversations`, so reusing it would move the 3-day conversation archive onto every page view of every route. Cost if wrong: ~8 duplicated lines of try/catch that a third caller would want factored out. Cheap to undo.

Ruling: accept one-header-fetch staleness in the running-jobs badge (the count can now include an overdue-but-unswept job). Same trade #212 accepted for the Studio lanes; self-corrects on the next header fetch, which happens on every pathname change. Cost if wrong: the badge reads one too high for one navigation. No money, data, or fulfillment path touched.

Ruling: fix only the header sweep; leave the other five `sweepStaleJobs`/`sweepIdleConversations` call sites alone (`getDesignJobs` is the poll surface that exists to observe the transition the sweep makes, so deferring it would defeat the poll; `user-designs.ts` and `design-thread.ts` are already inside a `Promise.all` and add no serial hop; studio is already `after()`; the cron must await). Cost if wrong: the remaining sites keep their current latency — a follow-up issue, not a regression.

## Task log

Task 1: dispatched (implementer sonnet, BASE c3020c0)
MERGE_BASE=e035795 (recorded for the final whole-branch review package)
Task 1: implementer DONE — commit be52432 "Schedule the header's stale-job sweep with after() (#210)". RED: 3 tests failed as predicted (inline sweep call, propagated rejection, timeout hang). GREEN: 8/8 in the target file, 7/7 neighbours, full suite 1596/1596, typecheck clean, lint 0 errors. No concerns raised.
Task 1: task reviewer dispatched (sonnet, diff c3020c0..be52432)
Task 1: task review — Spec COMPLIANT, task quality APPROVED. 0 Critical, 0 Important. One Minor (noted, not fixed): the test file's `vi.mock("next/server")` replaces the whole module; the reviewer checked all four transitively-imported deps and found no risk (they are each already fully mocked), flagging it only as a note for whoever adds a fifth dependency to that file.
Task 1: ⚠️ "cannot verify from diff" — commit trailers. Controller resolved: `git log -1 --format=%B be52432` shows both required trailer lines present and exact. Not a gap.
Task 1: minor (deferred): test file's whole-module `next/server` mock — recheck if a fifth dependency is ever added to site-header-actions.test.ts.
Task 1: complete (commits c3020c0..be52432, review clean)
Controller verification: lint 0 errors (21 pre-existing warnings, none in the changed files), typecheck clean, `npm test` 1596/1596 across 146 files, `npm run build` green.
Ruling: the first `npm run build` failed with "Neither apiKey nor config.authenticator provided" collecting /api/webhooks/stripe. Diagnosed as environment, not code — this worktree has no `.env.local` (only the main checkout does), so the module-scope Stripe client had no key. Re-ran with CI's exact dummy env block from .github/workflows/ci.yml and the build is green. Cost if wrong: a red CI build on the PR, visible immediately.
Final review: dispatched (opus, merge-base e035795..be52432)
Final review (opus): "Needs fixes before merge" — 0 Critical, 2 Important (both STALE INVARIANTS in files this diff never touched: src/lib/studio.ts:91-96 still says the header sweeps inline and calls sweepStaleJobs "read-shaped" where the new code calls it "write-shaped"; src/lib/archive-conversations.ts:17-21 lists site-header-actions.ts among sites that "still run inline"), 2 Minor (docblock omits the advisory-cap second reader; the schedule-before-read ordering invariant is asserted in a comment but pinned by no test). All three controller rulings upheld with independent evidence; deferred minor (whole-module next/server mock) triaged fine-as-is after re-deriving the six-import check. Concurrency claim verified against failGenerationJob's conditional UPDATE — refundGenerationQuota only runs for the caller that wins the row, so concurrent sweeps cannot double-refund.
Final review: ONE fix wave dispatched (sonnet, FIX_BASE be52432) covering both Importants and both Minors.
Final review fix wave: commit 396b82a "Fix stale sweep-locality comments and pin the after() ordering (#210)". Scoped re-review (haiku): all 4 findings ADDRESSED with file:line evidence, no new breakage, no out-of-scope observations. Verdict: ready for merge.
Controller re-verification on the fixed tree: lint 0 errors, typecheck clean, npm test 1597/1597 across 146 files, build green under CI's dummy env.
Branch complete: e035795..396b82a, 3 commits.
