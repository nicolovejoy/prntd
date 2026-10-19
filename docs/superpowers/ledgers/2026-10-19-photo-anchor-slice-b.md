# Ledger: photo anchor slice B, uploads are inputs (#355)

Branch `claude/uploads-are-inputs` off main `3292672`. Cloud session; Nico away. Spec `docs/superpowers/specs/2026-10-19-photo-anchor-design.md`, plan `docs/superpowers/plans/2026-10-19-photo-anchor-slice-b.md`. Slice A (#356) is built in another session on `src/lib/ai.ts`, `src/app/design/actions.ts`, `src/lib/image-provenance.ts`, `src/lib/__tests__/factories.ts`; this branch does not touch them.

Method: one Sonnet implementer per task on the branch in the main checkout (tasks are sequential), the controller re-runs the gate itself, one Opus whole-branch review, a fix round, a gate re-run.

## Rulings and decisions

1. **`isUpload` prop instead of the plan's `canPublish` expression.** The plan says `canPublish={isLoggedIn && img.operation !== "upload"}`. `PublishCta` renders the guest prompt ("Sign up to publish. Have an account? Sign in.") whenever `canPublish` is false, so a signed-in owner of an upload would have been told to sign up. `OwnerActions` takes an optional `isUpload` (default false); when true the row shows "Not published" and renders no `PublishCta`. `canPublish={isLoggedIn}` is unchanged. Decided by the Task 2 implementer, confirmed by the controller from the diff.
2. **Page-level test.** No existing test rendered the real owner row (`owner-order-page.test.tsx` stubs `OwnerActions`; `owner-actions.test.tsx` passes `canPublish` directly). Task 2 added `src/app/d/[imageId]/__tests__/upload-owner-row.test.tsx`, copying `owner-order-page.test.tsx`'s harness, rendering the real page, `OwnerActions`, `PublishCta` and `BuyHero`.
3. **Thrown message not shown in production.** `publish-modal.tsx` prints `err.message`, but Next masks server-action messages in production, so the upload line reaches only a direct caller. Acceptable per the plan: the control is hidden for uploads.
4. **Export route** reads `exportPartCount(rows.length)` from `loadExportRows` itself, not from the library's count, so no route change; parity holds because both readers share the filters (Review Focus 5).
5. **Seeding without the factory.** `makeSourceImage`, then `update image set operation = 'upload'`; the factory's NULL operation serves as the legacy-row case.

Baseline on main `3292672` before any change: 265 files / 4149 tests.

## Task log

- Task 1 `4f48a60`: both readers filter `or(isNull(operation), ne(operation, 'upload'))`; two tests (library; export parity against the real library output).
- Task 2 `3a8e1ac`: `UPLOAD_NOT_PUBLISHABLE`, `publishImage` refusal after ownership and before hidden, `ImagePage.operation`, `OwnerActions.isUpload`; three publish-gate tests and four page-row tests.

## Review (Opus, whole branch, `9712c58`): READY WITH FIXES

Nothing Blocking. The reviewer reverted each production hunk in a scratch copy and saw a test fail for each, except `getImagePage`'s `operation` (see 2). Hostile values (NULL, "", "UPLOAD", "upload ", other operations) behaved the same in both readers, same ids in reverse order, same part count.

Findings and rulings (controller):
1. **Important, not fixed in code, handed to Nico.** Uploads written before migration 0012 (2026-09-04, `operation` added nullable, no backfill) have `operation IS NULL`; `/design`'s old upload and `scripts/migrate-chat-history-to-table.ts` wrote `prompt` starting `[user upload]`. Every new check reads NULL as "not an upload", so such a photo stays on My Designs and the zip and can still be published. Widening four checks to a prompt-string rule was rejected; a one-off data UPDATE is the smaller change. Whether any such rows exist in Production cannot be read from this session. The PR body carries the count query and the UPDATE for Nico to run on prod, preview and dev; it is a data change, so it is his call.
2. **Important, fixed.** `getImagePage`'s `operation` had no test (replacing it with `null` passed every test). Added `getImagePage carries the image's operation (#355)` in `image-visibility-one-reader.integration.test.ts`; fails when the mapping is reverted.
3. **Minor, not fixed (scope).** The Un-publish confirm on a published upload says "You can re-publish it later." and then sends the owner to My Designs, which no longer lists the photo. Only reachable for an upload published before #355. Named in the PR body.
4. **Minor, not fixed.** An unpublished upload's page without `from` shows "My Designs" as its breadcrumb parent. Cosmetic. Named in the PR body.
5. **Minor, fixed.** Stale comments in `src/lib/user-designs.ts` ("Beyond those two") and the `src/app/designs/page.tsx` docblock (export and library parity claim).
6. **Minor, fixed.** Added a library test for an upload with a publication row (Review Focus 1). The export parity test compares sorted ids; order parity is covered by the existing reverse-order test and the shared predicate.
7. **Minor, not fixed (out of scope).** An upload in a conversation, or made the conversation's primary, can be picked as a back design under the "My designs" label. Allowed by ruling 4 (an upload may be ordered). Named in the PR body.

Both added tests fail when their production line is reverted (checked by hand with `sed` and restore).
