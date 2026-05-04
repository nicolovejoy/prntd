# Design loop — reality, constraints, and candidate UIs

Working doc for rethinking the `/design` UI. Captures what's actually true about the system today, what fences any redesign, and four candidate UIs sketched as user journeys. Not a decision — input for one.

Date: 2026-05-04

## 1. Reality

### What the system is

The "design loop" is two LLM calls plus an image model, dressed as a chat:

1. **Claude Sonnet 4.6** plays two roles: a conversational advisor that talks with the user about their idea, and a prompt constructor that translates the conversation into an image-generation prompt. Both roles share the chat history.
2. **Ideogram v3 Turbo (via Replicate)** generates the image from that prompt. Returns RGB on a flat background.
3. **Background removal model** strips the background to RGBA so the design prints cleanly on any shirt color.

Each user turn is one of: a fresh generation, a refinement (new generation with the previous image attached as a style/composition reference), or a chat turn that doesn't generate.

### What chat actually means here

The UI looks like Claude.ai. The user assumes the system accumulates understanding and edits an existing image. It does neither.

- The chat assistant accumulates conversation context (real).
- The image model has no memory between calls. Every generation is a fresh prompt. The previous image can be attached as a *reference* (weak-to-medium influence on style and composition), but the model is not editing it.

This mismatch — chat metaphor implies editing, system delivers regeneration — is the source of most user frustration.

### What works reliably

Things the image model honors well:

- Subject (a dog, a scale of justice, a mountain)
- Broad style (vintage, sumi-e, pen-and-ink, halftone)
- Color palette in broad terms
- Mood (playful, serious, retro)
- Short text strings (Ideogram is good at typography for short phrases)

### What doesn't work reliably

- Negation. "No tongue," "no bubble letters," "don't make it cartoonish" — the model frequently ignores or inverts.
- Preservation. "Same design but with X different" — fresh generation drifts on everything.
- Region edits. "Make only the eyes blue" — no native support in the current pipeline.
- Specific stylistic guarantees. "Solid black text" → may render as outlined / hollow letters anyway.
- Exact lettering across iterations. Fonts and weights drift turn to turn.
- Text rendering past ~5 words. Long phrases break.

### What the chat advisor was doing wrong

Claude's chat system prompt described design constraints (DTG, print area, etc.) but never described *what the UI lets the user do.* When the user asked about transparency, the model invented a "Remove Background" button. When pushed back on, it invented a different version of the same fake button (over-deference).

Fixed today. Prompt now lists the actual UI surface and bans inventing interactions. The model has not yet been taught to rewrite negations into positive targets — that's an open improvement.

## 2. Design constraints

Anything we redesign has to live with these. Listed here so they don't get lost in journey sketches.

### Inherent to the model stack

- **Generation is not editing.** Any UI that implies surgical preservation is a lie.
- **Negation is unreliable.** Any "what to avoid" input has to be rewritten upstream into a positive target before it reaches the image model. The user shouldn't be the one doing this rewriting.
- **Per-generation latency: 5–15 seconds.** Anything that asks the user to wait twice in a row will feel broken.
- **Per-generation cost: ~$0.03.** Cheap individually, but a 10-iteration session burns ~$0.30 of compute. Not unsustainable, but waste at scale.
- **Text rendering quality is finite.** Even Ideogram's strong typography handling fails on long phrases or specific font instructions.

### Inherent to the product

- **Phone-first.** Most of the audience is on a phone. The UI has to work in a thumb-reachable column.
- **Non-technical buyers.** Users want a shirt; they don't want to learn prompt engineering, masking, or model behavior.
- **One-shot purchase intent.** Most users come to make *one* design and buy *one* shirt. They are not exploring a creative practice. The loop should converge fast.
- **Output has to be print-ready.** Transparency, sufficient resolution, readable at shirt scale, works on shirt colors the user will pick.
- **Solo dev + occasional collaborator.** No large UI team to maintain a complex multi-mode editor.

