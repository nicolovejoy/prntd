# Model B migration plan — conversation/image split

Status: plan drafted 2026-07-19. Companion to `docs/conversation-image-model.md`
(target model + lifecycle direction) and `docs/data-model-simplification-plan.md`
(items 3 and 4 ride this migration; items 1 — order scalar cols, Phase 1c — and
2 — productId→blankId rename — are separate and referenced only).

## Scope

- `image` becomes a standalone table (artifact only: owner, R2 key, generator,
  provenance). `conversation_image` join with roles `output` / `seed`.
- `listing` splits off the publish state (`published_at`, title, description,
  backdrop, hidden, feed rank) — simplification item 3.
- Placement renders split into a `placement_render` cache table — item 3.
- Provenance (`forked_from_image_id`, `original_designer_id`) moves off
  `design` onto the image graph — item 4.
- Conversations become closeable (Nico 2026-07-19): kept on record, viewable,
  no further generation.
- Fresh-start-from-image: a new conversation seeded by an existing image is a
  `role=seed` link, not an R2 copy. Replaces `forkImage`'s copy-based fork and
  is the intended loop instead of deep iteration in old threads.
- Products and orders reference images, never conversations' internals.

Out of scope: cross-user permissions/licensing, version-supersede UX,
user-facing vocabulary, the `design`→`conversation` table rename (see Open
questions — recommend deferring the rename exactly like productId→blankId).

## Key structural decisions

### 1. `design` stays; only images move out

`design` already is the conversation row: `chat_message.design_id`,
`order.design_id`, `product.design_id`, `cart_item.design_id` all FK it. This
migration does NOT create a new `conversation` table — it extracts images from
`design_image` and hangs lifecycle columns on `design`. Renaming the table to
`conversation` is a later mechanical PR (same class as item 2's blankId
rename). Docs and code comments can start saying "conversation" now.

### 2. Id reuse is the backbone

Every new `image` row keeps its `design_image.id`. This is what makes the
migration safe: `order.placements`, `order_item.placements`,
`cart_item.placements`, `product.placements`, and `chat_message.image_id` all
store design_image ids as opaque strings (JSON or untyped text, no FK). With id
reuse, none of those need touching. Same for `placement_render` rows (designed
orders pin render ids in placements too).

### 3. New tables

```
image
  id                 text PK            -- reused design_image.id on backfill
  owner_id           text NOT NULL → user.id
  r2_key             text               -- null on legacy rows where the URL
                                        -- can't be parsed; image_url is
                                        -- authoritative for display
  image_url          text NOT NULL
  aspect_ratio       text NOT NULL
  prompt             text
  generator          text
  generation_cost    real NOT NULL default 0
  parent_image_id    text               -- within-thread iteration chain
  seed_image_id      text               -- cross-conversation lineage (was
                                        -- design.forked_from_image_id)
  original_designer_id text             -- denormalized attribution root (was
                                        -- design.original_designer_id)
  source_design_id   text               -- convenience: the conversation that
                                        -- generated it (= the role=output link)
  created_at

conversation_image
  id                 text PK
  design_id          text NOT NULL → design.id
  image_id           text NOT NULL → image.id
  role               text enum output | seed
  created_at
  UNIQUE (design_id, image_id, role)

listing                                  -- item 3: published listing
  image_id           text PK → image.id  -- one listing per image
  published_at       integer NOT NULL
  is_hidden          integer NOT NULL default false
  title              text
  description        text
  background_color   text
  feed_rank          integer
  created_at

placement_render                         -- item 3: cache, not artifact
  id                 text PK            -- reused design_image.id on backfill
  design_id          text NOT NULL → design.id
  source_image_id    text               -- was parent_image_id (#25 anchor)
  blank_id           text NOT NULL      -- was design_image.product_id (a blank)
  placement_id       text NOT NULL
  image_url          text NOT NULL
  aspect_ratio       text NOT NULL
  generation_cost    real NOT NULL default 0
  created_at
```

Notes:
- `image.owner_id` denormalizes the design's owner. Required for
  `canUseAsPlacementSource` (today joins design for it) and for reparenting.
