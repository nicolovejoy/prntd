# Hidden-image leftovers, part 2 (#310 items 4, 5 and 2)

Brief for a cloud session. Written 2026-10-11 by local session 1014.

## Who reads this

A cloud session started on the branch `claude/hidden-image-leftovers-2`. Nico is
on a flight and cannot answer. Do not wait for him. Where this brief says to
stop and write a question, write it on https://github.com/nicolovejoy/prntd/issues/310
and carry on with the next item.

## Ground rules

- Read `CLAUDE.md` and `AGENTS.md` first. The "Cloud sessions" section applies:
  prntd.org and `*.vercel.app` are unreachable, so no smokes, no prod reads and
  no migrations. Those go to Nico, in writing, in the PR.
- This branch is yours alone. Push only to it. Merge nothing; Nico merges.
- No schema change. If an item seems to need one, stop that item and write the
  question.
- One PR from this branch, holding items 4 and 5. Open it as a draft titled
  `HOLD: …`: item 5 has a read on prod that Nico owes before the merge, and a
  draft cannot be merged by accident.
- Follow the repo's practice (CLAUDE.md, "PRs, agents, and review" and the
  batch lesson): implementers on Sonnet with the model passed explicitly,
  re-run the gate yourself, one Opus whole-branch review before the PR, the
  review and your rulings posted as PR comments, a ledger at
  `docs/superpowers/ledgers/2026-10-11-hidden-image-leftovers-2.md`. Never tell
  a reviewer what not to flag.
- Gate: `npm run lint`, `npm run typecheck`, `npm test`, `npm run db:generate`
  (must print "No schema changes"), `npm run build` with the dummy env from
  `ci.yml`'s `check` job.
- Tests for these items are real-DB integration tests (in-memory libSQL,
  `src/lib/__tests__/test-db.ts`, factories in `src/lib/__tests__/factories.ts`).
- Copy: reuse an existing string where one fits ("Hidden by an admin" is the
  accepted refusal copy in `deleteImages`). Any new user-facing string is
  Nico's to approve: list it in the PR body under "Copy for Nico".
- Leave `CLAUDE.md`'s "Current state" alone. The PR body, the ledger and the
  comment on #310 are this session's record; the next local session folds them
  in.

## Item 4: `selectImage` and `setPrimaryImage` refuse a hidden image

Ruling (Nico, 2026-10-11, recorded on #310): yes.

- Both are in `src/app/design/actions.ts`. `selectImage` resolves an image by
  URL (`findDesignImageByUrl`) and sets `primary_image_id`. `setPrimaryImage`
  checks the conversation link and sets it.
- Read hidden state through the one reader, `isImageAdminHidden` in
  `src/lib/model-b-writes.ts`. Do not add a second way to read it.
- Place the check after ownership and after the link check, so a foreign or
  unlinked id reads as it does today. `deleteImages` in
  `src/app/designs/actions.ts` does the same and its comment says why.
- No UI path sends a hidden image since #309. Before choosing between a throw
  and a structured result, find how each caller surfaces a failure. Say what
  you chose and why in the PR.
- Tests: a hidden image is refused by each action and nothing is written
  (`primary_image_id` and `mockup_urls` unchanged); a visible image still
  works; an image with no publication row still works.
- `startConversationFromImage` lets an owner seed a thread from their own
  hidden image, and since #309 that seed is invisible in the thread. There is
  no ruling for it. Do not change it. Report what you find on #310.

## Item 5: the Shop feed reads `image_publication.is_hidden`

Ruling (Nico, 2026-10-11): yes, with the parity check as the before-and-after
read.

- `src/lib/discover-feed.ts` filters the feed on `product.status = 'listed'`.
  Since #300 `image_publication` is the one reader of image visibility
  (`publicationVisibility` in `src/lib/design-publish.ts`); this is the last
  visibility read left on `product.status`.
- `status = 'listed'` may exclude more than hidden images. List every value
  written to `product.status` anywhere in the code and what the feed does with
  each, in the PR. When the two tables agree, the feed must show exactly what
  it shows today.
- `setImageHidden` writes both columns in one batch, so they should agree. The
  parity read tells whether Production has a row where they do not.
- The parity read is Nico's, since this session cannot reach Production. Write
  a read-only script (pattern: `scripts/check-composition-read-parity.ts`;
  `scripts/**` is outside lint and tsconfig) that prints each published image
  whose `image_publication.is_hidden` and mirror product status disagree, and
  the feed's image ids under the old filter and under the new one. It prints
  `PARITY CLEAN` and exits 0 when the two lists are identical, and exits 1
  otherwise. It writes nothing and prints no secret. Put the exact command in
  the PR body as a paste block, in the inline-credentials form CLAUDE.md gives
  for Production under "Migration discipline", following the Shared
  conventions for paste blocks.
- Tests: the feed leaves out a hidden publication; one row disagreeing in each
  direction, asserting the new rule.

## Item 2: deleting a conversation that holds a hidden image (trace only)

Ruling (Nico, 2026-10-11): delete the conversation, keep the image row and its
publication row. It is not built yet because one consequence is untraced. This
session writes the trace and builds nothing for this item.

Today lane Delete, bulk delete and `deleteDesignImage` have no hidden check
(`src/lib/delete-design.ts`: `planDesignDeletion`, `executeDesignDeletion`;
`src/app/design/actions.ts`). They remove the image, its publication row, its
mirror product and the R2 object. After the ruling a hidden image would outlive
its conversation.

Answer these with file and line, and with a real-DB probe test where one helps
(delete the probe afterwards):

1. What has to change in the deletion plan so that the image, its
   `image_publication` row and its mirror product survive while the
   conversation and its other rows go? What happens to
   `image.source_design_id`, the `conversation_image` links,
   `design.primary_image_id`, and to cart lines and orders that reference the
   design?
2. An admin later unhides that image. Does it come back in the Shop feed, on
   its image detail page, in its owner's My Designs? Can anyone order it?
   `order.design_id`, `order_item` and `cart_item` hold NOT NULL references to
   `design`, and CLAUDE.md records that an image whose conversation was deleted
   cannot be ordered. Can its owner unpublish or delete it?
3. The options and what each costs. For example: keep the conversation row as
   a closed shell its owner cannot see; refuse the delete, as `deleteImages`
   does; delete and accept the answer to 2. Add any better one you find.
   Recommend one.

Post the trace as one comment on #310, with numbered questions for Nico at the
end.

## Out of scope

Anything on files that PR #314 changes (unmerged when this was written; check
with `gh pr view 314`): #310 items 1 and 6, everything on #317, the "View
larger" naming, slice 6a. The focused-stage layout fix has its own branch,
`claude/stage-long-title-overflow`. Leave all of these alone.

## When you finish

The draft PR's body carries:

- what changed, item by item, and the list of `product.status` values;
- the gate as an unticked box: Nico's parity read on Production, with its
  paste block;
- "Copy for Nico", if any string is new;
- one smoke for Nico to run after the merge, self-contained: full URL,
  numbered steps, and a PASS and FAIL he can decide from what is on screen;
- the gate results and what was not run.
