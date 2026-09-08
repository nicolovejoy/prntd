# SDD ledger — plan: docs/superpowers/plans/2026-09-08-231-abandoned-checkouts.md
Worktree .claude/worktrees/231-abandoned, branch feat/231-abandoned-checkouts, base 15a87e9. Migration 0013 HELD for Nico.

## Preflight scan
| Pair / task | Produces vs consumes | Finding |
|---|---|---|
| T1 → T2, T3 | schema column abandonedAt | consumed by T2 UPDATE and T3 where; test-db derives DDL from schema so no migration dependency in tests. Clean. |
| T2 → T3 | CHECKOUT_SESSION_TTL_SECONDS (30 min) vs STALE_PENDING_MS (45 min) | 45 > 30 + delivery margin; consistent. |
| T2 self | expires_at via injectable now; handler conditional UPDATE + rowsAffected; route branch reads metadata off event object | consistent; risk: route test signature pattern must exist (route.test.ts does). |
| T3 self | or(ne pending, and(isNull abandoned, lt createdAt)) vs 4 tests | consistent; #232 "hides pending" test needs a young createdAt — plan says so. |
| Migration number | 0013 collides with held PR #201 | Ruling: this PR takes 0013; #201 regenerates on rebase (it already needs one). Cost if wrong: #201 rework of one migration file. |

Task 1: complete (commits 15a87e9..04ab549, review clean). Migration drizzle/0013_omniscient_talkback.sql = single ALTER. Column test lives in user-orders.integration.test.ts (no chain test existed).
Task 2: implemented (commit 7162e38), review dispatched. Note from implementer: route test mocks the handler (file pattern); real-DB coverage in checkout-expired.integration.test.ts.
Task 2 review: approved with one ⚠️ that is a real defect — expires_at = floor(now/1000)+1800 sits at Stripe's 30-minute floor with zero margin; sub-second flooring + request latency + clock skew can put it under the floor and Stripe REJECTS the session (checkout breaks). Ruling: CHECKOUT_SESSION_TTL_SECONDS = 35*60 with a comment naming the floor and the margin; STALE_PENDING_MS stays 45 min (T3). Cost if wrong: none user-visible (a session lives 35 min instead of 30).
Task 2: parked — route expired-branch has no try/catch (a DB throw → 500) — Ruling: keep; a 5xx makes Stripe retry, a swallowed 200 would lose the abandoned mark forever. Comment requested in the fix round.
Task 2: fix round 1/5 (2 addressed, 0 open; commits 7162e38..917a93e)
Task 2: complete (commits 04ab549..917a93e, review clean, 1 parked with ruling)
Task 3: complete (commits 917a93e..831e9e7, review clean; #232 test renamed honestly)
Final review (Opus): Needs fixes — C1 legacy/session-less pending rows would show as Processing; C2 migration must precede merge (ops); I1 stale 30-min docblock; I2 route comment contradiction; I3 admin has no abandonedAt signal; I4 35-min TTL is a buyer-facing dead end; I5 no test for the deliberate 500; minors (updatedAt, two comments, plan doc).
Ruling C1: reader additionally requires stripe_session_id IS NOT NULL (a row with no session was never payable) AND a new one-shot script scripts/mark-legacy-pending-abandoned.ts (dry-run default, --apply --confirm-prod, cutoff arg) marks pre-#231 pending rows abandoned at deploy time; no cutoff constant in code (a deploy-date literal rots). Cost if wrong: if Nico skips the script, legacy pending rows show as Processing until archived — the PR body says the script is a required deploy step.
Ruling I4: TTL 35 min → 2 h; STALE_PENDING_MS 45 min → 2 h 15 min. A 35-minute window dead-ends an interrupted buyer on Stripe's expired page; 2 h covers a normal interruption while keeping the ambiguous window far under Stripe's 24 h default. Cost if wrong: a webhook-stranded payment surfaces on /orders after 2 h 15 min instead of 45 min. Owner may reverse — flagged in the PR body.
Ruling I3: minimum surface — show "Abandoned" (mono, faint) on the admin list + detail when abandonedAt is set and hide Recover for those rows (Recover would fail with payment_status unpaid). No archive automation.
Ruling I5: add a route test that a throwing handler on the expired branch yields 5xx; add checkout.session.expired to scripts/e2e-stripe.sh's --events filter.
Minors: all folded into the fix wave (cheap, same files).
Final review fix wave: 7/7 addressed (commit 831e9e7..bf32323), re-review clean. I5 test pins "POST rejects" (route harness cannot produce a framework 500) — accepted, documented in the test. Script dry-run against a real DB NOT run (worktree has no .env.local; Claude may not load it) — handed to Nico in the PR body.
