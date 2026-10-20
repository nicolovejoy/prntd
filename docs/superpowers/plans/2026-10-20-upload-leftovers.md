# Upload leftovers (known limits of #357 and #358, plus #352's Delete wait)

Branch `claude/upload-leftovers` off main `ce44432`. Cloud session; Nico away. Spec context: `docs/superpowers/specs/2026-10-19-photo-anchor-design.md` (rulings 1 to 4, Nico, 2026-10-19). Ledger: `docs/superpowers/ledgers/2026-10-20-upload-leftovers.md`.

No schema change. No price strings. Every new string goes in `src/lib/action-copy.ts`. Persona C copy (neutral, no "we", no whimsy).

Method: one Sonnet implementer per task, each in its own worktree off this branch; the controller merges, runs the gate (lint, typecheck, test, `db:generate` drift, build with CI's dummy env), one Opus whole-branch review, a fix round, a re-review.

## Task 1: an anchorless turn on a photo is a sighted generate

File: `src/app/design/actions.ts` (`prepareGeneration`), tests in `src/app/design/__tests__/` (find the slice A tests for the explicit upload anchor and extend beside them).

Today the brief is shown the photo only for an explicit upload anchor. An anchorless turn whose fallback anchor (the image the `edit` branch would land on with no `referenceImage`: the latest non-seed output, else the latest image) is an upload gets a brief written without the photo, and renders the user's words through `fallbackSpec` (or the brief's own `generate` spec, with no anchor recorded).

Change: resolve the implicit photo anchor before the brief. When there is no explicit anchor and that fallback image has `operation === "upload"`, treat it exactly as an explicit upload anchor: `loadBriefPhoto` it, pass the photo to `constructDesignBrief`, and whatever the brief returns (`generate`, `edit` with or without a `referenceImage`, `clarify`) the turn is `{ kind: "generate", spec: specForPhotoTurn() }` with `anchorImageId` = the upload. A clarify brief's question still rides along as today (check how the clarify message is persisted for the explicit path and keep the same behaviour). Explicit anchors, and anchorless turns whose fallback image is not an upload, are unchanged byte for byte.

