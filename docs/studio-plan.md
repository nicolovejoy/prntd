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

Three decisions, settled 2026-08-30 from the mockups in
`https://claude.ai/code/artifact/0b4b8e16-2966-4b81-b9f8-855ed1bf41f6`.

**The composer stays docked, and the anchor chip carries a crop of the
anchored image** — not just its name. The keyboard takes half a phone, so the
lane you are editing will often be off screen at exactly the moment you are
typing about it; the thumbnail in the chip is what survives that. Anchoring
also scrolls its lane into view.

The alternative considered and rejected was a bottom sheet per lane (bigger
images, no chip needed, but the other lanes vanish and switching designs
means dismissing first). Keep it in mind as the fallback: if the chip's crop
proves unreadable at real size on a phone, the sheet is the cheap retreat —
the lane data is identical either way.

**The anchor stays where the user put it.** Generating from an anchored image
does not advance the anchor to the result. Successive instructions therefore
fan out from one starting image ("try it three ways"); to build on a result
instead, the user taps it. An anchor that moves on its own is the failure
mode — the next instruction lands somewhere nobody chose.

**A lane opens scrolled to its newest image.** Lanes wider than the phone
scroll horizontally; the latest result is what the user came back for, so it
is what they land on, with earlier versions one swipe left.

Everything else in this slice:

- Tap a cell to anchor; ✕ clears the chip, and the same box then starts a new
  conversation.
- Generate with an anchor = edit anchored on that image. Generate with no
  anchor = create a conversation, then generate into it.
- Cap state is visible and explains itself.
- The anchor must survive a poll refresh landing mid-typing. This is where the
  ambiguity risk lives, and it is what a review of this slice should attack
  first.

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

## Running this in the cloud

Each slice below is a self-contained kickoff prompt for a cloud session at
`https://claude.ai/code` on the **prntd** repo. They assume no carried-over
context: paste one whole, in full.

**Before the first one:** this plan must be reachable. Either merge the PR
that adds it, or start the session with `git checkout docs/studio-plan`. A
cloud agent told to read a file that isn't on its branch will improvise.

**One slice per session, in order.** Slices 2–5 each build on the branch
before them, so let each land before starting the next. Do not run a local
session on a branch a cloud agent is pushing to.

Every prompt ends with the same gates because every one of them has been
skipped by an agent at least once here: `npm run lint`, `npm run typecheck`,
`npm test`, `npm run build`. Typecheck is the one CI has caught.

### Slice 1

> Read `docs/studio-plan.md`, then implement **Slice 1 only** ("Generate
> always generates"). Do not start slices 2–5.
>
> Three live defects, all verified against the prod database:
> (1) `prepareGeneration` in `src/app/design/actions.ts` bails to a clarifying
> question instead of generating — the Haiku readiness pre-check around :304,
> and `brief.operation === "clarify"` around :323. Generate must always
> produce a generation.
> (2) When the brief wants to clarify, render anyway and attach the question
> alongside the result. A question is never a substitute for a render.
> (3) Enter sends a chat message while the button generates, so both produce
> text and no image. One submit control; Enter generates.
>
> Quota: any path that spends a unit without creating an `image_generation`
> row must refund it.
>
> Acceptance: type the verbatim string "dog doing calesthenics" (sic), press
> Generate, get an image. Pin that exact string in a test the way PR #142
> pinned #137's repro. Use TDD.
>
> No schema change is needed. If you think you need one, stop and say so.
> Run lint, typecheck, test and build before opening the PR.

### Slice 2

> Read `docs/studio-plan.md`, then implement **Slice 2 only** (the Studio read
> model and screen). Do not build the composer or anchoring — that is slice 3.
>
> Add `/studio`: lanes are the signed-in user's open conversations
> (`design.closed_at is null`), most recently active first; cells are that
> conversation's images in creation order; a running `image_generation` row
> renders as a pending cell with elapsed time. Read-only. Nothing in the nav
> points here yet.
>
> Assemble lanes in one query path with no N+1 per conversation, and test it
> against a real database using the existing harness in
> `src/lib/__tests__/test-db.ts`. Poll for in-flight work with the existing
> machinery — `src/lib/generation-poll.ts` already holds the backoff logic and
> `getDesignJobs` already exists.
>
> Phone-first: judge every layout decision at 390px wide. Copy follows the
> Clean Label voice in `docs/design-system.md` Part 1 — plain and quiet.
>
> No schema change is needed. Run lint, typecheck, test and build before
> opening the PR.

### Slice 3

> Read `docs/studio-plan.md`, especially the three settled decisions under
> "Slice 3 — Anchor and composer", then implement **Slice 3 only**.
>
> Tapping a cell anchors it. The docked composer carries a chip holding a crop
> of the anchored image plus a dismiss control; dismissing clears the anchor
> and the same box then starts a new conversation. Generate with an anchor is
> an anchored edit of that image; Generate with no anchor creates a
> conversation and generates into it. The concurrency cap is visible and
> explains itself.
>
> Three decisions are already made — do not relitigate them: the composer
> stays docked (not a per-lane sheet), the anchor stays where the user put it
> (it never advances to a result), and a lane opens scrolled to its newest
> image.
>
> The anchor must survive a poll refresh landing mid-typing. That is the
> failure mode most worth a test.
>
> No schema change is needed. Run lint, typecheck, test and build before
> opening the PR.

### Slice 4

> Read `docs/studio-plan.md`, then implement **Slice 4 only** (auto-archive).
>
> A conversation with no activity for 3 days leaves the Studio by having
> `design.closed_at` set. Activity means a chat turn, a generation, or a
> primary-image change. `closed_at` already exists and already means
> "read-only record", `assertConversationOpen` already enforces it, and Reopen
> already exists — this slice adds a new *writer* of that state, not a state.
>
> Sweep lazily on reads that already happen (the Studio's own load), with the
> existing `sweep-generations` cron as the backstop. **Do not add a cron**:
> `vercel.json` is at Vercel Hobby's two-cron limit. Copy the shape of
> `sweepStaleJobs` in `src/lib/generation-job.ts`, including its
> `scope: "user" | "all"` argument.
>
> Never archive a conversation that has a running generation. Add an archive
> list, and make reopening return the lane to the Studio.
>
> No schema change is needed. Run lint, typecheck, test and build before
> opening the PR.

### Slice 5

> Read `docs/studio-plan.md`, then implement **Slice 5 only** (My Designs as
> the library, and the navigation).
>
> My Designs becomes a grid of the user's images rather than one card per
> conversation. The image detail page at `/d/[imageId]` already handles
> owner-private images; give it an "Open conversation" action that reaches the
> source conversation, reopening it if it had archived. Studio and My Designs
> become nav peers, and a signed-in user lands on the Studio.
>
> Ship every image, with no explicit keep/save action — see the open question
> in the plan.
>
> No schema change is needed. Run lint, typecheck, test and build before
> opening the PR.
