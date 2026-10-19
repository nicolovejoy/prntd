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

### Task 2 (`00cfa9a`, Sonnet implementer)

1. The explicit-anchor lookup and its "not part of this conversation" throw moved above `constructDesignBrief`, still before any row write and inside the caller's direct-refund span. The hidden-anchor refusal is unchanged: `getDesignImagesForAIContext` leaves hidden images out, so a hidden id fails the same lookup.
2. `specForPhotoTurn()` returns the brief's spec for a `generate` brief, else `fallbackSpec(userMessage.trim())` for both `edit` and `clarify` (clarify has no spec; matches the existing clarify branch).
3. Anchorless turn whose brief says `edit` and whose fallback anchor is an upload: the anchor is chosen after the brief, so the brief was not shown the photo and the user's words render alone. This is the plan's behaviour. It is rare: an attach anchors the composer to the upload, so the usual photo turn takes the explicit path, where the brief sees the photo.
4. The seed-upload test reaches the seed through an explicit anchor, not a brief `referenceImage`.
5. The test registry mock's `costFor` became `vi.fn(() => 0.03)` so the cost test can read its argument; other tests are unaffected.
6. `brief` got an explicit type because the new closure made it implicitly `any`.
7. Gate on `00cfa9a` (controller, main checkout): lint 0 errors (21 existing warnings), typecheck clean, 265 files / 4159 tests, `db:generate` "No schema changes", build exit 0 with CI's dummy env.