### Inherent to the business

- **Conversion is the goal.** Time-on-design without an order is wasted compute. Every UI choice should ask: does this make a stranger more likely to finish the order?
- **Mission framing matters.** PRNTD's pitch involves charity; the design loop is the moment the visitor decides whether the product is worth supporting it through.

## 3. Open questions the journeys probe

Each candidate journey below is a different bet on these:

- **Where should structure enter the flow?** Up front (intake form), middle (brief shown for confirmation), or end (refinement controls)?
- **How many generations per click?** One image per round, or N variants?
- **How much should the user describe?** Free-form prose, structured fields, or genre-anchored templates?
- **Where does text come from?** The image model, an app-rendered overlay, or a hybrid?
- **What does "iterate" mean?** Free-form chat, discrete editorial moves (variations / swap-style / redo-text), or branching from a chosen base?

## 4. Candidate user journeys

Four different bets. Sketched as a non-technical user trying to make a "BEST BOY" dog t-shirt for their nephew's birthday. None of these are recommendations — they're concrete enough to compare.

---

### Journey A — Current chat loop (baseline)

The reality today, for comparison.

1. User lands on `/design`. Sees a chat box and a "Generate" button.
2. Types: "a dog with a tongue sticking out, says BEST BOY".
3. Hits Generate. Waits 8 seconds.
4. Image arrives: dog, but tongue is sideways and the "BEST BOY" letters are bubble-style outlines.
5. User: "no tongue, and make the text solid black."
6. Generate. Waits 8 seconds.
7. New image: tongue is gone, but it's a different dog now, and the text is still partially outlined. Also the shirt has a paw print background which wasn't there before.
8. User: "okay but bring back the original dog, just with mouth closed."
9. Generate. Waits 8 seconds.
10. Yet another dog. User gives up or settles.

**Tradeoffs:** Lowest cognitive load to start. Highest cognitive load by attempt 3. Encourages requests the system can't deliver. ~5–10 generations per finished design today.

---

### Journey B — Structured brief + batch-of-3

Chat captures intent, system shows what it understood, user confirms or edits, then a batch is generated.

1. User lands on `/design`. Sees a chat box.
2. Types: "a dog with a tongue sticking out, says BEST BOY".
3. **No generation yet.** Instead, the assistant returns a visible brief:
   - **Subject:** happy cartoon dog
   - **Text:** "BEST BOY"
   - **Style:** playful sticker graphic
   - **Lettering:** bold, readable
   - **Print:** transparent background, suited for shirt of any color
4. Each field is editable inline — user can tap "Style" and switch from "playful sticker" to "vintage badge" without rewriting the whole prompt.
5. User confirms. System generates **three distinct directions** in parallel:
   - Direction 1: clean sticker
   - Direction 2: vintage badge
   - Direction 3: hand-drawn cartoon
6. User picks Direction 2. Now the loop narrows: refinement controls appear ("more readable text," "simpler," "bolder," "try 3 similar"). Free chat is still available but secondary.
7. User taps "more readable text." System generates one new image based on Direction 2 with the refinement applied. Waits 8s.
8. User happy. Hits "Use this design."

**Tradeoffs:** First success is more likely (3 chances, structured prompt). User feels understood. Latency on first round is the same (~10s, parallel) but generation cost is 3× per click. More UI to build. Risk: structured intake feels like a form, less "magical."

---

### Journey C — Genre-anchored start

Skip the open-ended description. User picks a genre first; the prompt is heavily templated; user fills in the variable bits.

1. User lands on `/design`. Sees a grid of t-shirt design archetypes:
   - Vintage badge
   - Mascot sticker
   - Typographic joke
   - Retro illustration
   - Punk zine
   - Minimalist line drawing
   - Other (free chat)
2. User taps "Mascot sticker."
3. Form appears:
   - Mascot subject: "dog with tongue out"
   - Optional text: "BEST BOY"
   - Vibe: ☐ playful ☐ tough ☐ cute ☑ goofy
   - Color mood: ☑ bright ☐ muted ☐ dark
