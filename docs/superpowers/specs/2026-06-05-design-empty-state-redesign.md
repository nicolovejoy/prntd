# /design empty-state redesign — design

Date: 2026-06-05
Branch: `feat/readiness-gate` (rides alongside the readiness-gate + fast-readiness work)
Status: approved (brainstormed with visual companion 2026-06-05). NOT yet implemented.

## Problem

The `/design` empty state is cluttered and unfocused:

- The input sits at the very bottom of the screen — far from where attention lands.
- The "Generations" column is always shown, even with no images ("No images yet").
- Generate and Compare are visible before there's anything to generate from.
- The generating-state copy ("rendering" / rotating filler) reads as off.

The page should open as a single, centered idea box and reveal the working
machinery (chat column, Generations, Generate/Compare) only once it's useful.

## Approved design — Layout A: centered composer

### Empty state (no chat messages, no images)

Shows ONLY:

- Page chrome: PRNTD bar + breadcrumb + page title **"Start designing"**.
- Vertically + horizontally centered:
  - Hero heading: **"What shall we draw together?"**
  - Subphrase: **"Describe it in plain words. Refine as we go."**
  - The input + **Send** button.
- **No** Generations column. **No** Generate/Compare buttons. **No** visible example chips on load.

### Delayed suggestions

- Example chips are hidden initially.
- After **4 seconds of inactivity** (input empty and untouched), a quiet
  **"Need a suggestion?"** label fades in with ~3 example chips
  (e.g. "Minimalist mountain landscape", "Retro sunset, palm trees",
  "Geometric wolf head"). Clicking a chip fills the input.
- The moment the user types, the suggestion block disappears. (Re-arming after
  it's been shown once is unnecessary — once they've engaged, drop it.)

### Submit behavior (chat-first — the simple model)

- Enter / Send submits the text as a **chat message** (`sendChatMessage`).
  No "smart routing", no direct-generate from the empty box.
- The first message transitions the view from the centered empty state to the
  **existing two-column working layout** (chat + Generations). That working
  view is unchanged: Generate/Compare appear there, behind the readiness gate
  already built on this branch.

### Generating message

- Replace the rotating filler with a plain status while an image renders:
  **"Drawing your design…"** alongside the existing spinner.
- Keep the chat "Thinking…" indicator as-is (it's the chat reply, not a render).
- Surface a real error state if the render fails (retry affordance already
  exists on `/preview`; mirror that intent here if not present).

## What drives "empty vs working"

The split is a pure function of content: **empty state when there are zero chat
messages AND zero images; working layout otherwise.** No new persisted flag —
derive it from the data `page.tsx` already loads (`messages`, `images`).

## Components touched

- `src/app/design/page.tsx` — branch between the centered empty state and the
  two-column working layout based on `messages.length === 0 && images.length === 0`.
  Conditionally render the Generations column / `ImageGallery` only when there's
  content (or while generating).
- `src/app/design/chat-panel.tsx` — centered empty-state composer (heading,
  subphrase, input, Send only); the 4s-inactivity "Need a suggestion?" reveal;
  hide Generate/Compare while in the empty state.
- `src/app/design/image-gallery.tsx` — not shown in the empty state; "Drawing
  your design…" generating copy.

## Testing

- Mostly presentational → manual smoke on `/design`.
- The one piece of real logic worth a unit test: the empty-vs-working predicate
  (zero messages AND zero images → empty), as a pure helper.
- The 4s reveal is a timer effect — verified by smoke, not unit test.

## Out of scope

- The working two-column layout itself (unchanged).
- The readiness gate and the fast `assessReadiness` latency fix — already
  implemented on this branch; this spec only changes the empty state + the
  generating copy.
- Mobile-specific reflow tuning beyond "centered composer collapses sensibly on
  a phone" — phone-first, but no bespoke mobile mockup yet.
```
