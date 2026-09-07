# SDD ledger — plan: docs/superpowers/plans/2026-09-07-209-unique-violation.md

## Pre-flight conflict scan (2026-09-07)

Shared-file / interface pairs:

| Pair | Produces → Consumes | Finding |
|---|---|---|
| T1 → T2 | T1 produces `isUniqueViolation(err: unknown): boolean` (cause-walking); T2 consumes it in a new integration test file and in refund-order.integration.test.ts | Clean. Signature unchanged, so T2's imports are the existing ones. |
| T1 → T3 | T1's widened match is the precondition for T3 deleting the `db.batch` workaround | Clean. T3 Step 1 records the before-picture and Step 4 re-runs it, so the ordering dependency is enforced by the plan's own steps. |
| T1 ↔ T2 both touch `src/lib/ledger.ts`? | T1 modifies it; T2 only *temporarily* reverts it for mutation verification and restores via `git checkout` | Noted risk: T2 Steps 3 and 6 edit a file T1 owns. Ruled below. |
| T2 ↔ T3 | Disjoint files (T2: two test files; T3: `src/app/design/actions.ts`, comments in `src/lib/refund-order.ts`) | Clean. |
| T1 ↔ T3 | Disjoint files. | Clean. |

Self-consistency, per task:

| Task | Tests specified vs code specified | Files created vs later touched | Finding |
|---|---|---|---|
| T1 | 9 unit cases against the cause-walking impl; the depth-bound case (50 links, match past bound → false) is consistent with `MAX_CAUSE_DEPTH = 8`; the cycle case is consistent with the `seen` Set | `ledger.ts` + `ledger.test.ts`, both touched only here | Clean. |
| T2 | 3 real-DB cases + 1 refund case; all use `createTestDb`; the FK case asserts `false`, consistent with T1's regex | Creates `unique-violation.integration.test.ts`, appends to `refund-order.integration.test.ts`; neither touched later | Clean, modulo the ledger.ts revert ruled below. |
| T3 | No new tests; relies on `refused-submit-no-row.integration.test.ts` covering both branches (verified present by the controller before planning) | Modifies `actions.ts`; comment sweep may touch others | Clean. |

Rubric-vs-plan check: no task mandates an assertion-free test or a verbatim-duplicated logic block. The two mutation-verification steps (T2 Steps 3, 6) deliberately revert product code temporarily — that is evidence-gathering, not a defect, but see the ruling.

Ruling: T2's mutation-verification steps temporarily revert `src/lib/ledger.ts` (a T1-owned file) and restore it with `git checkout`. Kept as written, with the requirement that T2's implementer confirm `git status` is clean for `src/lib/ledger.ts` before committing — because a test that cannot fail is not a test, and this is the only way to prove these two land on the defect. Cost if wrong: a botched restore silently reverts T1's fix; caught by T2 Step 5's re-run and by the full suite in T3 Step 6.

## Progress

Controller grep audit (spec item 4), run 2026-09-07 on the pre-change tree:

