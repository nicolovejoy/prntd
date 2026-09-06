# SDD ledger — plan: docs/superpowers/plans/2026-09-05-195-confirm-sheet-library-bulk.md
Worktree: .claude/worktrees/195, branch feat/195-confirm-sheet-library-bulk, base 9732e20.
Spec: issue #195 (reachable).

## Preflight scan
| Pair / task | Produces vs consumes | Finding |
| T1 → T2, T4 | ConfirmSheet + useConfirm({confirm, element}) | consistent |
| T2 vs #187 branch | studio-client.tsx confirm lines only | cross-plan; rebase after #187 merges |
| T3 → T4 | deleteImages(ids) → {deleted, skipped[{imageId, reason}]} | consistent |
| T3 vs deleteDesignImage | extraction must keep its existing tests green | consistent, stated |
| T4 self | library-grid becomes client; page.tsx stays server | consistent |
Scan clean apart from the cross-plan note.

Task 1: complete (commits 9732e20..24cfe7a, review clean)
Task 1: minor (deferred): resolver side effects inside setState updater (confirm-sheet.tsx:124-137) — prefer useRef
Task 1: minor (deferred): `busy` prop has no consumer via the hook
Task 1: minor (deferred): phone flex-col-reverse makes DOM order ≠ visual order
Task 1: minor (deferred): backdrop tests reach through two parentElement hops
Task 1: minor (deferred): danger vs secondary Button variants look identical (button.tsx palette; Paper pass)
Task 1: Ruling: fold two minors into Task 2 (unmount-mid-confirm resolves false; role="dialog"/aria-modal/aria-labelledby on the sheet) — both live in the primitive and are one-liners; cost if wrong: a few extra lines in a mechanical task
Task 2: review → Important 1 (optimistic-removal assertion dropped; use a deferred mock), Important 2 (title repeated verbatim in body on 3 sites); minors 3 (docblock trips the acceptance grep), 4 (Recover deserves danger), 5 (getByText("Cancel") collides with pending-cell Cancel)
Task 2: Ruling: finding 2 conflicts with plan text ("existing strings become the body") — the copy rule (title = question, one consequence line) wins; split DELETE_CONVERSATION_CONFIRM / bulkDeleteConfirm into question + consequence parts at the source so there is still one definition. Cost if wrong: two constants become four.
Task 2: Ruling: minors 3, 4, 5 enter the fix round (each one line; Recover is irreversible and emails the customer, so danger is right).
Task 2: fix round 1/5 dispatched (5 findings; commits e636b3e..46e26bd) — re-review pending
Task 2: fix round 1/5 (5 addressed, 0 open; commits e636b3e..46e26bd)
Task 2: complete (commits 24cfe7a..46e26bd, review clean after round 1)
Task 3: Ruling: the plan's test line "seed-in-another-thread detached, image deleted" was a plan defect — shipped imageReferences semantics (slice 4) keep the image when another conversation/product/cart references it; at library level a detach would be a silent no-op. Accept the implementer's "in-use" skip reason (image kept, reported). Matches the Studio copy "Images used in an order, another design, or a cart are kept". Cost if wrong: owners can't bulk-remove an image seeded into their own other thread without deleting that thread first.
Task 3: review → Critical 1 (unconditional primary rewrite + lazy per-id planning lets [C, A] walk a legacy-order-protected primary out of protection), Important 2 (execution failure reported as not-found); minors 3 (deleteDesignImageRow dead + contract drift), 4 (legacy null-source row with its own link reads as in-use), 5 (no cap on ids, ~7 round trips each), 6 (image_generation/chat_message keep dangling ids — pre-existing)
Task 3: Ruling: minor 3 enters the fix round (delete the dead helper, repoint its two tests) — a helper whose docblock now lies is worse than none. Cost if wrong: two test edits.
Task 3: minor (deferred): 4 (legacy rows with any link undeletable from the library — conservative), 5 (no cap; same shape as deleteConversations — note in PR body), 6 (dangling FK-less ids — pre-existing)
Task 3: fix round 1/5 dispatched (3 findings; commits 7550d9c..66bfde6) — re-review pending
Task 3: fix round 1/5 (3 addressed, 0 open; commits 7550d9c..66bfde6)
Task 3: complete (commits 46e26bd..66bfde6, review clean after round 1)
Task 3: minor (deferred): the try in deleteImages wraps execute AND the primary update — a throw in the update reports failed after the row is gone and skips R2 cleanup (narrow the try)
Task 3: minor (deferred): duplicate describe name in delete-images.integration.test.ts
Rebased onto origin/main (cb69645, #187 merged): 3 import-line conflicts resolved (applyOptimistic + bulkDeleteConsequence; act + within). typecheck clean, studio suites 93/93, lint clean.
Task 4: complete (commits 745f94e..f882631, review clean)
Task 4: minor (deferred): result step writes `prev` snapshot back wholesale (library-grid.tsx:92,99) — functional update would be safer
Task 4: minor (deferred): identical accessible name "Select design" on every select-mode tile
Task 4: minor (deferred): bulkImageDeleteConsequence ignores its count parameter
Task 4: observation: the Studio bench's notice lives inside the select-mode block and unmounts on exitSelectMode on the success path (studio-client.tsx ~556) — likely why the 2026-09-04 three-at-once smoke "didn't see the notice". Not this branch's scope (studio-client.tsx was off-limits while #187 was in flight; #187 has now merged) — final review to triage: fix here or file.
Final review (cb69645..f882631): Important 1 (design-scoped plan doesn't check imageId is reachable from designId — cross-owner delete once links are gone; pre-existing, reproduced), Important 2 (primary update outside the batch → dangling primary + orphaned R2 on partial failure), Minor 3 (consequence copy narrower than the in-use rule — plan defect), Minor 4 (duplicate describe). T4 Studio-notice observation dropped (notice also renders in the composer block; the 09-04 smoke was the cap notice). Deferred minors triaged: all defer except 2 + duplicate describe.
Final fix wave: 1, 2, 3, 4 → one dispatch to the Task 3 implementer.
Final fix wave: 4 addressed, 0 open (commits f882631..ceb6b3e). Final review clean. Observations (comment-only): library-view docblock overstates 'names every case'; delete-design test comment mentions a product pin the test doesn't seed.
