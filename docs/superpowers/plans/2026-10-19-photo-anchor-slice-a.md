# Photo anchor → sighted Generate (slice A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A turn anchored on an uploaded photo produces a Generate whose spec Claude wrote while looking at the photo; `/v1/edit` is never called with a photo.

**Architecture:** `constructDesignBrief` takes the resolved anchor and, for an upload, sends the photo as an image block in the final user turn with a system-prompt rule that the operation is `generate`. `prepareGeneration` resolves the anchor before the brief call and routes an upload anchor to `{ kind: "generate" }` whatever the brief said, keeping `anchorImageId` for provenance.

**Tech Stack:** Next.js 16 server actions, Anthropic SDK (`anthropic.messages.create`), vitest with the in-memory libSQL harness.

**Spec:** `docs/superpowers/specs/2026-10-19-photo-anchor-design.md` (slice A).

## Global Constraints

- Branch off current `main`; no schema change; `npm run db:generate` must print "No schema changes".
- No new copy string. System-prompt wording: plain, no hyperbole (CLAUDE.md writing style).
- The Anthropic request must still end on a `user` turn.
- Generated and edited anchors behave byte for byte as today: every existing test in `src/app/design/__tests__/explicit-anchor.integration.test.ts` and `src/lib/__tests__/ai.test.ts` keeps passing unchanged.
- Gate before the PR: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` with CI's dummy env block.

## Review Focus

1. A brief that returns `edit` for an upload anchor (the model ignores the rule): the continuation must still produce a generate from `fallbackSpec(userMessage)`. Test in Task 2.
2. A brief-chosen `edit` with no explicit anchor whose fallback anchor is the latest output, and that output is an upload (the user attached, then typed without a tapped cell): must also become a generate. Test in Task 2.
3. A seed-role upload (an image reused from another conversation) anchoring a turn: `operation` is read from the image row, so it routes the same; the provenance code excludes seeds from `parentImageId`, which stays as today. Test in Task 2 (assert parent is null and the job's `anchor_image_id` is the seed).
4. An upload whose R2 URL is unreachable by Anthropic: the SDK call throws, `prepareGeneration` surfaces "Failed to construct prompt" as today; nothing new to build, but the Task 1 test for the message shape must not depend on fetching the URL.
5. Cost: a photo turn must book $0.03. Test in Task 2 (the registry mock returns a fixed cost today; assert `costFor` was called with `kind: "generate"`).

---

### Task 1: the brief sees a photo anchor

**Files:**
- Modify: `src/lib/ai.ts` (`buildMessages`, `constructDesignBrief`, `DESIGN_BRIEF_SYSTEM_PROMPT`)
- Test: `src/lib/__tests__/ai.test.ts`

**Interfaces:**
- Produces: `constructDesignBrief(chatHistory: ChatMessage[], images: DesignImage[], userMessage?: string, anchor?: DesignImage | null): Promise<DesignBrief>`; `buildMessages(chatHistory, images, userMessage?, anchor?)` returns `messages` whose last entry is `{ role: "user", content: string | Array<ImageBlock | TextBlock> }`.

- [ ] **Step 1: Write the failing tests** in `ai.test.ts`, a new `describe("photo anchors (#356)")` using the existing `getMockCreate` harness and `msg` helper:

```ts
it("sends the photo as an image block before the text when the anchor is an upload", async () => {
  const anchor: DesignImage = { id: "up1", number: 1, url: "https://r2/images/up1.png", prompt: "IMG_0238.jpeg", operation: "upload", role: "output" } as DesignImage;
  await constructDesignBrief([], [anchor], "stylize that design", anchor);
  const call = (await getMockCreate()).mock.calls[0][0];
  const last = call.messages[call.messages.length - 1];
  expect(last.role).toBe("user");
  expect(last.content).toEqual([
    { type: "image", source: { type: "url", url: "https://r2/images/up1.png" } },
    { type: "text", text: "stylize that design" },
  ]);
});
it("keeps a plain string turn when the anchor is a generated image", ...)  // content === "make it blue"
it("keeps a plain string turn when there is no anchor", ...)
it("tells the model a photo turn is always a generate", async () => {
  expect(DESIGN_BRIEF_SYSTEM_PROMPT).toMatch(/photo/i);
  expect(DESIGN_BRIEF_SYSTEM_PROMPT).toMatch(/never .*"edit".* photo|photo.*always.*"generate"/i);
});
```

The merge of consecutive same-role messages concatenates strings; with an array content the merge must prepend the earlier string as a text block, so add: `it("merges a trailing user history row into the photo turn as a text block")` where history ends with `msg("user", "hello")` and the result's content is `[image, { type: "text", text: "hello\n\nstylize that design" }]` (or two text blocks; pick one and pin it).

- [ ] **Step 2: Run** `npx vitest run src/lib/__tests__/ai.test.ts -t "photo anchors"` → FAIL (4th parameter ignored, content is a string).
- [ ] **Step 3: Implement.** Add the `anchor` parameter to both functions; in `buildMessages`, after the merge and the trailing-user guard, when `anchor?.operation === "upload"` and the last message is a user turn, replace its `content` with `[imageBlock(anchor.url), { type: "text", text: <the string> }]`. Type the message array as `Anthropic.MessageParam[]`. Add the rule to the system prompt under "Choosing the operation", one bullet, e.g.: `- A photo the user attached to this turn is never edited: emit "generate" and write a spec that describes what is in the photo (subject, composition, what to keep) in the style the user asked for, as a cut-out shirt graphic with no background. Never emit "edit" for a photo.` Update the gallery-context sentence about `[user upload]` to say the same in one clause.
- [ ] **Step 4: Run** the whole file → PASS, every pre-existing test unchanged.
- [ ] **Step 5: Commit** `feat(brief): a photo anchor is sent to Claude as an image and briefed as a generate (#356)`.

### Task 2: the continuation routes an upload anchor to generate

**Files:**
- Modify: `src/app/design/actions.ts` (`prepareGeneration`: brief call, explicit-anchor branch, brief-`edit` branch; the provenance comment near `anchorOutput`)
- Test: `src/app/design/__tests__/explicit-anchor.integration.test.ts` (new `describe("upload anchors (#356)")`; the file's mocks and `seedDesign`, `jobs`, `expectQueued`, `drainAfter` helpers are reused)

**Interfaces:**
- Consumes: Task 1's `constructDesignBrief(..., anchor)`.
- Produces: no new exports. The `image_generation` row for a photo turn has `operation = "generate"` and `anchor_image_id = <upload id>`.

- [ ] **Step 1: Write the failing tests.** `makeSourceImage` has no `operation` parameter; add `operation?: ImageOperation | null` to the factory (`src/lib/__tests__/factories.ts`, default `null` as today) in this task. Tests:

```ts
it("an explicit upload anchor becomes a generate from the brief's spec, cost generate, anchor kept", async () => {
  // brief mock returns operation "generate" with spec S (file default)
  const uploadId = await makeSourceImage(testDb, { designId, ownerId: "u1", imageUrl: "https://r2/photo.png", operation: "upload" });
  const result = expectQueued(await generateDesign(designId, "stylize that design", { anchorImageId: uploadId }));
  const [job] = await jobs(designId);
  expect(job.operation).toBe("generate");
  expect(job.anchorImageId).toBe(uploadId);
  await drainAfter();
  expect(ideogramGen).toHaveBeenCalledWith({ kind: "generate", spec: expect.objectContaining({ subject: "a happy cat" }) }, { aspect: "1:1" });
  expect(ideogramGen).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "edit" }), expect.anything());
  // parent lineage: the upload is an output, so it is the parent
  const [row] = await testDb.select().from(schema.image).where(eq(schema.image.id, result.imageId));
  expect(row.parentImageId).toBe(uploadId);
});
it("passes the upload anchor to the brief", ...) // constructDesignBrief mock's 4th arg has id uploadId and operation "upload"
it("a brief that says edit for an upload anchor still generates, from the user's words", ...) // brief mock → { operation: "edit", editInstruction: "stylize", referenceImage: 1 }; job.operation "generate"; ideogramGen called with kind "generate" and spec whose text/subject contains "stylize that design" (fallbackSpec's shape: read src/lib/design-spec.ts and assert the field it fills)
it("an anchorless edit whose latest output is an upload also generates", ...) // no anchorImageId; latest output is the upload; brief → edit; job.operation "generate", job.anchorImageId uploadId
it("a generated anchor still edits (unchanged)", ...) // operation "generate" image + explicit anchor → job.operation "edit"
```

- [ ] **Step 2: Run** `npx vitest run src/app/design/__tests__/explicit-anchor.integration.test.ts -t "upload anchors"` → FAIL (operation is "edit").
- [ ] **Step 3: Implement.** In `prepareGeneration`: find `explicitAnchor` from `images` before the brief call (move the lookup and the "not part of this conversation" throw up; the hidden-anchor refusal that exists today must keep its position relative to any row write, read the surrounding comments). Call `constructDesignBrief(messagesForPrompt, images, userMessage, explicitAnchor ?? null)`. Add a local `function specForPhotoTurn(): DesignSpec` that returns `brief.spec` when `brief.operation === "generate"` else `fallbackSpec(userMessage.trim())` (throw `"Photo turn reached with no user words"` if null, mirroring the clarify branch). In the explicit-anchor branch and in the brief-`edit` branch's `anchor` resolution: when the anchor's `operation === "upload"`, set `anchorImageId = anchor.id` and `generateOp = { kind: "generate", spec: specForPhotoTurn() }`. Update the explicit-anchor comment ("never downgrades the turn to a from-scratch generate") to name the one exception and why. Update the provenance comment near `anchorOutput` to say an upload anchor of a generate records the upload as parent.
- [ ] **Step 4: Run** the file, then `npm test` → PASS.
- [ ] **Step 5: Commit** `feat(generate): a turn anchored on an uploaded photo renders as a generate, never an edit (#356)`.

### Task 3: gate, review, PR

- [ ] Run the gate (Global Constraints). Record file and test counts.
- [ ] Opus whole-branch review (CLAUDE.md "PRs, agents, and review"); fix round; re-run the gate.
- [ ] PR body: the four rulings, what changed, the known limit (fallback when Claude fails), the gate numbers, and one smoke for prntd.org after merge: on https://prntd.org/studio attach a landscape photo, type "stylize that design"; PASS: a cut-out design of the photo's subject appears in the lane (not a fragment of it); then with no anchor type "make it bolder"; PASS: the new result is an edit of the design, not of the photo. `Closes #356`.