Reachability, for the docblock: the Studio never sends an anchorless turn into an existing conversation (an unanchored bench or stage submit mints a new conversation id; the bench spends its anchor after an accepted turn, #276), so this path is reached by a direct `generateDesign` call or a future client. The rule is applied server-side so the photo is never edited and never rendered as lettering whichever client sends the turn.

Tests: (a) anchorless turn, latest output an upload, brief `generate` → generate with the brief's spec, `anchorImageId` = upload, photo passed to the brief (assert the 4th argument), cost from a generate; (b) same with brief `edit` (and a `referenceImage` pointing at a generated image) → generate from `fallbackSpec(words)`, anchor = upload, `/v1/edit` never called; (c) anchorless, latest output a generated image (not upload) while an older upload exists → unchanged (no photo loaded, edit of the latest output); (d) `loadBriefPhoto` returns null → still a generate anchored on the upload. Mutation-check one of them by hand.

## Task 2: Un-publish confirm on an upload

Files: `src/app/d/[imageId]/unpublish-action.tsx`, `src/app/d/[imageId]/owner-actions.tsx` (pass `isUpload` to `UnpublishAction`), `src/lib/action-copy.ts`, tests in `src/app/d/[imageId]/__tests__/unpublish-action.test.tsx` and `owner-actions.test.tsx`.

For an upload (only reachable for one published before #357): confirm title `UNPUBLISH_UPLOAD_TITLE = "Take this photo down from the storefront?"`, body `UNPUBLISH_UPLOAD_BODY = "An attached photo can't be published, so this can't be undone."`, confirm label unchanged ("Un-publish"). After the action the owner stays on the image detail page (`router.refresh()`), which then shows "Not published" with no Publish control. Non-uploads keep today's copy and the push to `/designs` unchanged. Put the two strings in action-copy.ts directly under `UPLOAD_NOT_PUBLISHABLE`.

## Task 3: breadcrumb parent of an unpublished upload

Files: `src/app/d/[imageId]/page.tsx`, possibly `src/lib/nav.ts` (`breadcrumbTrail` / `detailFrom`), tests in `src/lib/__tests__/nav.test.ts` and a page-level test (copy the harness of `src/app/d/[imageId]/__tests__/upload-owner-row.test.tsx`).

When the viewer owns an unpublished upload and the page has no recognised `from` (`detailFrom` would fall back to `/designs`), the parent crumb is `{ label: "Studio", href: await conversationStudioHref(viewerId, img.sourceDesignId) }` (`src/lib/studio-entry.ts`): the conversation's stage, or `/studio` (the bench) when it has no stage or the image has no source conversation. An explicit recognised `from` still wins. Published uploads and every non-upload page are unchanged. The `from` passed on to the buy panel (`from={from}` further down) is not changed. Read `conversationStudioHref` only on that one branch (it reads the viewer's lanes). Keep `nav.ts` pure: pass the href in rather than reading inside it.

## Task 4: the back-design picker leaves uploads out of "My designs"

File: `src/lib/back-sources.ts` (`getOtherDesignPrimaries`), test in `src/lib/__tests__/back-sources.integration.test.ts`.

Ruling (controller, recommended): leave uploads out of the "My designs" group. A conversation whose primary is an upload (a conversation started from the photo's page, "Start from this image") contributes nothing to the group, as a hidden primary does today. "This design" is unchanged: an upload in the page's own conversation stays pickable there. `canUseAsPlacementSource` / `assertUsablePlacementImage` are unchanged, so an existing cart line or link that pins an upload as a back still validates (ruling 4: an upload may be ordered). Filter in the query the way `getUserImageLibrary` does (`operation IS NULL OR operation <> 'upload'`, legacy NULL rows stay), or on the resolved rows if `resolveImagesByIds` carries `operation`; whichever, a NULL operation stays in.

## Task 5: a busy state on the Studio's Delete

File: `src/app/studio/studio-client.tsx`, `src/lib/action-copy.ts`, tests in `src/app/studio/__tests__/`.

`deleteLane` and `bulkDelete` await `shopListingsLeaveOnDelete` (via `listingsLeave`) before the confirm opens, with nothing on screen. The lane Delete is a `menuitem` inside `LaneMenu`, whose panel closes on any item click, so the busy state cannot live on the menu item. Show it on the lane: while that lane's read is in flight, the lane's "More" trigger is disabled with `aria-busy="true"` and shows the text `STUDIO_DELETE_CHECKING = "Checking…"` in place of the three dots (keep the 44 px target; the text may widen the trigger). A second Delete on the same lane is ignored while it reads. The bulk Delete button shows the same string, disabled, `aria-busy`, while its read is in flight, and a second tap is ignored. The busy state clears when the read settles, before or as the confirm opens, including when the read fails (`listingsLeave` already returns false on a throw). Put the string in action-copy.ts in a new `// --- Studio delete (#352) ---` section after the attach section. Tests: a deferred `shopListingsLeaveOnDelete` mock; while unresolved the trigger / button is busy and disabled with the string; after it resolves the confirm opens and the busy state is gone; a failed read clears it too.

## Task 6: brief JPEG fit to about 1.15 MP; stale docblock

Files: `src/lib/brief-photo.ts`, `src/lib/r2.ts`, test `src/lib/__tests__/brief-photo.test.ts`.

1. Keep the 1568 px long-side cap and also cap the area at about 1.15 MP (`BRIEF_PHOTO_MAX_PIXELS = 1_150_000`): compute the target width and height from the decoded metadata so that `w × h ≤ 1.15 M` and `max(w, h) ≤ 1568`, aspect kept, never enlarged. A 2048×1536 photo comes out about 1238×928; a 1568×1568 square about 1072×1072; a 3000×600 panorama 1568×314. Test the output dimensions for those three plus a small image (unchanged), and keep the existing size test passing.
2. `getObjectByKey`'s docblock in `src/lib/r2.ts` says "or null on any failure" but it throws a TimeoutError past the deadline (and lets other errors through? read the function and describe what it actually does). Rewrite the sentence to match the code. No behaviour change.