- Unpublish = delete the `listing` row (semantics unchanged: reversible;
  deletion lock stays keyed on order references, `imageReferencedByOrders`).
- Immutability guardrail: no code path may update `image.image_url` /
  `r2_key` / `prompt` after insert. Publishing snapshots by construction —
  the listing points at a row nothing mutates. Enforce by review + a test
  that the image write layer exposes no update helper.

### 4. Lifecycle: `closed_at` on `design`

- New nullable column `design.closed_at` (timestamp). Null = open. Chosen
  over a status value: `status` (draft/ordered/archived) is a visibility
  concept and mid-retirement (`approved` already retired); closed is a
  capability concept and orthogonal to archived. No enum migration, no
  status-matrix explosion.
- Closed blocks: generation, chat turns, and uploads — the thread is
  read-only (viewable history, images still fully usable elsewhere).
  Rationale: chat without generation is a dead end in this product; a
  half-open state invites "why won't it draw" confusion. Enforced in the
  server actions (`sendChatMessage`, `generateDesign`, upload) with one
  shared `assertConversationOpen(designId)` guard, and the /design UI swaps
  the composer for a "Closed — start a new design from any image" affordance.
- What closes one: explicit user action (Close on the /designs card and the
  thread menu), reversible for now (Reopen) — see Open questions for the
  auto-close-on-order call.

### 5. Fresh-start-from-image

New action `startConversationFromImage(imageId)`:
- Guard: reuse `canUseAsPlacementSource`-shaped visibility (own image, or
  published + not hidden).
- Creates a `design` row, inserts `conversation_image(role=seed)`, no R2 copy,
  no new image row. Seeds the chat context with the image (the AI-context
  gallery already carries image URLs).
- First generation in the new thread records `parent_image_id = null`,
  `seed_image_id = <seed>`, `original_designer_id` propagated from the seed
  image (or the seed's owner if unset).
- Retires `forkImage` + `copyDesignImageByUrl` (the Model A copy). The /d
  fork chain (`buildForkChain`) walks `image.seed_image_id` instead of
  `design.forked_from_image_id`.

### 6. R2 key ownership

Today designs own their keys (`designs/{designId}/{n}.png`, minted by
`reserveGenerationNumbers` + `uploadDesignImage`; orphan cleanup keys off
(designId, generationNumber)). Once images are shared, the key must belong to
the image:
- New generations write `images/{imageId}.png`. The image id is minted before
  upload (crypto.randomUUID), which also removes the need for the generation
  number in the key (keep `reserveGenerationNumbers` only if the UI still
  numbers generations; otherwise retire it in the cutover slice).
- Legacy keys stay where they are — `image.image_url` is authoritative,
  `r2_key` parsed best-effort on backfill. Never move R2 objects.
- Orphan cleanup (`deleteDesignImageObject`) gets an image-key variant.
- Mockup keys (`designs/{id}/mockups/…`) are conversation-scoped caches;
  unchanged.

### 7. Deletion / ref-count

Today `deleteDesign` batch-deletes the thread's `design_image` rows. Once
images can be seeded into other conversations that breaks. New rule, in a pure
helper `imageReferences(imageId, ctx)` (extends `imageReferencedByOrders`):
an image is deletable only when it has no listing, no `seed` link from another
design, no order/order_item/cart_item placement reference, and no
`product.placements` reference. `deleteDesign` deletes the conversation, its
chat, its links, its placement renders — and each output image only if
unreferenced; referenced images survive (they still carry owner_id). Hard
delete stays (matching current behavior); no soft-delete column unless a need
appears.

## Migration mechanics (repo discipline)

- Every schema change: edit `schema.ts` → `npm run db:generate` → reviewed
  `drizzle/000N_*.sql` in the PR. Dev iterates on `db:push` but generates
  before merge.
- Additive-first: no column/table drop until zero readers AND a full release
  has dual-written/backfilled. Drops are the last slice.
- Backfills are idempotent scripts in `scripts/` (excluded from lint/tsc),
  chunked `db.batch` — never `db.transaction` (libSQL serverless HTTP).
  `INSERT OR IGNORE`-style guards so re-runs are safe.
- Before each prod migrate: `turso db create prntd-backup-<date> --from-db
  prntd`; `scripts/migration-smoke.ts before|after` around it. Preview gets
  the migration via the CI e2e job's auto-apply (additive slices are safe for
  the shared preview DB; the drop slice merges only after the code that stops
  reading is deployed).
