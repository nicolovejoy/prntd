# Design ↔ image data-model gap

Captured 2026-05-05 after a stuck "Loading preview…" episode and a
follow-on confusion: regenerating a design for the iPhone case produced a
new image that surfaces as the card thumbnail on `/designs` but is
**invisible from `/design?id=…`**. This document inventories the gap so we
can plan the rework — it does **not** propose a fix.

## What the user did and saw

1. Generated a 1:1 design from `/design`.
2. Hit `/preview?id=…&product=tee` — looked fine.
3. Switched product to `iphone-case` (1:2 aspect). `regenerateForPlacement`
   fired, produced a new image at the phone-case aspect. Preview rendered.
4. Returned to `/designs` — the **card thumbnail** is the new (1:2) image.
5. Opened that design from `/designs` → `/design?id=…` — the new image is
   nowhere in the chat thread. The thread shows only the original 1:1
   generations as if the regen never happened.

## The current shape of the data

### `design` row (singular, current as-of)

- `chatHistory` — JSON array of `ChatMessage`. Each assistant turn that
  produced an image stores `imageUrl` + `fluxPrompt` inline.
- `currentImageUrl` — pointer to whichever image is "active" right now.
  Mutated by `regenerateForPlacement` (preview/actions.ts:184).
- `mockupUrls` — Printful mockup cache keyed by
  `productId:colorName:scale`.

### `design_image` table (Phase 2 of print-targets, dual-read since 2026-05-03)

- One row per generated image, with `aspectRatio`, `productId`,
  `placementId`, `parentImageId`, `prompt`, `generationCost`, `isApproved`.
- Populated by both `generateDesign` and `regenerateForPlacement`.
- **Not** read by `/design` for gallery rendering. Only read where
  Phase 2 dual-read was wired (orders / placements lookup).

## Where the data goes when each surface writes

### `generateDesign` (chat → image, src/app/design/actions.ts:63)

- Appends an assistant `ChatMessage` to `design.chatHistory` carrying
  `imageUrl` + `fluxPrompt`.
- Inserts a `design_image` row.
- Updates `design.currentImageUrl`.

