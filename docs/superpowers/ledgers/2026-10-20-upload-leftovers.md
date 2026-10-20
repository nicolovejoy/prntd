# Ledger: upload leftovers (known limits of #357 and #358, #352's Delete wait)

Branch `claude/upload-leftovers` off main `ce44432`. Cloud session; Nico away. Plan `docs/superpowers/plans/2026-10-20-upload-leftovers.md`. Rulings 1 to 4 of `docs/superpowers/specs/2026-10-19-photo-anchor-design.md` (Nico, 2026-10-19) are settled and not reopened here.

Method: one Sonnet implementer per task, each in its own worktree (`.claude/worktrees/ul-t1` … `ul-t6`, branches `claude/ul-t1` … `ul-t6`), merged into this branch by the controller; the controller's gate; one Opus whole-branch review; a fix round; an Opus re-review.

## Controller's rulings (before implementation)

1. **Task 1 needs no question to Nico.** The brief asked to check whether the attach anchor being spent before the photo turn lands means something else should happen. Traced in `src/app/studio/studio-client.tsx` (`runTurn`, `effectiveAnchor`): an unanchored submit always mints a new conversation id (bench, or the stage with its chip cleared), and the bench spends its anchor after an accepted turn (#276). So a turn typed on the bench while the photo turn renders goes to a new lane, as any new idea does; on the stage the shown image (the upload) stays the anchor, so the turn takes the explicit path, which is already a sighted generate. The anchorless-turn-into-the-photo's-conversation case is reached only by a direct `generateDesign` call or a future client. Nothing else should happen; the explicit-anchor rule is applied server-side so the photo is never edited or rendered as lettering whichever client sends the turn.
2. **Task 1, which image is the implicit photo anchor.** The one the `edit` branch already falls back to with no `referenceImage`: the latest non-seed output, else the latest image. When it is an upload, the turn is a generate anchored on it whatever the brief returns, including an `edit` whose `referenceImage` names a generated image. That is the explicit-anchor rule (the anchor wins over the brief's pick); with the photo shown, the system-prompt rule makes the brief choose `generate` anyway.
3. **Task 2 scope.** The new copy and the stay-on-page landing apply to uploads only. A non-upload keeps "You can re-publish it later." and the push to `/designs`, where it is listed. Copy (Claude's, persona C): title "Take this photo down from the storefront?", body "An attached photo can't be published, so this can't be undone."
4. **Task 3.** The parent crumb of an owner's unpublished upload with no recognised `from` is "Studio" pointing at `conversationStudioHref` (the conversation's stage on its primary, else newest result, else the bench). It is not the stage of the upload itself: the brief named `conversationStudioHref`, and it is the rule the bench and the old `/design?id=` redirect already share.
5. **Task 4: leave uploads out of the picker's "My designs" group** (recommended in the brief; chosen). Why: (a) the group is labelled after My Designs, which leaves uploads out since #357, so listing one there contradicts the page it is named after; (b) the group shows each other conversation's primary as that conversation's design, and an upload is an input, not a design (ruling 4); (c) an upload stays reachable where it belongs, under "This design" on its own conversation's page, and from its own image detail page, so ordering a raw upload (allowed by ruling 4) loses no path; (d) the placement guards are unchanged, so an existing cart line or link that pins an upload as a back still validates. Labelling it instead would add a new string and a third kind of tile for a case that arises only when a conversation was started from a photo's page.
6. **Task 5.** `LaneMenu`'s panel closes on any item click, so the busy state cannot live on the Delete menu item. It shows on the lane's "More" trigger ("Checking…", disabled, `aria-busy`), and on the bulk Delete button. Copy (Claude's): "Checking…".
7. **Task 6.** Area cap 1.15 MP on top of the 1568 px long-side cap.

## Task log

Each implementer ran its own targeted tests, typecheck, eslint on its files, and a mutation check (a production line reverted, a new test seen failing, restored).

### Task 1 (`16866ca`)

1. The fallback anchor (latest non-seed output, else latest image) is computed once, above the brief, and the brief-`edit` branch reuses it (`referencedImage ?? fallbackAnchor`). Behaviour for a non-upload fallback is unchanged.
2. `photoAnchor = (explicitAnchor ?? fallbackAnchor)` when it is an upload. Anchorless with a photo fallback: `anchorImageId` = the upload and the turn is a generate through `specForPhotoTurn()`, whatever the brief returned. A `generate` or `clarify` brief on such a turn now records the upload as `anchor_image_id`; before, no anchor was recorded.
3. A brief `edit` whose `referenceImage` names a generated image while the fallback is an upload still renders as a photo generate (ruling 2 above).
4. Left as is: a brief whose `referenceImage` names an upload while the fallback is a generated image. The reference is known only after the brief, so the brief was not shown that photo; the turn renders through `specForPhotoTurn` from the words (slice A's limit, unchanged).
5. Five tests (the plan's four plus a clarify case asserting the question is persisted). Mutation: stashing the production change fails the four anchorless-upload tests; the unchanged-behaviour test passes.

### Task 2 (`e6f4d37`)

1. The non-upload title and body stay inline literals in the component, as before; only the two new strings went into `action-copy.ts`.
2. `UnpublishAction` takes `isUpload` (default false); `OwnerActions` passes it. `page.tsx` already passed `isUpload` to `OwnerActions`.

### Task 3 (`bd49b61`)

1. The crumb is built in `page.tsx`; `nav.ts` logic is unchanged (one docblock paragraph on `detailFrom`). `detailFrom(from, true)` is the recognised `from` or undefined, so it tells "no from" (including unknown or unsafe values) from an explicit one.
2. The lanes read runs only for the owner's unpublished upload with no recognised `from` and a resolving conversation; a throw falls back to the bench (`.catch`), as the page's other optional reads fail open.
3. The HiddenNotice branch is unchanged (it returns before the session read; an upload cannot normally be hidden since it cannot be published).
4. The mobile back arrow and Escape target read the same `trail`/`up`.

### Task 4 (`d3399f2`)

1. Filter in SQL before `GROUP_LIMIT` (left join `image` on the primary; `operation IS NULL OR operation <> 'upload'`), so skipped designs do not use up slots (test: 25 newer upload primaries and one older real design; the real one stays).
2. Left join, not inner: a primary that is a `placement_render` id has no `image` row and stays in, as before; a dangling primary is still dropped by the resolve loop.

### Task 5 (`3af8b7a`)

1. In-flight reads are tracked per key (a lane's `designId`, or `"bulk"`) in a ref (blocks a second tap in the same tick) plus state (drives the render); cleared in a `finally`, success or failure, before the confirm opens. `listingsLeave` returns null when a read for that key is already running and the caller stops.
2. The trigger went from `w-[46px]` to `min-w-[46px]` so "Checking…" can widen it; `min-h-11` and `aria-label="More"` kept. Select all and Done stay enabled during the bulk read.
3. The lane's ignored-second-tap path is guarded by the disabled attribute and the ref; jsdom cannot click a disabled button, so only the bulk second tap is tested.

### Task 6 (`56da5c6`)

1. `briefPhotoSize(w, h)` (exported, pure) computes the target from decoded metadata; sides rounded, floored if rounding breaks a cap. 2048×1536 → 1238×928, 1568×1568 → 1072×1072, 3000×600 → 1568×314.
2. No rotate step: `normalizeReferenceImage` stores uploads with orientation applied and metadata stripped.
3. An existing test fed 3000×2000 and asserted width 1568; that is now area-limited (1313×875) and the test asserts that.
4. Measured, 2048×1536 random noise: base64 1,532,580 → 860,312 characters (about 44% smaller).
5. `getObjectByKey`'s docblock now says: null when the object has no body or the read fails for any reason other than the deadline (logged); throws an Error named `TimeoutError` past the deadline.

### Merge and gate (controller)

One conflict, `src/lib/action-copy.ts` (Tasks 2 and 5 both added a block between `UPLOAD_NOT_PUBLISHABLE` and the `/design entry` section); both kept. Gate on `44c08f1`: lint 0 errors (21 existing warnings), typecheck clean, 268 files / 4214 tests, `db:generate` "No schema changes", build exit 0 with CI's dummy env. Baseline from CLAUDE.md for #358's combined tree: 267 / 4181.

## Opus whole-branch review (head `be9b815`): READY WITH FIXES, seven Minor

Nothing Blocking or Important. The reviewer ran the 23 relevant test files (503 tests), two mutation checks, and read Next's bundled docs for the revalidate question.

Findings and the controller's rulings:

1. **Minor, fixed.** Task 5's bulk "second tap is ignored" assertion could not fail: React drops clicks on a disabled button, so deleting the ref guard in `listingsLeave` left all four #352 tests green. The test now fires both clicks in one `act`.
2. **Minor, fixed.** The busy trigger kept `aria-label="More"`, which hides "Checking…" from screen readers. The label follows the busy state.
3. **Minor, fixed; ruling 2 reversed.** The anchorless-photo override threw away a brief `edit` whose `referenceImage` named a generated image ("make #1 blue" typed while the latest output is a photo) and rendered a photo generate instead. An implicit fallback is not a tap, and an image the brief names has always won over the fallback (`referencedImage ?? fallbackAnchor`). Now such an edit edits the named image; every other brief outcome on an anchorless photo turn is still a photo generate. The system-prompt rule forbids editing the photo, not other images.
4. **Minor, fixed (subject to the implementer's check of Next's docs).** `router.refresh()` after unpublishing a photo is redundant: `unpublishImage` calls `revalidatePath` for the page, and a revalidate inside a server action re-renders the current route in the action's response. Dropped to save a second full render.
5. **Minor, fixed.** Task 3's lanes read ran after the page's other reads, one extra sequential round trip; it now starts in the existing `Promise.all`.
6. **Minor, fixed.** CLAUDE.md still listed what this branch fixes as known limits; updated in this PR. Also the `generateDesign` `opts.anchorImageId` docblock (wrong for uploads since #358) is corrected.
7. **Minor, fixed.** No test pinned an anchorless turn whose only image is a seed upload (a "Start from this image" lane); added.

Checked fine by the reviewer: explicit anchors and non-upload fallbacks unchanged; lineage from the seed-excluding outputs; cost $0.03; `anchor_image_id` written but never read for display; job-id replay check untouched; the photo read inside the lost-submit window; Task 3's catch covers every throw; Task 4's left join on the primary key cannot duplicate rows; Task 5's unmount and poll races behave as on main; Task 6's `metadata()` reads only the header.
