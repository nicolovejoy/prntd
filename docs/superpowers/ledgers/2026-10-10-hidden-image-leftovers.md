# SDD ledger — plan: docs/superpowers/plans/2026-10-10-hidden-image-leftovers.md

Branch `claude/hidden-image-leftovers`, worktree `.claude/worktrees/hidden-image-leftovers`.
BASE d6e2412 (plan commit on origin/main 8bf8160). Session 1005, 2026-10-10.
Spec: none separate. The plan carries Nico's rulings (2026-10-05, 2026-10-08); rulings below are provisional.

## Preflight scan

| Tasks | What is shared | Finding |
|---|---|---|
| 1 × 2 | `getDesignSourceImages` feeds the thread's `sources` | Task 2 builds on Task 1; sequential in one implementer. Clean. |
| 1 × 3 | nothing (`studio.ts` runs its own image query) | Clean. |
| 1 × 4, 2 × 4, 3 × 4 | nothing (`isImageAdminHidden` is called only from `designs/actions.ts`) | Clean. |
| 2 × 3 | nothing | Clean. |
| Task 1 alone | removes an option, lists five callers | Caller list came from a grep on main at 8bf8160; implementer re-verifies. |
| Task 2 alone | "follow the function's existing fallback" | Not verified that `getDesignDisplayImageUrl` has a fallback; implementer reports what it finds. |
| Task 3 alone | filter + three tests | Clean. |
| Task 4 alone | one read removed, one pinning test | Clean. |
| Task 5 alone | report only | Clean. |

## Rulings

- Ruling: one Sonnet implementer for the whole slice, no per-task reviewer; the main session re-runs the gate and dispatches one Opus whole-branch review — the repo's convention for small slices (CLAUDE.md batch lesson, 2026-10-01) — if wrong, a task-level defect is found one step later, by the whole-branch review.
- Ruling: hidden images leave the AI context as well as the gallery, so the two keep one numbering — if wrong, an earlier chat turn's "image 3" names a different image after a hide, and the owner cannot edit from a hidden image through the thread.
- Ruling: a lane whose only image is hidden stays listed with no cells — if wrong, the owner has an empty lane to delete by hand.
- Ruling: a legacy placement render with no recorded source stays in the thread payload (it cannot be judged) — if wrong, a render of hidden artwork stays visible to its owner on `/design`.
- Ruling: `isImageAdminHidden` drops the mirror-product read (the #300 single reader) — if wrong, a row where only `product.status` says hidden reads as visible; `setImageHidden` writes both in one batch and prod parity read clean on 2026-10-08.

## Progress
- Implementer (Sonnet) DONE_WITH_CONCERNS: commits c4885b0, b79c8e3, 594abdb, da89379, 2d8a7f2 (d6e2412..2d8a7f2). Report: report.md (written by the controller from the hand-back; subagent Write is refused for report files).
- Controller gate on 2d8a7f2: lint 0 errors, typecheck clean, vitest green (see scratchpad gate-a.txt).
- Ruling: the display-URL readers take an opt-in excludeHidden instead of a changed default (implementer's departure) — nine other callers serve admin, receipts and fulfillment — if wrong, a caller that should hide still shows a hidden hero; the whole-branch review is asked to look for one.
- Ruling: the fifth commit (anchor tests) stays — it pins a behaviour Task 1 changed — if wrong, two tests to delete.
- Whole-branch review (Opus) dispatched on d6e2412..2d8a7f2.
- Whole-branch review (Opus) on d6e2412..2d8a7f2: READY TO MERGE, no Critical or Important, five Minor.
- Ruling: review finding 1 (a primary that is a placement-render id, and a render whose source is a render, are not judged and stay in the thread payload) is fixed in comments only; no chain walk — placement_render has no live writer, so the set is fixed and legacy — if wrong, a legacy thread's hero or product strip shows a hidden image on a placement to its owner on /design.
- Ruling: review finding 2 (the delete confirm on /design says the conversation goes too when one visible and one hidden image remain, but the conversation stays) is accepted — over-warning, on the older surface, needs a hidden image — if wrong, an owner is told more will be deleted than is.
- Ruling: review finding 3 (a /design tab loaded before a hide numbers images differently from the server, so a typed '#3' can run an edit on another image) is accepted — needs a hide while the tab is open — if wrong, one paid edit on the wrong image.
- Ruling: review finding 4 (lane delete, bulk delete and deleteDesignImage remove a hidden image while deleteImages refuses one) is pre-existing and goes to a follow-up issue for Nico to rule — this branch makes it likelier, since an all-hidden lane is now an empty lane the owner will delete — if wrong, a moderation record is lost before the ruling.
- Review finding 5: AI-context docblock fixed in the fix round; CLAUDE.md follow-up line goes in the docs PR; pre-existing 'listing row' wording left.
- Final fix wave dispatched (resume implementer, comments only): findings 1 and 5.
- Fix wave: 923583d (comments only; controller confirmed no non-comment line changed). Controller gate on 923583d: lint 0 errors, typecheck clean, production build with CI's dummy values ok; vitest ran on 2d8a7f2 (250 files / 3863 tests) and the fix changes no code.
- Scoped re-review (Haiku) of 923583d: both findings ADDRESSED, no new breakage. Residual, minor: the new comment says placement_render's only writer is insertDesignImage's productId branch, which holds for the app but not for scripts/restore-designs-from-backup.ts (an ops script that copies rows); and it names hiddenThroughSources as the buy path's chain walker when placementSourceUsable is a second one.
- Ruling: the two residual comment imprecisions are parked, no second fix wave (the SDD cap) — both statements are true of the app's own code paths — if wrong, a reader of that docblock is misled about an ops script; a one-line comment edit fixes it.
- Slice complete (commits d6e2412..923583d, review clean after one fix wave, 2 residual minors parked).
