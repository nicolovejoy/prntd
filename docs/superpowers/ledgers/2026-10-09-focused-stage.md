# SDD ledger — plan: docs/superpowers/plans/2026-10-09-focused-stage.md

Spec: docs/superpowers/specs/2026-10-09-focused-stage.md. Worktree
.claude/worktrees/focused-stage, branch claude/focused-stage, base 8d962d7
(plan commit on top of main 609936d).

## Spec rulings carried in from planning (each marked *(ruling)* in the spec)

- Ruling: URL is `/studio?conversation=&image=`, both params — a seed image sits in two conversations — cost if wrong: a param rename.
- Ruling: caption "Shown on <Colour>" only for a published, non-hidden result; unpublished on `bg-surface-well` with no caption (Nico 2026-10-08: no interim well change) — cost: one conditional.
- Ruling: composer = bench `Composer` verbatim (board F); the stage image is the anchor; ✕ clears it and the next Generate starts a lane on the bench — cost: copy.
- Ruling: action row Order · Open · New design (`Open` added so nothing the lightbox offered is lost) — cost: one link.
- Ruling: pending job in the strip = 56px dashed cell plus a mono "Generating… <elapsed> · Cancel" line — cost: markup.
- Ruling: history disclosure kept, collapsed (board G has it; F omitted it for height); no Ask on the stage — cost: a component.
- Ruling: anchor NOT spent by an accepted submit on the stage (bench #276 rule stays on the bench) — cost: one `if`.
- Ruling: a landed result moves the stage to it (replaceState) and keeps the draft — cost: one effect.
- Ruling: no tap on the large image (no lightbox) in this slice — cost: a follow-up.
- Ruling: `/design?id=` stays; redirect + thread deletion is slice 2 — cost: none, it is sequencing.

## Pre-flight scan

| Pair / task | Produces vs consumes | Finding |
|---|---|---|
| T1 → T3, T4, T5 | `StudioCell.backdropColor`, `StudioLane.messageCount` | T3/T4 test fixtures include both fields; T5 test helpers get them in T1 step 4. Consistent. |
| T2 → T4 | `getConversationHistory(designId) → HistoryTurn[]`, `HistoryTurn` exported from `src/app/studio/actions.ts` | T4 imports both from `./actions`; T4's mock of `../actions` returns the T2 shape. Consistent. |
| T3 → T4 | `historyTurnLabel(turn, cells)` | T4 passes `(t, lane.cells)`; T3's signature takes `{imageId}[]`. Consistent. |
| T3 → T5 | `parseFocus`, `focusHref`, `resolveFocus`, `laneStageHref`, `newestUnseenCell`, `BENCH_HREF`, `StudioFocus` | T5 imports exactly these names. Consistent. |
| T4 → T5 | `FocusedStage` props list | T5's JSX passes every prop T4 declares and no other. Consistent. |
| T5 ↔ T5 tests | "landing moves the stage" test drives a poll — the plan says "the way the existing poll tests do" | Not a defect; implementer reads the file. The `await (getStudioLanes…)()` line in that test is a stray and must be replaced by the real poll driver — flagged in the dispatch. |
| T5 page.tsx | `searchParams` is a Promise in Next 16 | Project precedent at `src/app/studio/archive/page.tsx:17`. Consistent. |
| T1 self | test relies on `makeSourceImage` writing a `product` mirror for `backgroundColor` | Plan step 1 tells the implementer to check and fall back to `setPublication`. OK. |
| T4 self | `data-testid` on `next/image` | Plan gives the fallback (wrapper span). OK. |
| T4 self | `lg:w-22` may not exist in Tailwind v4 | Plan gives the fallback (`lg:w-[88px]`). OK. |
| T6 self | docs only | OK. |
| Global constraints | "Do not touch `src/app/design/**`" vs T5 removing the `ImageLightbox` import | T5 removes the IMPORT in studio-client, not the component file (still used by `/design` and `/d`). Consistent. |

Scan clean; no rulings needed before Task 1.

## Progress
Task 1: minor (deferred): no test for a published image with no mirror row / a draft mirror with a backdrop on an unpublished image (studio.integration.test.ts:145-177)
Task 1: minor (deferred): docblock wrap in src/lib/studio.ts ~247-252; count read lacks a one-line comment ~381-388
Task 1: complete (commits 8d962d7..8b9b43d, review clean)
Task 2: ⚠️ resolved — chat_message.created_at is `timestamp_ms` (schema.ts:90), so same-second turns keep order; not a gap
Task 2: minor (deferred): awkward wrapped dynamic import in studio-actions.integration.test.ts ~30-36; no test for anonymous+funnel-off refusal (shared gate)
Task 3: minor (deferred): no tests for newestUnseenCell with empty cells / parseFocus single-element array; two >100-char lines in studio-focus.ts
Task 2: complete (commits 8b9b43d..7a542e8, review clean)
Task 3: complete (commits 7a542e8..317899c, review clean)
Task 4: fix round 1/5 (8 addressed, 0 open — 44px action links; history failed/in-flight/Loading…; faint label class; dead frame p-6; Navy hex test; console.error spy; three new tests; cell guard; commits afc8a3e..5370bf7)
Task 4: ⚠️ carried to Task 5 — key <FocusedStage> by lane.designId so History state resets across conversations; resolveFocus guarantees a valid index; lane.cells is creation order (studio.ts orderBy)
Task 4: complete (commits 317899c..5370bf7, review clean after round 1)
Task 5: Ruling: spendAnchor keeps reference comparison (brief said ids) — the bench's #276 pinned test needs reference identity and a stage submit never spends; ids would break "B refused, then A accepted" — cost if wrong: one comparator.
Task 5: Ruling: seen-cell tracking keyed by conversation, not reset per stage open — the brief's version made initialFocus/Back jump to the newest result — cost: one map.
Task 5: Ruling: a refused stage submit restores its anchor by moving the stage back to the submitted image (replaceState) — same contract as the bench's giveBack ("the chip describes where the words will go") — cost if Nico dislikes the jump: give the words back without the move.
Task 5: Ruling: an unanchored Generate from the stage goes to the bench at submit time (optimistic lane visible at once), not after acceptance — cost: none visible.
Task 5: Ruling: modifier clicks (cmd/ctrl/shift) on stage links and lane titles are left to the browser (new tab), per spec — accepted.
Task 5: minor (deferred): after a refused stage submit, "← Studio" carries that anchor to the bench as a chip; only ✕ / "New design" clears it (same as the old bench chip behaviour).
Task 5: review (Opus) — Important: (1) stale focus on remount after Back from a Next Link navigation (Next's patched pushState skips its URL update when state carries __NA); (2) giveBack writes the bench anchor on the stage. Minors 3 (onSurface by imageId only), 4 (duplicate push), 6 (slack tests), 7 (comment wrap) sent with the fix. Fix round 1 dispatched.
Task 5: minor (deferred, for the smoke): the follow effect moves the stage (and the derived anchor under a typed draft) on ANY landing in the lane, including a result the user navigated away from — spec allows it; Nico to judge on prod.
Task 5: ⚠️ Back from the image detail page into a stage URL needs a real-browser smoke (added to the PR smoke list).
Task 5: fix round 1/5 (6 addressed, 0 open — mount effect reads the URL; giveBack bench-only anchor; onSurface matches designId; no duplicate push; tests re-homed; comment reflow; commits 4dcc773..45cd929)
Task 5: complete (commits 5370bf7..45cd929, review clean after round 1)
Task 6: complete (commits 45cd929..2cbee3d; the brief's second CLAUDE.md anchor no longer existed after #304 — current-state note deferred to the finishing docs touch)
Final review (Opus): needs a fix wave — Important 1 (pushState with window.history.state leaves Next's canonicalUrl stale; a revalidating action snaps the URL back), 2 (Back from a Next Link remounts with page-load lanes; a result that landed after page load fails resolveFocus and the fallback drops the params before the reconcile poll), 3 (lg grid inside max-w-4xl leaves a 200px column). Minors 4–11.
Final: Ruling: follow effect narrowed — the stage follows a landing only while it still shows the image that submit was anchored to — reviewer's finding 4; cost if wrong: one condition.
Final: Ruling: finding 10 (scroll restore on ← Studio; composer focus after New design is effect-driven so iOS keeps the keyboard down) left as is — cost: a later polish PR.
Final: Ruling: finding 8 folded into the fix wave (one GROUP BY for count and first turn) — cheap, same query.
Final: deferred minor struck — "← Studio carries the refused anchor" was fixed in Task 5 round 1.
Final: fix wave dispatched (findings 1–9, 11).
Final: fix wave landed (2cbee3d..f1e1e85). Ruling: a brief bench flash on Back while the confirming poll runs is accepted (alternative: a blank wait) — cost: cosmetic. Ruling: combined chat_message read relies on SQLite's bare-column-with-min() rule, the same rule the first-turn query already relied on — no new risk.
Final: re-review (Opus) — all 10 findings ADDRESSED; gate 2 passed (lint, typecheck, 3790 tests, build, no schema drift).
Final: parked — followFrom keeps only the latest submit (not per job): with edits A (from I) then B (from J) in flight, A landing while J is shown is followed and B is not; also not cleared on refusal or focus change — Ruling: real, rare (two concurrent edits from different images), deferred to a follow-up; keyed-per-job follow is the fix — cost if wrong: one unexpected stage move.
Final: parked — buy-panel.tsx:317/386 still passes window.history.state to replaceState (pre-existing; the same canonicalUrl limit) — Ruling: slice 2 / a small follow-up, out of this branch's fence.
Final: review clean. Branch ready for PR.
