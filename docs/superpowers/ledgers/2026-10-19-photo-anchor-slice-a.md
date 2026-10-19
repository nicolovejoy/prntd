# Ledger: photo anchor slice A (#356)

Branch `claude/photo-anchor-generate`, off main at `3292672`. Cloud session; Nico away. Spec `docs/superpowers/specs/2026-10-19-photo-anchor-design.md`, plan `docs/superpowers/plans/2026-10-19-photo-anchor-slice-a.md`. Rulings 1 to 4 are Nico's (2026-10-19) and settled.

Process: one Sonnet implementer per task in the main checkout, the controller's gate, an Opus whole-branch review, a fix round, the gate again.

## Judgment calls

### Task 1 (`0dbd43a`, Sonnet implementer)

1. Test (e) pins one text block: history `[user "hello"]` + "stylize that design" gives `[image, { text: "hello\n\nstylize that design" }]`. The merge (separator `\n\n`) runs before the image wrap, so the merged string becomes one block.
2. The prompt test asserts the exact phrases `Never emit "edit" for a photo` and `emit "generate"` rather than the plan's looser regex.
3. The wrap applies when the last turn is a string user turn. The synthetic "Generate an image based on this conversation." turn (history ending on assistant with no new words) would also carry the photo. Unreachable from `prepareGeneration`, since `generateDesign` refuses a wordless turn (#349); left as is.
4. Gallery sentence now adds "a photo anchored on this turn is described in a "generate" spec, never edited."
5. Task 1 gate: ai.test.ts 22 passed (17 pre-existing unchanged), typecheck clean, lint 0 errors, full suite 265 files / 4152 tests.
