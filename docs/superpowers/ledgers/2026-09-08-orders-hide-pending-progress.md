# SDD ledger — plan: docs/superpowers/plans/2026-09-08-orders-hide-pending.md
Worktree: .claude/worktrees/orders-pending, branch feat/orders-hide-pending, base fece58e (plan commit on main 28dcf05). No spec doc — plan is the spec.

## Preflight scan
| Pair / task | Produces vs consumes | Finding |
|---|---|---|
| T1 ↔ T2 | T1 touches src/lib/user-orders.ts + its integration test; T2 touches orders-list.tsx + two component tests | Disjoint files. Clean. |
| T1 self | where-clause filter vs two real-DB tests (pending hidden incl. with stripeSessionId; five non-pending statuses returned) | Consistent. `status` enum on order table includes exactly those six values. |
| T2 self | remove header button; delete 2 tests; add 1 negative assertion; keep h1 class byte-identical | Consistent. Risk: `Link`/`Button` imports still used by empty-state — plan says check before deleting. |
Ruling (preflight): hide pending in SQL, do not move the order insert after Stripe session creation — a crash between session and insert would strand a PAID session with no order row; an orphan pending row is the cheaper failure. Cost if wrong: a buyer sees a just-paid order only after the webhook lands (<2 s normally); confirm page covers that window.

Task 1: minor (deferred): pre-existing #198 zero-line fixture status pending→canceled (necessary under the new filter; verified no other test depended on pending rows)
Task 1: complete (commits fece58e..b06e32f, review clean)

Task 2: complete (commits b06e32f..ed961da, review clean)

Rebased onto origin/main after #230 merged (confirm page now says "View orders"); commits replayed clean as 47aa1f5 (Task 1) + ae37f71 (Task 2). Final review (Opus): Needs fixes — Important 1 confirm-page fallback copy promises presence on /orders; Important 2 user-orders.ts comment claims pending is never a placed order (false for webhook-stranded paid orders, recovered via admin Recover); Minor 3 unreachable "Processing" label comment; Minor 4 fixture status. Fix round 1 covers all four.
Ruling: fallback copy = "The receipt couldn't be loaded. Your payment went through. The order appears under Orders once it's confirmed." — nav model A has no "My"; persona C, no promise of presence. Cost if wrong: one string.
Ruling: keep the read-time filter as-is (no 15-minute window); file an issue for a checkout.session.expired handler + stranded-paid visibility instead. Cost if wrong: a webhook-stranded buyer sees nothing on /orders until admin Recover (they also get no email in that case today, so /orders was never their only signal).
Final review: fix round 1/5 (4 addressed, 0 open; commit ae37f71..0124fba); re-review clean. Follow-up filed as #231 (checkout.session.expired handler).
