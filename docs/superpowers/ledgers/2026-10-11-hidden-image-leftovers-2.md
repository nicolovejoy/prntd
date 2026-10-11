# SDD ledger — plan: docs/superpowers/plans/2026-10-11-hidden-image-leftovers-2.md

Branch `claude/hidden-image-leftovers-2` (cloud session, 2026-10-11). BASE `b458964` (the plan commit, on main `2ee375a`).
Two worktrees in the session scratchpad, one per implementer: `claude/hl2-item4`, `claude/hl2-item5` (local only, merged into the branch).
Rulings: #310 comment of 2026-10-11 (Nico agreed with every recommendation). Nico was on a flight; rulings below marked provisional are the session's.

## Preflight scan

| Items | What is shared | Finding |
|---|---|---|
| 4 × 5 | nothing (`src/app/design/actions.ts` vs `src/lib/discover-feed.ts`, `composition-reads.ts`, a new lib + script) | Parallel implementers in separate worktrees. Clean. |
| 4 × 2, 5 × 2 | item 2 is a trace; no code | Probe test written and deleted in the main checkout while the implementers ran in worktrees. Clean. |
| any × PR #314 | #314 touches cart, checkout, flags, stripe e2e | No overlap with any file this branch changes. Clean. |

## Rulings

- Ruling (provisional): items 4 and 5 get one Sonnet implementer each, in parallel worktrees; no per-task reviewer — the repo's convention for small slices (CLAUDE.md batch lesson, 2026-10-01) — if wrong, a task-level defect is found one step later, by the whole-branch review.
- Ruling (provisional): item 4 refuses by throwing, not a structured result. Both actions already throw for every refusal; `handleSelectImage` (`design-client.tsx`) swallows a throw, `handleUse` (`conversation-images.tsx`) shows the fixed `SET_PRIMARY_IMAGE_FAILED`, `handleMakeProductsForImage` lets it reject (pre-existing for every refusal), and prod masks action messages. The message reuses `publishImage`'s "This image is not available", so no new user-facing string — if wrong, a caller that wanted to tell "hidden" apart from other failures cannot; none does today.
- Ruling (provisional): `setPrimaryImage` checks hidden before its already-primary early return, so the answer does not depend on which image is primary — if wrong, re-selecting a hidden image that is already primary throws instead of being a silent no-op; nothing is written either way.
- Ruling (provisional): no conditional write guards item 4's check-then-write window. A hide landing between them leaves a hidden primary, the same state as hiding an image that is already primary, which the readers handle since #309 — if wrong, nothing new: that state is reachable anyway.
- Ruling (provisional): `selectImage` does not judge a `placement_render` id (no publication row, so `isImageAdminHidden` is false). The one-level render rule and #310 item 6 (legacy renders) are out of scope — if wrong, a legacy render of hidden artwork can still be set as primary by a direct call; `placement_render` has no live writer.
- Ruling (provisional): item 5's new feed filter is an inner join to `image_publication` with `is_hidden = false` and no `product.status` condition — `image_publication` is the one visibility reader — if wrong, a draft composition whose image still has a visible publication row (a broken write) would show in the feed; the parity read lists any such row.
- Ruling (provisional): the parity check compares the full filtered sets (no limit, no per-design dedupe): identical sets give identical feeds — if wrong, the script is stricter than the feed, never looser.
- Ruling (provisional): item 2's trace recommends option A (the ruling) plus a separate follow-up (D) for the existing class of published images whose conversation is gone, which predates hiding (probe P2) — if wrong, Nico picks another option on #310; nothing was built.

