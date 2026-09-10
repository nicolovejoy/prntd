# #242 review follow-ups (post-merge)

PR #242 merged without the whole-branch review it was held for. The review
found nine things; these are the fixes. Everything here is already live on
prod, so this is a follow-up branch, not a merge gate.

Owner rulings (Nico, 2026-09-09) are marked **RULING** — implement them as
written, do not re-litigate.

## 1. The cart contradiction (HIGH — the actual defect)

`planImageDeletion`'s cart probe (`delete-image.ts`, the `cartPins` select)
matches `cart_item.placements LIKE %imageId%` with **no** exclusion of the
scope design's own cart lines. So an image pinned by its own thread's cart
line resolves to `detach-cart-pin`: the image row is deliberately KEPT
because a cart line needs it, and only the conversation link goes.

That leaves the design with zero links, so the new `removeDesignIfNowEmpty`
fires, and `executeDesignDeletion` runs
`db.delete(cartItem).where(eq(cartItem.designId, designId))` — deleting the
very cart line the image was spared for. The user's cart silently loses a
line they never touched, and the image is orphaned in the Library pointing at
a `sourceDesignId` that no longer exists.

Root cause: the two modules hold opposite conventions about a design's own
cart line. `delete-design.ts` deliberately excludes it
(`ne(cartItem.designId, designId)`) because a whole-conversation delete is
allowed to take its own cart lines. `delete-image.ts` counts it as a blocker.
#242 is the first code to call one from the other.

**RULING — fix it on the `removeDesignIfNowEmpty` side, not the probe.**
Changing the probe would make the image genuinely deletable and leave the
cart line pointing at a dead image id, which is exactly what the detach
exists to prevent.

## 2. `removeDesignIfNowEmpty`'s guard (rewrite)

