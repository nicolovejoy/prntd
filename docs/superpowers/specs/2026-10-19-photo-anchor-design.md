# Photo anchors: a sighted Generate, and uploads as inputs (#356, #355)

Status: approved by Nico 2026-10-19 (four rulings below). Two independent slices, one PR each.

## Why

A photo attached in the Studio becomes an `image` row with `operation = "upload"`, linked to its conversation as an `output`, and the composer anchors to it. An explicit anchor is deterministic: the generation continuation (`prepareGeneration` in `src/app/design/actions.ts`) always builds an `edit` and "never downgrades the turn to a from-scratch generate". The edit path (`editTransparent`, `src/lib/ideogram.ts`) posts the stored PNG to Ideogram `/v1/edit` with `transparent_background: true`. That endpoint refines Ideogram's own cut-out designs. Handed a landscape photo and told to return a cut-out, it kept the one sticker-shaped element and dropped the rest: Nico attached a river scene (a stone mill, trees, a weir of square stepping stones) and asked to "stylize that design"; the result was a pencil drawing of a checkerboard (#356, 2026-10-19).

The brief-writer (`constructDesignBrief`, `src/lib/ai.ts`) sees text only. Its gallery line calls the image `[user upload]` and its system prompt says uploads are "style/content inspiration". Claude looks at an image today only in `generateOrderName` and `generatePublishedNaming`, both of which pass `{ type: "image", source: { type: "url", url } }`.

A raw upload also appears on My Designs as one of the user's designs, can be exported in the zip, and can be published to the Shop (#355; the question left on #342 in 2026-10-15 was never answered).

## Rulings (Nico, 2026-10-19; each was Claude's recommendation)

1. A design made from a photo is an **interpretation** of it in the requested style, not a transformation of the photo's pixels.
2. It is **always a cut-out** (transparent background, placed on the garment). No rectangular photo prints.
3. **Follow-up turns edit the design as usual.** The photo was the seed and is done; later turns do not re-read it.
4. A raw upload **may be ordered and may not be published.** Printing your own photo on your own shirt is fine; publishing a photo to the Shop raises rights questions a generated design does not.

Also (#355): a raw upload is an input, not a design. It does not appear on My Designs or in the zip export. It stays visible inside its conversation (Studio lane cell, focused stage, history), and its image detail page keeps Order.

## Slice A: a photo anchor becomes a sighted Generate (closes #356)

When the anchor of a turn is an upload, Claude sees the photo and writes a `generate` spec that describes the subject and composition in the requested style, and Ideogram's generate endpoint renders it. `/v1/edit` is never called with a photo anchor. Anchors that are generated or edited images behave exactly as today.

- `constructDesignBrief(chatHistory, images, userMessage, anchor?)` gains an optional fourth parameter, the anchor `DesignImage` resolved by the caller. When `anchor.operation === "upload"`, `buildMessages` makes the final user turn a content array: the image block (URL source, the anchor's `url`) first, then the text. The conversation still ends on a user turn.
- `DESIGN_BRIEF_SYSTEM_PROMPT` gains one rule under "Choosing the operation": when the user's photo is attached to this turn, the operation is `generate`; describe what is in the photo (subject, composition, what to keep) in the style the user asked for, as a cut-out shirt graphic with no background; never emit `edit` for a photo.
- In `prepareGeneration`, the explicit anchor is resolved before the brief call (it is found from `images` today, after it) and passed to `constructDesignBrief`. If the resolved anchor (explicit, or the one the brief-chosen `edit` branch lands on) has `operation === "upload"`: `generateOp = { kind: "generate", spec }` with the brief's spec when `brief.operation === "generate"`, else `fallbackSpec(userMessage.trim())`. `anchorImageId` stays the upload's id so the job row and provenance record what the turn came from. `generationCost` already follows `generateOp.kind` (`costFor` in `src/lib/generators/ideogram-generator.ts`), so a photo turn costs $0.03, not $0.20.
- Parent lineage (`parentImageId`, set in the continuation from `anchorImageId` among non-seed outputs) records the upload as the parent. That is correct: the design came from the photo.
- Known limit, accepted: when Claude times out or returns prose for a photo turn, the fallback spec renders the user's literal words with no sight of the photo (today's clarify behaviour); the result still renders and the clarify message rides along.
- No copy change, no schema change.

## Slice B: uploads are inputs (closes #355)

- `getUserImageLibrary` (`src/lib/user-designs.ts`) and `loadExportRows` (`src/lib/design-export.ts`) leave `operation = "upload"` rows out. The two readers must agree (the export computes its parts from the library's count; the docblock on `loadExportRows` says so).
- `publishImage` (`src/app/designs/actions.ts`) refuses an upload after the ownership check and before the hidden check, with a new string in `src/lib/action-copy.ts`: `UPLOAD_NOT_PUBLISHABLE = "Attached photos can't be published. Publish a design made from one instead."` (Claude's wording).
- The image detail page hides the Publish control for an upload: `getImagePage` (`src/app/d/actions.ts`) selects `operation`, `ImagePage` carries it, and `OwnerActions` gets `canPublish={isLoggedIn && img.operation !== "upload"}`. The "Not published" label still shows. Order is untouched (`resolveBuyableImage` already allows the owner's own unpublished image).
- `deleteImages` (My Designs bulk delete) never sees an upload because the library no longer lists one; nothing to change there.
- No schema change.

## Non-goals

Ideogram Remix (a possible later spike if interpretations feel loose); re-adding background removal; rectangular photo prints; re-reading the photo on later turns; labelling uploads anywhere; changing what the Studio shows inside the conversation.
