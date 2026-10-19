# Uploads are inputs (slice B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An uploaded photo (`image.operation = "upload"`) is left out of My Designs and the zip export, cannot be published, keeps Order, and stays visible inside its conversation.

**Architecture:** Two readers gain one `where` clause each; `publishImage` gains one refusal with a new copy string; the image detail page reads `operation` and withholds the Publish control for an upload.

**Tech Stack:** Drizzle on libSQL, Next.js 16 server actions, vitest in-memory libSQL harness.

**Spec:** `docs/superpowers/specs/2026-10-19-photo-anchor-design.md` (slice B and ruling 4).

## Global Constraints

- Branch off current `main`; no schema change; `npm run db:generate` must print "No schema changes".
- One new string, in `src/lib/action-copy.ts`: `UPLOAD_NOT_PUBLISHABLE = "Attached photos can't be published. Publish a design made from one instead."` Persona C: plain, no whimsy, no "we".
- Order on an upload's image detail page is unchanged. The upload stays in Studio lane cells, the focused stage and history (nothing in `src/app/studio/**` or `src/lib/design-images.ts` changes).
- Gate before the PR: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` with CI's dummy env block.

## Review Focus

1. A published upload that already exists in Production (possible before this PR): `getUserImageLibrary` drops it, so its owner loses the My Designs tile but it stays in the Shop; `unpublishImage` from its image detail page must still work. Test in Task 2: an upload with a publication row is left out of the library; `unpublishImage` on it succeeds.
2. Export parity: the export computes parts from the library's row count. Test in Task 1 that both readers return the same ids for a user with uploads mixed in.
3. A guest (anonymous) owner of an upload: `publishImage` already refuses guests first; the upload refusal must come after ownership and before the hidden check so the error a real owner sees is the upload line, not "This image is not available". Test in Task 2 with an upload that is also admin-hidden: the upload message wins.
4. The hidden-image owner page (`HiddenImagePage`) has no Publish control; `operation` on `ImagePage` must not break that branch (typecheck covers it).
5. Export route `part` computation in `src/app/designs/export/route.ts` uses `exportPartCount(rows.length)` from the library; confirm it reads the filtered count, not a separate one.

---

### Task 1: My Designs and the export leave uploads out

**Files:**
- Modify: `src/lib/user-designs.ts` (`getUserImageLibrary` where clause), `src/lib/design-export.ts` (`loadExportRows` where clause and docblock)
- Do NOT modify `src/lib/__tests__/factories.ts` (slice A, built in parallel, adds an `operation` parameter there; touching it here would conflict). Make an upload row with `makeSourceImage` then `testDb.update(schema.image).set({ operation: "upload" }).where(eq(schema.image.id, id))`.
- Test: `src/lib/__tests__/user-designs.integration.test.ts`, `src/app/designs/__tests__/export-route.integration.test.ts`

- [ ] **Step 1: Write the failing tests.** In `user-designs.integration.test.ts`: `it("leaves an uploaded photo out (#355)")`: seed one generate image and one `operation: "upload"` image for the user; expect the library to hold exactly the generate's id. In `export-route.integration.test.ts`: `it("exports the same rows My Designs lists, uploads left out (#355)")`: same seed; assert the zip's entries (or `loadExportRows`'s ids) equal the library's ids.
- [ ] **Step 2: Run** both files with `-t "#355"` → FAIL.
- [ ] **Step 3: Implement.** Add `or(isNull(imageTable.operation), ne(imageTable.operation, "upload"))` to both `where` clauses (legacy rows have null operation and must stay). Extend the `loadExportRows` docblock sentence "the same hidden filter" to name the upload filter too.
- [ ] **Step 4: Run** both files → PASS; `npm test` → PASS.
- [ ] **Step 5: Commit** `feat(designs): My Designs and the export leave uploaded photos out (#355)`.

### Task 2: an upload cannot be published

**Files:**
- Modify: `src/lib/action-copy.ts` (new string), `src/app/designs/actions.ts` (`publishImage`: select `operation`, refuse), `src/app/d/actions.ts` (`getImagePage` selects `operation`; `ImagePage` carries `operation: ImageOperation | null`), `src/app/d/[imageId]/page.tsx` (`canPublish={isLoggedIn && img.operation !== "upload"}`)
- Test: `src/app/designs/__tests__/publish-gate.integration.test.ts`, `src/app/d/__tests__/` (the page test that renders `OwnerActions`; find the one that asserts the Publish control for an owner and add the upload case)

**Interfaces:**
- Produces: `UPLOAD_NOT_PUBLISHABLE` exported from `src/lib/action-copy.ts`; `ImagePage.operation`.

- [ ] **Step 1: Write the failing tests.** In `publish-gate.integration.test.ts`: `it("refuses an uploaded photo with the upload line (#355)")`: owner, real account, `operation: "upload"`; `await expect(publishImage(id)).rejects.toThrow(UPLOAD_NOT_PUBLISHABLE)`; no publication row written. `it("the upload line wins over the hidden line")`: upload that is also `isHidden: true`; same expectation. `it("unpublishImage still works on an upload published before #355")`: upload with `publishedAt`; `unpublishImage(id)` resolves and the publication row is gone. Page test: owner, signed in, image `operation: "upload"`: the Publish control is absent and "Not published" and the Order control are present.
- [ ] **Step 2: Run** with `-t "#355"` → FAIL.
- [ ] **Step 3: Implement** per Files. In `publishImage` the refusal goes right after `if (image.ownerId !== session.user.id)` and before `isImageAdminHidden`: `if (image.operation === "upload") throw new Error(UPLOAD_NOT_PUBLISHABLE)`. Check how `PublishCta` renders a thrown action error (it may show a generic line); if it swallows the message, that is acceptable because the control is hidden for uploads anyway, and say so in the PR body.
- [ ] **Step 4: Run** the files, then `npm test` and `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(publish): an uploaded photo cannot be published; its page shows no Publish (#355)`.

### Task 3: gate, review, PR

- [ ] Run the gate (Global Constraints). Record file and test counts.
- [ ] Opus whole-branch review; fix round; re-run the gate.
- [ ] PR body: ruling 4 and the "input, not a design" rule, the Production note (an upload published before this PR stays in the Shop until its owner unpublishes it from its image detail page; a read of how many such rows exist is one SQL line for Nico, `select count(*) from image i join image_publication p on p.image_id = i.id where i.operation = 'upload'`), the gate numbers, and one smoke for prntd.org after merge: on https://prntd.org/studio attach any photo; open https://prntd.org/designs; PASS: the photo is not listed; open the photo from its Studio lane cell (its image detail page); PASS: Order is present, Publish is absent, "Not published" shows. `Closes #355`.