**RULING — stop reusing `isDeletionBlocked`.** Its two-in-one meaning
(`orderReferenced || productCount > 0`) is what caused the drift: `deleteDesign`
archives only for the order case and returns an explicit error for the
product case, while this path silently archives both. Archiving a
product-blocked design also falsifies `openConversation`'s stated invariant
(`d/conversation-actions.ts`: "Archived only ever means 'was ordered', so
that is the status it goes back to") — reopening one would flip it to
`status: "ordered"`.

New guard, in this order:

1. no design row → `"not-applicable"`
2. any remaining `conversation_image` link → `"kept"`
3. any `image_generation` row with `status = 'running'` → `"kept"`
4. **NEW** any `cart_item` row with `design_id = designId` → `"kept"`
5. **NEW** `plan.productCount > 0` → `"kept"`
6. `plan.orderReferenced` → archive → `"archived"`
7. otherwise → `executeDesignDeletion` → `"deleted"`

Steps 4 and 5 are "keep" for the same reason as 3: the conversation is not
dead weight, something still points at it. An empty lane is the acceptable
cost in these rare cases; destroying a cart line or a shop product is not.

Fold the cart probe into the existing `Promise.all` rather than adding a
round trip. `planDesignDeletion` already reports `productCount` and
`orderReferenced`, so steps 5–6 read the plan it already fetches.

## 3. `removeDesignIfNowEmpty` must never throw (MEDIUM)

`deleteImages` (`designs/actions.ts`) documents this invariant above its
`try`: "a failure mid-way … the row is still there, so the grid says so
rather than claiming the image is gone." That held because
`executeImageDeletion` was exactly one atomic `db.batch`. It now does round
trips AFTER that batch commits, so a transient Turso error throws, the image
is reported `failed`, and the `continue` also skips the R2
`deleteObjectByKey` — the user is told the image survived when its row is
gone and its object is leaked forever.

**RULING — `removeDesignIfNowEmpty` catches its own errors**: log via
`console.error` in the same `[designs]`-style format the file already uses,
and return `"kept"`. Document that a failure degrades to the pre-#242
behaviour (an empty lane on the bench), which is recoverable, rather than
misreporting a deleted image. This fixes both callers at once and restores
the `try` block's invariant.

## 4. `/design` lightbox delete: confirm + redirect (MEDIUM)

`image-lightbox.tsx`'s Delete fires `onDelete(image.id)` immediately — no
confirm sheet, unlike Library which got one in #200 — and it can now take the
whole conversation including `chat_message`. `design-client.tsx`'s
`handleDeleteImage` only calls `refreshGallery()`; nothing redirects,
`designExists` stays `true`, and Close then throws "Design not found".

Only `design-client.tsx` wires the lightbox's `onDelete`. `studio-client.tsx`
and `d/[imageId]/conversation-images.tsx` render the same component without
it (studio-client's `onDelete` at ~line 620 is the lane menu's, unrelated).
So put the confirm in `handleDeleteImage`, keeping the lightbox
presentational and leaving the other two surfaces untouched.

- `useConfirm` from `@/components/ui`, same shape as `library-grid.tsx`.
- Copy in `src/lib/action-copy.ts` (question + consequence, per #200's split).
  The client knows `images.length`, so when this is the thread's LAST image
  the consequence must say the conversation and its chat go too. Persona C:
  plain, no apology, no exclamation.
- `deleteDesignImage` returns `{ designRemoved }` so the client can act on it.
- After a successful delete with `designRemoved !== "kept"`, navigate to
  `/studio`. Follow the sign-in/sign-up precedent (`window.location.href`)
  only if a `router.push` proves unreliable here; prefer `router.push` and say
  in the PR body which you used and why.

## 5. Copy and comment corrections (LOW, but they are the reason this recurs)

- `library-view.ts` `bulkImageDeleteConsequence` — one line, and #242 added a
  fifth consequence without touching it. Add the conversation clause, in the
  same words as `studio-view.ts`'s `bulkDeleteConsequence`.
- `image-lightbox.tsx` seed tooltip: "Removes the starting image from this
  design only." is now FALSE — on a fresh-start thread whose only image is
  its seed (the shape `startConversationFromImage` produces, and the shape
  `fresh-start-seed.integration.test.ts` now asserts) the detach empties the
  thread and the conversation is deleted. Rewrite it truthfully.
- `design/actions.ts` `deleteDesignImage`'s new comment claims "on top of the
  library revalidation every image delete already needs" — but the
  `revalidatePath("/studio/library")` sits INSIDE the `if`, so a plain image
  delete revalidates nothing and both routes go stale. Move
  `revalidatePath("/studio/library")` out of the `if` (it is correct
  unconditionally) and keep `/studio` inside it.
- `delete-image.ts`: the `executeImageDeletion` docblock ("Apply a plan.
  Refuses every outcome the rules didn't allow…") was orphaned — the new
  `EmptyDesignOutcome` type and `removeDesignIfNowEmpty` were inserted between
  it and the function, so it now documents the type instead. Move it back.
- `d/[imageId]/page.tsx`: the "Order" link is gated on `img.sourceDesignId`
  alone while `OwnerActions` correctly gates on
  `img.sourceDesignId && img.hasSourceConversation`. Pre-existing, but #242
  makes a dangling `sourceDesignId` routine. Gate it the same way.

## Tests (real-DB, the harness the other delete suites use)

New, in the #242 suite or a sibling:

1. **Cart-pinned last image** — design D, one image X, a `cart_item` with
   `design_id = D` whose placements pin X. Delete X from the Library.
   Assert: X survives (detach), D survives, the `cart_item` row survives.
   This is the case nothing covered and it is how the bug got in.
2. **Product-referenced last image** → design KEPT, `status` unchanged (not
   `"archived"`).
3. **Order-referenced last image** → still `"archived"` (existing behaviour,
   confirm the rewrite didn't break it).
4. `deleteDesignImage` returns `designRemoved` for a last-image delete.
5. If cheaply injectable: `removeDesignIfNowEmpty` swallowing a failure still
   lets `deleteImages` report the image as deleted and clean up R2. Skip if
   it needs contorting the db type — say so rather than faking it.

Mutation-verify each new test: break the fix, watch it fail, restore.

## Out of scope

No migration. No change to `planImageDeletion`'s probes. No widening of the
documented check-then-delete race (a job starting between the read and the
write) — that predates #242 and is accepted.