4. Hits Generate. Waits 8s. Returns 3 variations in the chosen genre (because genre constrains the prompt, drift between attempts is much smaller).
5. User picks one. Refinement controls appear, scoped to the genre — for "mascot sticker" they include "rounder shape," "simpler outline," "more expressive face."
6. User taps "more expressive face." Waits 8s. New image. Happy.
7. Hits "Use this design."

**Tradeoffs:** Highest first-shot satisfaction; the genre anchors the model so much that drift drops dramatically. User cognitive load is *lower* than chat (no blank-page problem). Sacrifices the long tail of weird requests — "I want a polaroid of a haunted refrigerator" doesn't fit a genre. Less "magical." Hard to make it feel like creative collaboration vs. filling out a form.

---

### Journey D — Hybrid: AI illustration + native text layer

The image model produces only the illustration. Text is rendered by the app in a separate layer the user controls deterministically.

1. User lands on `/design`. Two stacked composers visible:
   - **Illustration:** describe the picture you want
   - **Text:** what should it say (optional)
2. User types in illustration: "happy dog with tongue out, sticker style". Types in text: "BEST BOY".
3. Picks a font category (3 presets shown: Bold Block, Vintage Script, Hand-lettered). Picks Bold Block.
4. Picks layout (text above / below / arched / none).
5. Generate. Waits 8s. Image arrives: just the dog, no text in the image. App composites "BEST BOY" in Bold Block as a separate layer above the dog. Preview shows the composited result.
6. User wants the dog smaller. Drags a size handle on the dog layer. No regeneration needed.
7. User wants the text bolder. Taps a "weight: heavier" toggle. App re-renders text layer instantly.
8. Wants the dog with mouth closed. Hits "new dog" or refines the illustration prompt. *Only the illustration regenerates;* the text layer stays exactly the same.
9. Hits "Use this design."

**Tradeoffs:** Solves the entire category of "wrong text" complaints by removing text from the model's job. Gives users guaranteed exact spelling, font, color. Works against probabilistic image generation's biggest reliability gap. Adds engineering burden: layer composer, font catalog, font licensing, rendering for print export. Some users still want the unified hand-lettered look that only the image model can produce — needs an "AI-rendered text" escape hatch for that case.

---

## 5. What's not in any journey (but probably should be)

These cross-cut all four:

- **Negations are silently rewritten upstream.** "No tongue" → "closed mouth" before the prompt ever reaches the image model. Same fix in every journey.
- **The advisor doesn't say "I'll fix it."** It says "I'll try a closer version" or "I'll aim for X." Keeps the contract honest.
- **Print-readiness check before order.** Is the text readable at shirt scale? Is the design viable on dark shirts? This is downstream of the design loop but should always run.

## 6. What we're betting against

It's worth being explicit about the bets *not* taken in any of the journeys above:

- **Inpainting / mask-and-edit.** Real fix for "change one corner" but expensive to build, requires user to learn masking, and Ideogram v3 may already offer remix/edit endpoints we haven't audited. Defer until journey-style data shows the demand survives the simpler fixes.
- **Multi-turn freeform chat as the primary loop.** Tempting because it feels modern, but every additional turn is a chance for the chat metaphor to over-promise and the image model to drift.
- **Designer-marketplace shortcuts.** "Pick a featured design and remix it" sidesteps the design loop entirely. Worth building (issue #6 / Phase 0 sketch in `next-phase.md`) but doesn't replace the question of what the from-scratch loop should be.

## 7. How to use this doc

Hand this to a UI / product agent and ask: "given these constraints and these four candidate journeys, sketch the screens. Pick which journey to flesh out, or hybridize. What does each one *look like* in a phone-first column?"

Or: pick one journey and write three friction scenarios where it fails. The journey that fails *gracefully* in the most scenarios is the one to build.