- `isUniqueViolation` callers, all four: `src/lib/ledger.ts:150` (definition), `src/lib/webhook-handlers.ts:149` (db.batch — matched before and after), `src/app/design/actions.ts:290` (db.batch, the #211 workaround — Task 3 removes it), `src/lib/refund-order.ts:103` (bare insert — the live defect).
- Other `catch` sites that inspect a message string: exactly one, `src/lib/printful.ts:188` (`/\b404\b/.test(message)`). NOT the same defect — that error is one we construct ourselves in `printfulFetch` (`throw new Error(\`Printful API error: ${res.status} ...\`)`), never wrapped by a library, so the status is on `.message` at the top level by construction. Left alone.
- `src/lib/design-prompt.ts:23` matches user text, not an error. Not applicable.

Conclusion: there is no second instance of this defect to fix. Goes in the PR body.

Task 1: dispatched (sonnet), BASE de091b7.
Task 1: implementer DONE, commit 8d1c93b (ledger.test.ts 21/21; caller suites 42/42). Task reviewer dispatched (sonnet) on review-de091b7..8d1c93b.diff.
Task 1: review clean — spec ✅, quality Approved, no findings. Reviewer hand-traced the termination argument and the FK non-match rather than trusting test names. Its one ⚠️ ("cannot verify the real driver nests as assumed, that premise isn't in this diff") is resolved by controller: the shapes were verified empirically before planning, and Task 2 turns that into a standing test. Not a gap.
Task 1: complete (commits de091b7..8d1c93b, review clean)
Task 2: dispatched (sonnet), BASE 8d1c93b.
Task 2: implementer DONE, commit 224f066 (11/11). Both mutation verifications produced REAL failures — bare-insert test failed under the old one-liner; the refund test rejected with "Failed query: ..." instead of returning the no-op, proving it reaches the catch. `git diff 8d1c93b..HEAD --name-only` confirms only the two test files changed; ledger.ts cleanly restored. Task reviewer dispatched (sonnet).
Task 2: review clean — spec ✅, quality Approved. Reviewer independently traced both mutation arguments and confirmed the new refund test reaches the catch at refund-order.ts:103 (not the up-front short-circuit), citing the unique index at schema.ts:305.
Task 2: minor (deferred): task-2-report.md prose cites refund-order.ts:93 (the insert) where it means :103 (the catch). Scratch artifact only, not code, and the workspace is deleted at finish; the commit message cites the right line. No action.
Task 2: complete (commits 8d1c93b..224f066, review clean)
Task 3: dispatched (sonnet), BASE 224f066.
Task 3: implementer DONE, commit f5d923f (one file, src/app/design/actions.ts, +4/-11). Before-picture 5/5, after-picture 33/33 identical, full suite 147 files / 1607 tests — exactly the count the plan predicted. Grep sweep: 34 hits, only this site needed a change; ruling 1 (refund-order.ts no-op) confirmed by the implementer after re-reading. One unrelated transient flake in studio-client.test.tsx under parallel load, clean on rerun and on a second full run. Task reviewer dispatched (sonnet).
Controller verification gate (run at f5d923f): lint 0 errors / 21 pre-existing warnings; typecheck clean; npm test 147 files / 1607 tests all pass; npm run build SUCCEEDS.
Ruling: the first `npm run build` failed at "collect page data for /api/webhooks/stripe". Diagnosed as a missing `.env.local` in this worktree (a fresh worktree has none; the route needs Stripe env at module load), NOT a defect in the change — re-ran with CI's exact dummy-env block from .github/workflows/ci.yml and it built clean. Cost if wrong: CI's build job would fail on the PR, which is visible before merge and is the same gate. Left `ci-skip.db` removed afterwards.
Task 3: review clean — spec ✅, quality Approved, no findings. Reviewer verified the refund boundary did not move (the diff sits inside the unchanged outer try whose catch is the single refunder) and independently spot-checked webhook-handlers.ts's batch as genuinely atomicity-motivated. Its two ⚠️ (did not rerun the full suite, did not run build) are both closed by the controller gate recorded above.
Task 3: complete (commits 224f066..f5d923f, review clean)
Final whole-branch review dispatched (opus) over e035795..f5d923f.
Final whole-branch review (opus): CLEAN — approve. No Critical, no Important. The reviewer verified the branch's central factual claims against the installed libraries rather than the plan's word: drizzle's errors.js sets the "Failed query:" message and puts the driver error on .cause; sqlite-core/session.js wraps every non-batch path; libsql/session.js batch() does not. Real cause depth is 1, MAX_CAUSE_DEPTH 8 is ample. Confirmed the refund boundary in generateDesign did not move, and found that the pre-existing real-DB race test in refused-submit-no-row.integration.test.ts already covers the db.batch removal end to end.

Three Minors, all documentation/posture:

Ruling (final review Minor 1): CLAUDE.md:200 still states "isUniqueViolation matches only errors thrown via db.batch" as standing fact. NOT fixed on this branch — CLAUDE.md's session record is owned by the /handoff flow, and a feature branch rewriting it invites a conflict with whatever else lands today. Named in the PR body instead so the next handoff appends the resolution. Cost if wrong: the false claim survives until the next handoff and could mislead a future session into re-adding a batch workaround.

Ruling (final review Minor 2): CLAUDE.md's next-steps item promises "#197's one-statement batch AND refund-order.ts simplify". Only the batch went. refund-order.ts is deliberately unchanged — the plan's pre-made ruling, which the reviewer independently agreed with: its catch was always the minimal correct form; only the helper was wrong. Stated explicitly in the PR body so the omission does not read as a dropped piece. Cost if wrong: a reader thinks work was skipped; one line of PR text is the whole remedy.

Ruling (final review Minor 3): ledger.ts's `return String(value)` fallback can itself throw (null-prototype object, or a throwing toString) from inside a catch on a money path. NOT fixed. It is unreachable with the actual driver (drizzle and libSQL only throw Error subclasses), and it is not a regression — the old one-liner had the identical String(err) exposure. The reviewer's point is about posture consistency (cycle-safe but not toString-safe), not a defect. Deferred and named in the PR body. Cost if wrong: a pathological thrown value turns a would-be no-op into an unhandled TypeError — same as today's behaviour, so the branch makes nothing worse.

No fix wave dispatched: every finding is Minor, two are PR-body text, and the third is an explicitly-optional unreachable case the reviewer said was fine to leave.