## Progress
- Item 2 trace: probe test (P1 today's delete, P2 seeded visible image survives its conversation, P3 the ruled rule then an unhide) run in the main checkout and deleted. Posted on #310: https://github.com/nicolovejoy/prntd/issues/310#issuecomment-6110978666 (with the `startConversationFromImage` finding and four questions).
- Item 4 implementer (Sonnet) DONE: `f31fcab`. Its gate: lint 0 errors, typecheck clean, the touched file 19/19, `npm test` 250 files / 3872 tests. Fast-forwarded onto the branch.
- Item 5 implementer (Sonnet) DONE_WITH_CONCERNS: `d700ba7`, cherry-picked onto the branch as `5ece8d7`. Its gate: lint 0 errors, typecheck clean, touched files 23/23, `npm test` 3876/3877. The one failure: `composition-read-swap.integration.test.ts` "drops a composition whose status is draft, even with the publication row intact", which pins the feed following `product.status`.
- Ruling: that test is flipped to the new rule (a draft composition with a visible publication row stays in the feed), not kept by adding a `status <> 'draft'` guard back — the owner ruled the feed moves to `image_publication`, and the guard would leave a visibility read on `product.status` — if wrong, a drifted draft composition shows in the Shop; unpublish writes both rows in one batch, and the parity read lists any such row. Commit `3df67ab` (also fixes the file's header sentence).
- Controller gate on `3df67ab`: lint 0 errors (25 warnings, none in changed files), typecheck clean, `npm test` 251 files / 3886 tests, `db:generate` "No schema changes", `npm run build` with CI's dummy env ok.
- Whole-branch review (Opus) dispatched on `b458964..3df67ab`, in a detached review worktree.
- Whole-branch review (Opus) on `b458964..3df67ab`: READY, no Critical or Important, four Minor, four nits. It ran lint, typecheck, `npm test` (251 / 3886), revert checks (4 tests fail with the feed change reverted, 3 with item 4 reverted), and the parity CLI under tsx on a migration-built file DB (clean → exit 0, two drift shapes → exit 1, no token in output). Its build failed only because Turbopack refuses a symlinked `node_modules`; the controller's build in the main checkout passed.
- Ruling: Minor 1 (`composition-parity.ts` says a non-draft composition with no publication row is "in the Shop with no publish grant", false since item 5) is fixed: the message now states the fact without the Shop claim, test string updated — if wrong, one line of wording.
- Ruling: Minor 2 (`handleMakeProductsForImage` in `/design` lets `selectImage` reject, so Order on an image hidden while the tab was open is a dead click; `handleUse` shows "Try again" for a retry that can't succeed) is accepted, no caller change — needs an admin hide while the owner's tab is open, `/design` is retired by #188 slice 2, every other `selectImage` refusal behaves the same, and the brief kept callers unchanged — if wrong, the owner clicks Order and nothing happens; a reload removes the image from the thread.
- Ruling: Minor 3 (a drifted draft composition now in the feed shows a title on its card but none on its image detail page, and can't be ranked) goes into the PR body as one line next to the parity read — drift only — if wrong, a drifted card reads oddly until the row is fixed by hand.
- Ruling: Minor 4 (ledger missing item 5) was already fixed in `0c9f5e0`, after the review's snapshot.
- Ruling: nit "one snapshot" is taken — the parity reads run as one `client.batch([...], "read")` — if wrong, nothing: the same statements, one transaction.
- Ruling: nit "`~/.turso/turso` and check out the branch" is taken in the PR body's paste blocks; the script header keeps CLAUDE.md's form like the composition script — if wrong, a reader of the header uses `turso` and gets a 401, exit 1, never a false clean.
- Ruling: nit "`process.exit` can truncate piped stdout" is left — the composition script does the same and the run is read in a terminal — if wrong, a piped run loses its tail; re-run unpiped.
- Ruling: nit "`selectImage` docstring hides the clear-on-unmatched-URL behaviour" is taken: the docstring says it.
- Out of scope, recorded: `executeImageDeletion`'s primary move (`src/lib/delete-image.ts`) can pick a hidden output as the new primary. A system write, not an owner pin; the #309 readers handle a hidden primary. Listed in the PR body under "Found, not changed".
- Fix commit `3108a8e`. Controller gate on it: lint 0 errors, typecheck clean, `npm test` 251 / 3886, `db:generate` "No schema changes", build ok; the parity CLI re-run under tsx on migration-built file DBs: clean → `PARITY CLEAN` exit 0, drift → exit 1, token never printed.
