# SDD ledger — plan: docs/superpowers/plans/2026-09-05-187-optimistic-pending.md
Worktree: .claude/worktrees/187, branch feat/187-optimistic-pending, base 9732e20.
Spec: issue #187 point 2 + docs/studio-plan.md (reachable).

## Preflight scan
| Pair / task | Produces vs consumes | Finding |
| T1 → T2 | applyOptimistic/settleOptimistic/unseenOptimisticCount in studio-view.ts consumed by studio-client | consistent; T2 must not redefine them |
| T2 vs cap helper | isAtGenerationCap(runningCount, pendingCount) in generation-poll.ts; today called (pendingCount, submitting) | plan: (serverPending, unseenOptimistic) — consistent, no double count |
| T2 vs #195 branch | both edit studio-client.tsx (#195 only the two confirm lines) | cross-plan; merge #187 first, #195 rebases. Ruling: T2 leaves window.confirm lines untouched — cost if wrong: one rebase conflict |
| T1 self | tests list matches the three helpers | consistent |
| T2 self | test list matches design; Cancel gated on jobId | consistent |
Scan clean apart from the cross-plan note.

Task 1: complete (commits 9732e20..9a1c4ca, review clean)
Task 1: minor (deferred): unseenOptimisticCount docstring lacks the settle-first precondition (studio-view.ts:222)
Task 1: minor (deferred): anchored-append test starts from empty server pending; two-unanchored → two lanes untested
Task 1: minor (deferred): generationNumber: 0 sentinel on optimistic cell (studio-view.ts:138)
Task 1: Ruling: fold minors 1+2 into Task 2 (multiple synthetic lanes newest-first; lastActiveAt = max startedAt) — Task 2 is where multi-submit is exercised; cost if wrong: a few lines
Task 1: Ruling: plan-mandated "keep entry with known jobId when lane absent" stands (bounded to the pre-commit window; only reachable stuck state = anchor closed from another tab, cleared on reload). Task 2 must drop a lane's entries when THIS tab closes/deletes that lane. Cost if wrong: a stale synthetic lane until reload in the cross-tab case.
Task 2: review → Critical 1 (stale-snapshot settle drops the cell + stops polling), Important 2 (prevOptimistic restores clobber concurrent submits); minors 3 (Cancel appearing shifts the cell), 4 (transient duplicate, accepted), 5 (stuck entry holds a cap slot), 6 (unanchored submit doesn't scroll to top)
Task 2: Ruling: minor 3 enters the fix round — plan text says "same markup so nothing jumps", so it is a spec gap, not polish. Cost if wrong: a reserved 44px slot on the optimistic cell.
Task 2: Ruling: minor 5 enters the fix round as an age cutoff in settleOptimistic (entries older than the client's stale window are dropped) — the plan's "keep" rule was written for the pre-commit window, not forever; a permanently held cap slot is worse than a stale-lane flash. Cost if wrong: a legit slow job's optimistic cell disappears early (server cell still shows once the row exists).
Task 2: Ruling: minor 6 enters the fix round — plan's phone-first constraint says the cell is visible without scrolling; scroll the new top lane into view on unanchored submit. Cost if wrong: one scrollIntoView call.
Task 2: minor (deferred): transient duplicate cell (null-jobId entry + server cell) for ≤ one poll interval — accepted per plan
Task 2: fix round 1/5 dispatched (5 findings; commits 7dddc69..447a070) — re-review pending
Task 2: fix round 1/5 (5 addressed, 0 open; commits 7dddc69..447a070)
Task 2: minor (deferred): removedOptimistic read from render closure, restore-by-id branch untested (studio-client.tsx:281,392-407)
Task 2: minor (deferred): aged-out ghost only clears via a poll; halted error budget defers it to a focus wake
Task 2: minor (deferred): revealDesignId never cleared — remount would re-scroll
Task 2: minor (deferred): pending cell key flips localId→jobId (remount; elapsed label unaffected)
Task 2: complete (commits 9a1c4ca..447a070, review clean after round 1)
Final review (9732e20..447a070): Important 1 (cancel on an optimistic cell with a real jobId untested), Minor 2 (STALE_OPTIMISTIC_MS drift assertion), Minor 3 (IIFE in JSX map), Minor 4 (transient duplicate could be zero in one case — defer), Minor 5 (rebase cost with #195 — noted), Minor 6 (pre-existing: refused unanchored submit leaves an empty "Untitled" design row — file an issue). Deferred minors all triaged defer/resolved.
Final fix wave: findings 1, 2, 3 → one dispatch.
Final fix wave: 3 addressed, 0 open (commits 447a070..aba4d38). Final review clean.
