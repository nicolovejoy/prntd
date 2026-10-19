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

### Opus whole-branch review (head `00cfa9a`): NOT READY, one Blocking, six Minor

1. **Blocking: image size.** `normalizeReferenceImage` stores uploads as lossless PNG up to 2048 px; the reviewer measured photo-like 2048×1536 images at 4.95 to 6.06 MB as PNG, over Anthropic's 5 MB per-image limit, so the URL image block would 400 and every photo turn would fail ("Failed to construct prompt", refunded). The plan's Review Focus 4 treated an unreachable URL as rare; this is the common case and invisible under the mocked SDK. **Controller's call:** fix it in this PR (the slice does not work without it) by reading the object from R2 and sending a 1568 px JPEG q85 as a base64 source (`src/lib/brief-photo.ts`). 1568 px is Anthropic's own resize target, so nothing the model would see is lost. The R2 read is bounded at 5 s because the brief call's 45 s timeout sits inside the 60 s lost-submit window. A failed read sends the brief on words alone and the turn still renders as a generate: the spec's accepted limit, extended from "Claude fails" to "the photo could not be read". The reviewer's option (b), retrying the brief without the image on a 400, was not built: once the size is bounded, a retry would double the worst-case brief time past the lost-submit window. `constructDesignBrief`'s 4th parameter becomes the prepared photo rather than the anchor `DesignImage` (a departure from the spec's signature; same behaviour).
2. Minor: duplicated "No readiness pre-check" comment. Fixed.
3. Minor: the parent assertions could not catch a regression (the upload was the only output). Strengthened with a newer output.
4. Minor: an anchorless turn sent while the photo turn is still rendering resolves to the upload as latest output; the brief says `edit`, so `fallbackSpec` renders the words as lettering. Not changed; listed as a known limit in the PR.
5. Minor: the gallery sentence added in Task 1 went on every turn with an upload in the gallery and could stop the model from editing a later design that names the upload. Reverted to main's text; the system-prompt rule covers the attached-photo case.
6. Minor: the brief call now processes an image (about 1.6k tokens) inside the same timeout. Noted in the PR.
7. Minor: docs (ledger, CLAUDE.md Core loop and Current state). Done by the controller.

### Fix round (`67ecfd0`, Sonnet implementer)

1. `REFERENCE_IMAGE_MAX_PIXELS` is now exported from `src/lib/reference-image.ts` and reused as `limitInputPixels` in `loadBriefPhoto` (plus `animated: false`), not copied.
2. sharp is imported lazily inside `loadBriefPhoto`, as `reference-image.ts` does.
3. The photo is loaded outside the brief's try/catch (it never throws), after the anchor lookup and before any row write.
4. The system-prompt rule now reads "A photo shown to you in the user's message is never edited…", since the photo arrives as an image block rather than as something "attached".
5. Seed-upload provenance: with an output present, the parent is the latest non-seed output (the code's existing rule for seed anchors), never the seed. The test asserts that; the comment in `runGenerationJob` says it.
6. Mutation checks: breaking the anchor-parent lookup fails the strengthened upload test; counting seeds as outputs fails the seed test.
7. Gate on `67ecfd0` (controller): lint 0 errors (21 existing warnings), typecheck clean, 266 files / 4170 tests, `db:generate` "No schema changes", build exit 0.

### Opus re-review of `67ecfd0`: READY WITH FIXES, five Minor

Every finding of the first review checked fixed. Worst case measured with true noise: 1568×1568 gives 2.34 MB of base64, under 5 MB however Anthropic counts it. The block shape matches `Base64ImageSource` in @anthropic-ai/sdk 0.80.0. No e2e spec generates after an attach.

1. `src/lib/lost-submit.ts` docblocks were stale (the photo read adds up to 5 s before the job row; the Turso-stall margin drops from about 15 s to about 10 s). Fixed by the controller.
2. The size test's patterned noise compressed to 224 KB as PNG, so it could not fail. Now 2048×2048 `randomBytes` noise (over 5 MB as PNG, asserted), with the base64 length checked; a mutation that keeps PNG output at 2048 px fails it. Fixed by the controller.
3. Fitting the JPEG to about 1.15 MP (Anthropic's own downscale target for this model) would cut the upload by 40 to 50% with no change in what the model sees. Not built: the payload is already bounded, and it is an optimisation.
4. A URL with no derivable R2 key (a changed public base) returned null silently. Now logged. Fixed by the controller.
5. `getObjectByKey`'s docblock says "null on any failure" though it throws on timeout. Predates the branch; left.

Final gate (controller): lint 0 errors (21 existing warnings), typecheck clean, 266 files / 4170 tests, `db:generate` "No schema changes", build exit 0 with CI's dummy env.
