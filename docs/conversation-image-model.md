# Conversation / Image model

Status: direction agreed 2026-06-25 (Nico). Not yet implemented. This describes
the target model and the decisions it must accommodate, not a migration plan.

## Two first-class objects

PRNTD has two distinct things that today are both called "design":

1. **Conversation** — a chat thread plus its iterations. The creative process /
   workspace. Lives at `/design?id=`. Owned by one user.
2. **Image** — a generated design (one rendered artifact). The output. Can be
   published, ordered, or reused. Owned by one user.

A conversation produces images. An image can be the output of one conversation
and the seed (input) of others. Naming for the user-facing surfaces (Studio /
Drafts / Threads / Prints / etc.) is deferred to the persona work — this doc
fixes the structure, not the words.

## Chosen data model: B — image is standalone, conversations reference images

- `image` is a top-level table: owner, R2 key, publish state, provenance.
- `conversation` is its own table.
- `conversation_image` is a many-to-many join, each link tagged with a **role**:
  - `output` — this conversation generated the image.
  - `seed` — this conversation consumed the image as an input.
- An image is referenced, never copied. The same image row can be the `output`
  of conversation X and a `seed` in conversations Y and Z (possibly owned by
  other users).

Reuse — within a user or across users — is **adding a link row**, not
duplicating the image or its R2 object.

### Why B over "copy" (Model A)

The product is heading toward cross-user seed reuse, marketplace remix (#6), and
organizer storefronts where attribution and reach matter. A shared-reference
graph answers "where is this used / how far did it spread / who derived from
whom" as a cheap join, instead of walking a chain of copies. Model A (copy on
reuse) is simpler now but fights these features later.

### Guardrail: published images are immutable

B's main hazard is shared mutability — if a referenced image changes or is
unpublished, downstream conversations shift under their users. Rule:

- **Publishing snapshots the image; published images are immutable.** Further
  edits create a new image (a new version), they don't mutate the published one.
- Private drafts can stay mutable and single-home until published.

This keeps B's shared-reference upside without the rug-pull.

## User journeys the model must accommodate

- **Resume a conversation.** Open `/design?id=`, keep iterating. (Conversation
  is durable, not ephemeral.)
- **Reuse my own image as a seed in a new conversation.** Pick an image, start a
  fresh conversation with it linked `role=seed`. Same image row, new thread.
- **Cross-user seed reuse.** User 2 starts a conversation seeded by user 1's
  *published* image. A `seed` link from user 2's conversation to user 1's image,
  gated by the image's visibility. Lineage/attribution falls out of the join.
- **Publish.** An image becomes a buyable print (immutable snapshot).
- **Order / storefront.** A product (organizer pivot: store → product →
  blank × design × placements) references an **image**, never a conversation.
  The conversation is the workshop; the image is what gets sold.

None of these need to be built up front. The model must not preclude them.

## Open decisions (deferred, not blocking)

- **Permissions / visibility / licensing.** Who may link to whose image, under
  what license. B's schema invites the question; we don't have to answer it
  until cross-user reuse ships.
- **Deletion / reference counting.** An image referenced by another user's
  conversation or an order can't be hard-deleted. Need soft-delete or
  ref-count rules (today's "delete conversation wipes its images" no longer
  holds once images are shared).
- **Versioning UX.** How re-publishing a new version of an image relates to the
  prior published version (supersede? both live? lineage link?).
- **User-facing vocabulary.** Persona/copy work (Manine) names the surfaces.

## Relationship to today's schema

Today: `design` (the thread + chat_message rows + design_image rows,
`primary_image_id`, status) and `design_image` (publish state,
`forked_from_image_id`, `original_designer_id`). That is roughly Model A with a
copy-based fork. Moving to B means promoting `design_image` to a standalone
`image` table and replacing the implicit one-design-owns-its-images link with an
explicit `conversation_image` join carrying roles. Migration is out of scope
here.

## Conversation lifecycle (Nico, 2026-07-19)

Direction set during user testing, to fold into the Model B migration:

- Once a conversation is over, its images are used **separately from it** —
  the image is the artifact that travels (buy pages, back-design picker,
  products), the conversation is just its provenance.
- Conversations should be **closeable**: kept on record (viewable history)
  but closed to further iteration. No re-opening old threads to keep
  generating in them.
- Rationale: iteration inside one thread has fast-diminishing returns — if
  the first few generations aren't good, later ones in the same thread
  rarely are. The product should favor starting a fresh conversation
  (optionally seeded by a prior image, which Model B makes a cheap link)
  over deep iteration in an old one.