- Ownership: `image.owner_id` joins the reparent batch in the SAME slice that
  creates the table. `src/lib/reparent-user.ts` + its integration test (seeds
  one row per user-owned table — the stated checklist) are the gate:
  the test must fail until the batch includes `image`.
- The real-DB test harness derives DDL from `schema.ts`, so new tables appear
  in the test DB automatically — integration tests per slice, no fixtures work.

## Slices (each a PR, shippable and revertable)

### Slice 1 — additive tables + backfill + dual-write

- `schema.ts`: add `image`, `conversation_image`, `listing`,
  `placement_render`; migration `0005`.
- Dual-write at the single write choke points (all in `db.batch` with the
  existing writes):
  - `insertDesignImage` (source generations): design_image row + image row
    (same id) + `conversation_image(role=output)`.
  - placement-render inserts: design_image row + placement_render row (same id).
  - `publishImage` / `unpublishImage` / `updatePublishedNaming` /
    `setImageHidden` / feed-rank: design_image cols + listing row upsert/delete.
- `scripts/backfill-model-b.ts`: design_image → image/placement_render (split
  on `product_id IS NULL`), output links, listing rows from `published_at IS
  NOT NULL`; seed links + `seed_image_id`/`original_designer_id` from
  `design.forked_from_image_id`/`original_designer_id`; `source_design_id`
  from `design_id`. Idempotent, chunked.
- `reparent-user.ts`: add `image` update to the batch; extend
  `reparent-user.integration.test.ts` (the checklist test).
- `deleteDesign` and `deleteDesignImageRow` delete the new rows too (batch).
- Tests: `model-b-backfill.integration.test.ts` (backfill idempotence + split
  correctness + id reuse), `model-b-dual-write.integration.test.ts` (every
  write path lands both shapes), extended reparent test.
- Ship: merge → preview auto-migrate → prod backup → prod migrate → run
  backfill against prod → smoke.
- Revert: new tables are unread; reverting the code leaves inert tables.

### Slice 2 — read-path swap

Move every reader onto the new tables, keeping function signatures so call
sites don't churn:
- `design-images.ts`: `getDesignSourceImages`, `getDesignImageById`,
  `getDesignImageWithOwner` (owner now from `image.owner_id`, no join),
  `resolveOrderImageUrls` + display-URL resolvers (id lookup checks `image`
  then `placement_render`), `findPlacementRender`, `getDesignPlacementRenders`,
  `findDesignImageByUrl`.
- `back-sources.ts`: all three groups + `assertUsableBackImage` (guard input
  shape now `{ownerId, publishedAt: listing?, isHidden}` — adapt
  `canUseAsPlacementSource` params in `design-publish.ts`).
- `discover-feed.ts`, `/d` (`getPublishedImage`, `buildForkChain` over
  `image.seed_image_id`), `/admin/published`, orders/emails image resolution.
- Tests: rename/extend the existing real-DB tests
  (`back-sources.integration.test.ts`, `discover-feed.integration.test.ts`,
  `placement-render.integration.test.ts`) to seed via the NEW write path;
  add `image-readers.integration.test.ts` covering the id-reuse lookup
  (order placement id resolves whether it was an artifact or a render).
- Risky spots exercised here deliberately: /d buy page, back-source picker,
  order history thumbnails, admin published grid — smoke each on preview.
- Revert: readers flip back; dual-write kept both shapes current, so
  reverting loses nothing.

### Slice 3 — lifecycle + fresh-start

- `design.closed_at` (migration `0006`, additive).
- `assertConversationOpen` guard in chat/generate/upload actions; /design UI
  closed state; Close/Reopen on /designs and the thread menu.
- `startConversationFromImage(imageId)` action + entry points (/d page,
  /designs card, image lightbox); retire `forkImage` +
  `copyDesignImageByUrl`.
