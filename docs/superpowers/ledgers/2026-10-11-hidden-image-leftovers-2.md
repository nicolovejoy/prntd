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
