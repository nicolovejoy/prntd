# The Studio: working surface + kept library

Written 2026-08-30. Decided by Nico the same day, from the mockups in
`https://claude.ai/code/artifact/9e2fe996-04df-4d79-a0ea-4d62089662c6`.

## The decision

Two views, with different jobs:

- **Studio** — the designs you are working on. One surface, one composer.
  Every conversation is a lane; its images sit in the lane, newest last.
  Firing three ideas without waiting is the normal case, not an edge case.
- **My Designs** — the designs you have kept. A library of images, not of
  conversations.

Conversations auto-archive out of the Studio after 3 days of inactivity, and
stay retrievable — from the archive, or from any image in My Designs.

This settles the design-vs-conversation question that has been open since
`docs/object-model-composition.md`: **the conversation is where work happens,
the image is what you keep.** The Studio is the only place that shows
conversations as first-class; everywhere else points at images.

## Why this shape

The durable generation job (#171) made parallel work real on the server —
generations survive navigation and tab close. Nothing in the UI acknowledged
it, so the first attempt to use it failed. From Nico's prod smoke on
2026-08-30: three prompts typed, one image produced.

Root cause, from the prod DB rather than inspection:

- **Generate silently became a clarifying question.** `prepareGeneration`
  runs a Haiku readiness pre-check and, when it judges the idea thin,
  persists a question and returns instead of generating
  (`src/app/design/actions.ts:304-313`). Since #170 the brief itself can also
  return `clarify` (`:323`). Two independent silent gates. "dog doing
  calisthenics" tripped the first one.
- **That clarification still spent a daily generation unit.** Verified on
  prod: the usage row read 3, only 2 jobs existed. The refund covers throws
  only; a clarification is a normal return (`:246`). This is deliberate, not
  a regression — the pre-#171 code carried the comment "Clarification
  early-returns below aren't failures — they leave quota spent."
- **Send and Generate are indistinguishable in outcome.** Two of four turns
  went through `sendChatMessage`. Enter sends a chat message; the button
  generates. Both produce assistant text and no image, so from the user's
  seat they are the same non-event.

The Studio does not fix those by existing. Slice 1 fixes them, and it ships
first because they are live defects on a surface people use today.

## What the Studio is

A lane is a conversation. A cell is an image.

- Lanes are the user's **open** conversations (`design.closed_at is null`),
  most recently active first.
- Cells within a lane are that conversation's images in creation order,
  newest last. The conversation's `primary_image_id` is marked.
- A running generation renders as a pending cell in its lane with elapsed
  time. It comes from `image_generation` joined on `design_id`.
- The concurrency cap (3) is visible: at capacity, the Generate control says
  so rather than failing silently.

**Selection is the whole interaction model.** Tapping a cell anchors it. The
composer carries a chip naming the anchor ("Editing 01 · dog ✕"); typing and
hitting Generate produces an anchored edit of that image. Dismissing the chip
clears the anchor, and the same box then starts a new conversation. There is
exactly one submit control and its meaning is always stated on screen.

This is the load-bearing claim of the whole design: if "what am I about to
change" is ever ambiguous, the paradigm fails. Every review of this work
should attack that first.

## What My Designs becomes

A grid of the user's images — the library. Tapping one goes to the image
detail page, which already exists and already handles owner-private images
(#136 slice 1). From there: "Open conversation" reaches the source thread,
reopening it into the Studio if it had archived.

**Open question (recommendation inline).** "Designs I've kept" could mean an
explicit keep/save action, or simply every image you have generated. Ship
**every image, no keep verb** — introducing a save action adds a concept and
a state to every image, and nothing yet demands it. If the library gets noisy,
hiding is the cheaper answer than keeping.

## Auto-archive

After **3 days without activity**, a conversation leaves the Studio. Activity
means a chat turn, a generation, or a primary-image change.

Archiving reuses `design.closed_at`, which already exists and already means
"read-only record" (#125, slice 3). `assertConversationOpen` already refuses
chat, generate and upload on a closed conversation; Reopen already exists.
So archive is a new *writer* of an existing state, not a new state.

**Do not add a cron for this.** `vercel.json` is at Vercel Hobby's 2-cron
limit (`retry-fulfillment` 08:00, `sweep-generations` 08:30). Follow the
pattern the durable job already established: sweep lazily on reads that
happen anyway (the Studio's own load is the natural one), with the existing
`sweep-generations` cron as the backstop. `src/lib/generation-job.ts`'s
`sweepStaleJobs` is the model to copy, including its `scope: "user" | "all"`
shape.

Retrieval has two doors, both already built: the archive list, and any image
in My Designs → image detail → open conversation. Reopening puts the lane
back in the Studio.

## Slices

Each slice is one PR, in this order. Slice 1 stands alone and is worth
shipping even if the rest is reconsidered.

### Slice 1 — Generate always generates

The live bug fixes, no new surface.

- Remove the readiness bail in `prepareGeneration`. A generate request always
  produces a generation.
- When the brief wants to clarify, it renders *and* attaches the question. The
  question is an addition to a result, never a substitute for one.
- One submit control in the composer. Enter generates. `sendChatMessage`
  stays for conversational turns but stops being reachable by the same
  gesture as Generate.
- Quota: with clarify-instead-of-generate gone, the "clarification spends a
  unit" question mostly dissolves. Any remaining path that spends a unit
  without creating a job row must refund.

Acceptance: the exact prod repro — "dog doing calisthenics" typed and
Generate pressed — produces an image. Test with the verbatim string, the way
#142 pinned #137's repro.

### Slice 2 — Studio read model and screen

- `/studio`: lanes from open conversations, cells from their images, pending
  cells from `image_generation`.
- One query path, tested against a real DB, that assembles lanes without an
  N+1 per conversation.
- Polls for in-flight work using the existing `getDesignJobs` machinery
  (`src/lib/generation-poll.ts` already holds the backoff logic).
- Read-only in this slice: no composer, no anchoring. Nav does not point here
  yet.

### Slice 3 — Anchor and composer

- Tap a cell to anchor; chip names it; ✕ clears to "New design".
- Generate with an anchor = edit anchored on that image. Generate with no
  anchor = new conversation, then generate into it.
- Cap state is visible and explains itself.
- This is where the ambiguity risk lives. The anchor must be legible at a
  glance on a phone, and must survive a poll refresh landing mid-typing.

### Slice 4 — Auto-archive

- `closed_at` set after 3 days of inactivity, lazily on read plus the
  existing cron backstop. Never a third cron.
- Studio excludes closed conversations; an archive view lists them; reopening
  returns the lane.
- Archiving must never touch a conversation with a running generation.

### Slice 5 — My Designs as the library, and the IA

- My Designs becomes a grid of images rather than one card per conversation.
- Image detail gains "Open conversation", reopening if archived.
- Nav: Studio and My Designs are peers. Decide the landing surface for a
  signed-in user — recommendation: Studio, since that is where work resumes.

## Constraints that apply throughout

- **Phone-first.** The Studio is judged on a phone. A lane that only works on
  a desktop has failed.
- **Clean Label voice.** Plain, quiet copy. No whimsy. See
  `docs/design-system.md` Part 1.
- **Migrations.** Slices 1–3 need no schema change. Slice 4 needs none either
  — `closed_at` already exists. If any slice grows a migration, it must be
  applied to prod *and* `prntd-preview` **before** the PR merges: main
  auto-deploys, and 0011 not being applied before #171 merged took prod down
  for fifteen minutes on 2026-08-30. See #166.
- **Every agent PR runs `npm run typecheck`** in addition to lint, test and
  build. CI has caught agent PRs that skipped it.

## Deliberately not in scope

- Composition slice 2 and the `listing` → `product` read swap. Unrelated and
  already planned in `docs/composition-first-class-plan.md`.
- #169's `design_spec_json`. It makes lane context better and should land
  near slice 2, but it is its own change with its own issue.
- Any change to the buy flow, /preview, or the Shop.