- Tests: `conversation-close.integration.test.ts` (closed blocks generation
  and chat; images stay usable in back-picker/orders; reopen),
  `fresh-start-seed.integration.test.ts` (seed link created, no new image
  row, no R2 copy, attribution propagates, visibility guard rejects private
  cross-owner seeds).
- Independent of slice 2 ordering, but ship after it so the seed chain
  readers are already on `image`.

### Slice 4 — writer cutover + new R2 keys

- Stop writing `design_image`: generation writes `image` +
  `conversation_image` only, renders write `placement_render` only, publish
  state writes `listing` only. New generations upload to
  `images/{imageId}.png`; retire `reserveGenerationNumbers` or reduce it to a
  display counter.
- Deletion/ref-count: `imageReferences()` helper + rewired `deleteDesign` /
  image delete (survive-if-referenced).
- Tests: `image-refcount.test.ts` (pure), delete-path integration test;
  money-path integration tests must stay green (order placements unchanged).
- Requires slice 2 fully deployed (no design_image readers left) — verify
  with a repo grep gate in the PR.

### Slice 5 — drops

- Migration `0007`: drop `design_image`; drop `design.forked_from_image_id`,
  `design.original_designer_id`. Keep `design.primary_image_id` (it now
  points at an `image` id, still the anchor pick). Drop
  `design.generation_count`/`generation_cost` only if slice 4 retired them;
  otherwise leave for a later cleanup.
- Prod: backup branch, smoke before/after. Merge only after slice 4 has been
  live and quiet for at least a week (same convention as backup retention).
- Revert: restore from the backup branch; this is the one non-code-revertable
  slice, hence the waiting period.

## Risky spots (called out)

1. **R2 key ownership.** Designs own keys today; forkImage copies objects.
   Slice 4 flips new writes to image-keyed paths; legacy URLs never move.
   Watch: orphan-cleanup path, `findDesignImageByUrl` (URL→id pinning at
   checkout) must match whichever table minted the URL.
2. **Deletion once images are shared.** `deleteDesign`'s batch-delete of
   design_image is the landmine; slices 1–3 keep current semantics, slice 4
   installs ref-counting. Until then, seed links only reference published or
   own images, and publish already blocks nothing — acceptable interim.
3. **Publish state lives on design_image.** Dual-write window (slices 1–3)
   must keep listing and design_image publish cols in lockstep — every
   publish-family action goes through one helper to avoid drift.
4. **/d and back-sources read paths.** Highest-traffic public surfaces;
   slice 2 swaps them behind unchanged signatures with real-DB tests and a
   preview smoke.
5. **Order placements reference image ids.** Id reuse makes this a no-op, but
   any backfill bug that re-keys a row breaks historical order thumbnails and
   admin retry (fulfillment resolves placement ids). The backfill test
   asserts id equality; `migration-smoke` guards row counts.
6. **Cross-owner guard (`canUseAsPlacementSource`, PR #95).** Its input shape
   changes in slice 2; port its tests verbatim so the /d forged-id case stays
   covered.

## Open questions for Nico

1. **Does anything auto-close a conversation (e.g. placing an order), or is
   close explicit-only?** Recommendation: explicit-only now, with Reopen.
   Auto-close on order would fight the shipped back-design flow (owners
   iterate a back print in the same thread post-order). Revisit after
   watching whether old threads still accumulate generations.
2. **Closed blocks chat too, or generation only?** Recommendation: block both
   — a closed thread is read-only. Chat that can't generate is a dead end;
   the closed state should point at "start a new design from this image."
3. **Rename `design` table → `conversation` in this migration?**
   Recommendation: no — defer to its own mechanical PR after slice 5, same
   treatment as productId→blankId (item 2). The FK fan-out (chat_message,
   order, order_item, cart_item, product) makes it pure churn here.
4. **Is Reopen allowed, or is close one-way?** Recommendation: allow Reopen
   initially (cheap: null the timestamp). If the product point is to push
   people to fresh starts, remove Reopen later once fresh-start-from-image
   has proven itself — removing an affordance is easier than adding trust in
   a one-way door.
5. **Should `primary_image_id` survive on the conversation, or move to "the
   latest output link"?** Recommendation: keep it — it's the user's anchor
   pick, not derivable, and /designs, back-sources, and order fallbacks all
   lean on it.
