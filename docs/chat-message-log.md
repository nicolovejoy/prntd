# Chat history → append-only log

Plan to replace the `design.chat_history` JSON column with a `chat_message` table. Drafted 2026-05-06.

## Why this matters

Today every message is appended by reading `design.chat_history` (a JSON blob), splicing a new entry, and writing the whole array back. That has three problems:

1. **Read-modify-write race.** Two server actions firing close together (e.g. user clicks Generate while a Send is still writing) can clobber each other. We've been lucky.
2. **Mixes log with state.** `chat_history` is logically a log of past events but lives on a row that also tracks current state (`primary_image_id`, `mockup_urls`). Mutable state and immutable history shouldn't share storage.
3. **`imageUrl` duplication (the 5c motivation).** `chat_history.imageUrl` duplicates URLs already stored in `design_image`. Two sources of truth that drift.

This is the same pattern problem we already fixed once: `design.currentImageUrl` was duplicated state, replaced by `primary_image_id` pointing into `design_image`. Same move for chat history.

## Target model

A new table:

```
chat_message
  id          text pk
  design_id   text  → design.id   (indexed)
  role        text  ('user' | 'assistant')
  content     text
  image_id    text  → design_image.id  (nullable)
  created_at  integer ms
```

Append-only: rows are written once, never updated, never deleted. Same shape as `ledger_entry` and `design_image` — both already follow this pattern.

### What's NOT in the table

- **`flux_prompt`**: today stored on assistant messages. Drop it. The same prompt already lives on `design_image.prompt` and we resolve it via `image_id` when needed.
- **`generation_number`**: today stored as an int on assistant messages. Drop it. Derived from chronological order over rows where `image_id IS NOT NULL`.
- **`image_url`**: replaced by `image_id` (FK into `design_image`).
- **`kind` / `type`** discriminator (e.g. "upload" vs "chat"): not added. The combination `role='user' AND image_id IS NOT NULL` already means "user upload"; `role='assistant' AND image_id IS NOT NULL` means "generated image". Don't pay for a column the data shape already encodes.

### What stays on the design row

`design.chat_history` column gets dropped. `design` keeps everything else — `primary_image_id`, `generation_count`, `generation_cost`, `mockup_urls`, etc. Those are state, not log.

## How reads change

### Chat panel (UI)

Currently the page hydrates from `design.chatHistory` and renders. After: page calls `getDesignMessages(designId)` which returns rows ordered by `created_at`. Inline images render by looking up `image_id` in the gallery's `images` array (already passed around as `DesignImage[]`).

### AI gallery context

Today: `extractImagesFromHistory(chatHistory)` parses the JSON and returns `DesignImage[]` for the system prompt's "Images so far:" block.

After: a new function reads `design_image` rows directly (it already powers the gallery — `getDesignSourceImages`). The "prompt" field for each image comes from `design_image.prompt` (and for uploads, we'll set the prompt to `[user upload] filename` at insert time).

`extractImagesFromHistory` and `chat-utils.ts` are deleted.

### `buildMessages` (Anthropic message construction)

Today: maps over `chatHistory` array. Joins `fluxPrompt` onto assistant `content` via "Prompt used: ..." for the model.

After: same logic, but the input is `ChatRow[]` from the new table. To get `fluxPrompt`, join `image_id → design_image.prompt`. One DB query at the top of the action; no JOIN per row.

## How writes change

Three call sites today read-modify-write `chat_history`:

1. `sendChatMessage`: appends a user turn + assistant turn.
2. `generateDesign`: appends optional user turn + assistant turn (with `imageUrl`, `fluxPrompt`, `generationNumber`).
3. `uploadReferenceImage`: appends a user turn (with `imageUrl`).

After the refactor, each becomes one or two `INSERT INTO chat_message` calls with no read-modify-write. Order is by `created_at` (millisecond resolution; if two rows ever land in the same ms, the natural row id ordering decides — fine).

Image inserts (`design_image`) and message inserts (`chat_message`) are not in a transaction. If image insert succeeds but message insert fails, we'd have an orphan image row. Acceptable — the image is still usable, just without a chat bubble. Not worth the complexity of distributed-transaction wrappers in libSQL.

## Migration

One-shot script: `scripts/migrate-chat-history-to-table.ts`.

```
for each design:
  parse design.chat_history JSON
  for each message in array:
    image_id = (msg.imageUrl ? lookup design_image by (designId, imageUrl) : null)
    insert chat_message {
      role, content, image_id,
      created_at: design.createdAt + index_offset_ms,
    }
```

`created_at` doesn't need to be exact for old rows — we just need ordering preserved. Use the design's `createdAt` plus an offset per message index (e.g. `+i ms`).

After backfill: drop `design.chat_history` column via a follow-up migration once we've verified all reads have switched.

Backfill is idempotent if we add a `UNIQUE(design_id, created_at)` constraint OR if we just truncate and re-run; either is fine for a one-time ops script. Run from `tsx --env-file` against prod the same way the product scripts work.

## What this unlocks (or doesn't)

- **Doesn't unlock multi-user.** This is still a solo-designer-per-thread app. The log is for a single user's history.
- **Does unlock fork-from-message.** The #2 fork model would copy a range of messages by `created_at <= forkedAt`. Trivial query; impossible cleanly with JSON.
- **Does unlock a unified design timeline view** (later, if we want it): `SELECT ... FROM chat_message UNION ALL SELECT ... FROM design_image ORDER BY created_at`.
- **Doesn't move us toward event sourcing.** Resisted the temptation to make a polymorphic `design_event` table. Two narrow tables (`chat_message`, `design_image`) read more clearly than one wide one.

## Order of work

1. Add `chat_message` table to `src/lib/db/schema.ts`. `npm run db:push`.
2. Backfill script. Run against prod (only Knute + my test designs to migrate; tiny dataset).
3. Add new read functions: `getDesignMessages`, image gallery context (already exists as `getDesignSourceImages`).
4. Switch writers: `sendChatMessage`, `generateDesign`, `uploadReferenceImage`.
5. Switch readers: `page.tsx` hydration, `chat-panel.tsx` rendering, `ai.ts` `buildMessages`, `preview/actions.ts` fluxPrompt fallback lookup.
6. Delete `chat-utils.ts`, `chat-utils.test.ts`, `extractImagesFromHistory` references.
7. Verify in dev with a fresh design + a backfilled design.
8. Drop `design.chat_history` column. `npm run db:push`.

Each step is a separate commit; the column drop is the last step after the dust settles.

## Decisions

1. **`imageUrl` field on `ChatMessage` type is dropped entirely.** Once `chat_message` is the source, the type maps 1:1 to a row. New shape: `{ id, designId, role, content, imageId, createdAt }`.
2. **Backfill uploads into `design_image`.** Old user uploads stored URL in `chat_history` but never wrote a `design_image` row. The migration inserts a `design_image` row for those (`product_id` null, `prompt='[user upload]'`) and links the message to it via `image_id`.
3. **Drop the "Generated #N" caption.** The image renders next to the bubble and the gallery numbers it; the caption isn't load-bearing.