→ Image is visible in `/design` (because it's in chatHistory) **and** in
the `/designs` card (because it's `currentImageUrl`). Both surfaces agree.

### `regenerateForPlacement` (preview product switch, src/app/preview/actions.ts:110)

- Does **not** touch `chatHistory`.
- Inserts a `design_image` row with `productId` + `placementId` set.
- Updates `design.currentImageUrl` to the new render.

→ `/designs` card thumbnail (uses `currentImageUrl`) shows the new image.
`/design` gallery (reads `chatHistory`) does not. The `design_image` row
exists but is unreferenced from the chat surface. The original 1:1 images
are still in `chatHistory`, so the thread is intact, but the regen is
ghost data from the user's perspective.

### `selectImage` (gallery click, src/app/design/actions.ts:191)

Sets `design.currentImageUrl` to a previously-generated chat image. Has
no idea `design_image` exists.

## What's structurally missing

1. **No single source of truth for "images that belong to this design."**
   - Chat-driven generations live in `chatHistory[].imageUrl`.
   - Placement regenerations live in `design_image`.
   - The card thumbnail uses `design.currentImageUrl`, which can point at
     either, with no way for the consumer to know which.

2. **`design.currentImageUrl` is overloaded.** It's three things at once:
   - "the image whose mockup is on screen in /preview" (transient UI
     state masquerading as persisted state),
   - "the image to send to Printful at order time" (durable per
     placement),
   - "the thumbnail for /designs cards" (a card-level concern).
   These three want different lifecycles. The first should be URL state.
   The second should be per-placement. The third should be a stable
   "primary" pick that doesn't shift when the user merely browses
   products.

3. **Regenerations are missing from the chat thread.** Treating a
   placement regen as a non-chat side effect breaks the thread's job as
   the canonical "history of this design." If the regen is conceptually a
   new fork ("this design but reshaped for phone-case"), it should be
   visible there — or it should be a separate object entirely
   (a `design_variant` per placement, owned by but not collapsed into the
   parent thread).

4. **No model of "primary illustration vs per-target render."** Phase 2's
   `parentImageId` was supposed to support this — but nothing actually
   *uses* the parent linkage to render a "this is the source, these are
   its rephrasings for tee / phone-case" view. Today every regen is just
   a sibling row with `parentImageId` pointing at some prior row, but no
   surface walks that graph.

5. **Order/placement coupling is implicit.** `order.placements.front`
   eventually points at *one* `design_image` per placement, but the act
   of "picking which image goes on the tee front vs the phone case" is
   driven by `currentImageUrl` being whatever happened to be on screen
   when the user clicked Use this design. There's no explicit
   per-placement selection step.

6. **Text layers (Phase 2 of design-loop rethink, not yet built) will
   make this worse.** A composited PNG is yet another image with a
   different lifecycle (depends on raw illustration + text params).
   Without resolving the gap above, text-layer composites will become a
   *fourth* category of image that some surfaces see and others don't.

## What "the right shape" might look like (sketches, not decisions)

Three rough shapes worth thinking about before committing:

### A. Promote `design_image` to canonical, retire chat-embedded `imageUrl`

- Every image (chat-driven or regen) is a `design_image` row.
- `chatHistory` stops carrying `imageUrl` — assistant turns reference a
  `designImageId` instead, or the gallery renders directly from
  `design_image` ordered by `createdAt`.
- `design.currentImageUrl` is removed (already flagged for Phase 3 of
  print-targets).
- Per-placement selection becomes an explicit `design_image.id` chosen
  per placement, persisted on `order` rows or on a new
  `design_placement_selection` table.

### B. Treat per-placement renders as a "variant" object distinct from the chat thread

- `design` owns the chat thread (1:1 illustrations only).
- A new `design_variant` (per placement) holds the targeted renders, with
  `parentDesignImageId` pointing at the chat-thread illustration it was
  derived from.
- `/design` shows only the chat thread (no surprise images).
- `/preview` shows the active variant for the current product.
- `/designs` card thumbnail picks the most recent variant *or* the most
  recent chat illustration — explicit rule, not whatever happened to win
  the last write to `currentImageUrl`.

### C. Status quo + display reconciliation

- Keep both stores. Make `/design` read `design_image` rows for this
  design that aren't already in the chat history, and append them as a
  synthetic assistant turn ("Reshaped for iPhone case — *thumbnail*").
- Cheaper but accumulates technical debt; doesn't solve the "what
  belongs to this design" question, just papers over it.

## Why "Phase 3 of print-targets" alone may not be enough

The existing plan in `docs/print-targets-plan.md` Phase 3 says: "remove
`design.currentImageUrl`, switch readers to `design_image`." That's
necessary but not sufficient. It addresses #2 above, but not #1, #3, or
#4 — chat-embedded `imageUrl` is still the truth for `/design` even
after currentImageUrl goes away, unless we also rewrite gallery render to
read from `design_image`.

## Non-goals of this doc

- Picking option A / B / C.
- Sequencing the rework against Phase 2 (text-as-layer).
- Migrating data.

## Adjacent symptom: "Loading preview…" hang

Same `/preview` page exhibited a separate but related fragility today:
`getDesign(designId).then(...)` at `src/app/preview/page.tsx:87` has no
`.catch`. If `getDesign` throws (unauthorized, DB blip, design id from a
stale link), `loading` never flips and the page sits on "Loading
preview…" forever with no error surfaced. Worth fixing whenever the
preview page next gets touched, regardless of the data-model rework.

## Adjacent symptom: regen spinner hangs forever (recurrence of #15)

Repro 2026-05-05, web/Mac/Chrome on prntd.org. User clicked "Clear
iPhone Case" from a 1:1 design. The design itself rendered on the
silhouette (text visible underneath the spinner) but
`"Preparing your design for the Clear iPhone Case…"` overlay never
cleared and CTA stayed at `Preparing design…`. Console: clean. Network
tab: two `POST /preview?id=…&product=clear-c…` 200 responses (2.2 KB
and 2.0 KB) — server action returned twice, successfully, but the
client never cleared `regenerating`.

This is issue #15 ("silent regen hang on second product switch")
recurring. Diagnostic logging shipped in `3ff1ab4` lives server-side
(`regenerateForPlacement`); next investigative step is to read Vercel
logs for that designId and timestamp, not to add more client logging.

Suspected client-side mechanism worth scrutinising during the rework:
the seq-guard pattern at `src/app/preview/page.tsx:204-231`. When two
regen attempts overlap, only the latest is allowed to clear the
spinner (line 228: `if (seq === regenSeqRef.current)`). If the latest
attempt errors after the seq increment but before resolution — or if
React unmounts/remounts the regen surface during the call — the
spinner can be left stuck even though earlier attempts completed.
Pairs of 200 responses in the network tab is consistent with this.

This isn't strictly a data-model issue, but it shares the same surface
(`/preview` orchestrating placement-aware regeneration on top of a
chat-driven design) and the same root cause class: too much UI state
is derived from interleaved server actions without a single
authoritative "current placement render" object to read from. A rework
that promotes `design_image` to canonical (option A above) makes the
spinner state derivable rather than imperative.

### Vercel log evidence (same session, 2026-05-05)

```
15:45:11.08  POST /preview
regenerateForPlacement: design=1d8bbdf3-e62e-4b0a-bf47-1e40fb697756
                       product=clear-case-iphone target=1:2 promptLen=718
```

Server received the request and started the regen. No corresponding
completion log (the function logs the start but not the success path —
filed as a small follow-up). The user reloaded after the spinner
hanging too long, at which point the regen ran cleanly and produced
the case preview shown below.

## Adjacent symptom: regen drifts visually from the original

Same session, after reload: `regenerateForPlacement` succeeded, but the
new render bears no resemblance to the original design. Original was a
black "DON'T BELIEVE YOUR THOUGHTS" hand-lettering composition. The
phone-case render came back as Japanese-style ink-brush glyphs — same
prompt, completely different look.

This is documented but not solved at `src/app/preview/actions.ts:144-146`:

> Style reference (using the existing image as a look anchor) is not
> yet wired through the direct API — re-renders may drift visually.

Implication for the user: clicking "Clear iPhone Case" feels like
"reshape my design for a phone case" but actually behaves as "throw
away my design and re-roll the prompt at a different aspect." Same
class of trust violation as the chat-history-doesn't-show-the-regen
issue at the top of this doc — the user's mental model says "this is
my design," the system's behaviour says "your design is whichever
roll of the dice the prompt happens to produce this time."

Two halves of the same fix:

1. Wire style-reference into the direct Ideogram API call so re-renders
   anchor on the prior image.
2. Decide what "my design" means as a first-class object (option A / B
   / C above). If a placement regen produces a different look, the user
   should be able to *see both* and pick — that requires the variants
   to be addressable, not silently overwritten.

## Next step (process, not code)

Before scoping a fix: pick A / B / C (or a fourth) at a session start.
The choice has knock-on effects on the Phase 2 text-layer plan
(`docs/phase-2-text-as-layer-plan.md`) — composite PNGs need to live
somewhere, and where they live depends on the answer here.
