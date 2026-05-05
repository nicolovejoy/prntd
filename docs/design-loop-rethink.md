# Design loop — reality, constraints, and candidate UIs

Working doc for rethinking the `/design` UI. Captures what's actually true about the system today, what fences any redesign, and four candidate UIs sketched as user journeys. Synthesis (§4.5), locked decisions (§3), post-pick journey (§7), and non-goals (§8) added 2026-05-05 after the planning pass and Phase 0/1 ship.

Date: 2026-05-04 (initial), 2026-05-05 (synthesis + locked decisions)

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

## 3. Locked decisions (was: open questions)

These were open at the time the journeys were drafted. After the 2026-05-05 planning pass with Nico, they are now decided. The journeys remain in §4 as historical context; the build follows §4.5 Synthesis.

- **Where structure enters the flow:** Middle. An editable brief is shown after chat capture, before generation. Not an upfront form.
- **How many generations per click:** Three. Batch-of-3 over single-shot.
- **How much the user describes:** Free-form chat captures intent; the structured brief renders that capture as editable fields the user can adjust before generating. Genre is a *suggestion inside the brief's style field*, not a separate flow.
- **Where text comes from:** Native text layer is the default; AI-rendered text is an opt-in escape hatch for hand-lettered or integrated-typography looks.
- **What "iterate" means:** Discrete editorial moves on a chosen base (Bolder / Simpler / More vintage / Try 3 similar / Better for dark shirts). Free chat stays as a fallback.

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

## 4.5 Synthesis — what we're actually building

The four journeys read as alternatives but the answer composes them. After two AI peer reviews and a hands-on session, the build is:

**Journey B + Journey D, with Journey C folded into B as a hint.**

- **From D:** native text rendering is the default. Text is an app-composited layer over the AI illustration. AI-rendered text becomes opt-in for the cases where it's actually wanted (hand-lettered, integrated typography). This permanently retires the loudest failure mode: "Ideogram refused to spell BEST BOY correctly."
- **From B:** chat captures intent → editable brief → batch-of-3 → pick → discrete refinements. The brief is the structure that lets us run a useful batch instead of a guess.
- **From C, embedded in B:** genre lives as a *suggestion inside the style field of the brief* ("playful sticker," "vintage badge," "hand-drawn cartoon"). It's not a separate flow; it's the vocabulary the brief uses for `style`.

Build order = phase order. Each phase ships independently and has standalone value:

- **Phase 0** (shipped 2026-05-04, commit `cf5f93f`) — Ideogram native-transparent swap. Stable image pipeline before anything is built on top.
- **Phase 1** (shipped 2026-05-05, commit `9647622`) — Negation rewriting in the chat advisor's system prompt. Affirmative-only `fluxPrompt`, rule-coded examples in-prompt.
- **Phase 2** (next, ~1 week) — Text-as-layer. Schema (`design_image.textLayers`), font catalog, server-side compositing (`@vercel/og` + `sharp`), text-control UI panel with live preview. AI-rendered text escape hatch preserved.
- **Phase 3** (~1 week) — Structured brief + batch-of-3. New `design.brief` JSON column, `BRIEF_SYSTEM_PROMPT`, parallel batch generation, refinement controls bar.
- **Phase 4** — Doc updates (this section).

Plan source of truth: `/Users/nico/.claude/plans/feedback-for-the-coding-woolly-snowflake.md`.

---

## 5. What's not in any journey (but probably should be)

These cross-cut all four:

- **Negations are rewritten in the chat advisor's system prompt — not as a deterministic post-processing pass.** Claude restates "no tongue" → "mouth closed, lips together" naturally before constructing the image prompt; `fluxPrompt` is positive-only. Implemented in `src/lib/ai.ts` (Phase 1, commit `9647622`).
- **The advisor doesn't say "I'll fix it."** It says "I'll try a closer version" or "I'll aim for X." Keeps the contract honest. Implemented as part of Phase 1.
- **Print-readiness check before order.** Is the text readable at shirt scale? Is the design viable on dark shirts? This is downstream of the design loop but should always run.

## 6. What we're betting against

It's worth being explicit about the bets *not* taken in any of the journeys above:

- **Inpainting / mask-and-edit.** Real fix for "change one corner" but expensive to build, requires user to learn masking, and Ideogram v3 may already offer remix/edit endpoints we haven't audited. Defer until journey-style data shows the demand survives the simpler fixes.
- **Multi-turn freeform chat as the primary loop.** Tempting because it feels modern, but every additional turn is a chance for the chat metaphor to over-promise and the image model to drift.
- **Designer-marketplace shortcuts.** "Pick a featured design and remix it" sidesteps the design loop entirely. Worth building (issue #6 / Phase 0 sketch in `next-phase.md`) but doesn't replace the question of what the from-scratch loop should be.
- **AI-rendered text as the default.** This is the headline non-bet. The complexity of Phase 2 (font catalog, layer compositor, print-resolution rendering) is intentional and not negotiable — it's the price of permanently retiring the "wrong text" failure class. Google Fonts covers all v1 needs (license non-issue), so the cost is engineering, not licensing.

## 7. Post-pick journey

The journeys above all stop at "user picks a design." That's where the design loop ends, but the path to a placed order continues. This section sketches the downstream commit-or-regret flow and validates that upstream choices (transparency, dark/light suitability, native text) inform it.

After the user taps "Use this design" on a chosen batch result:

1. **Land on `/preview`.** Mockup renders with the composited PNG (illustration + native text layer, if any). Product selector across the top — Classic Tee, Box Tee, Women's Relaxed Tee, Clear iPhone Case.
2. **Color picker** — for shirts, a color row above the mockup. The transparency choice from Phase 0 means the design works equally on dark and light. Hovering / tapping each color re-renders the mockup with cached Printful previews.
3. **Switch product** — picking the iPhone case re-renders the design at 1:2 via `regenerateForPlacement`. Native text layer survives the regeneration unchanged (text layer is composited app-side, not part of the AI illustration). Spinner state has a known reliability gap (issue #15) — fix queued.
4. **Refine design** link — backs the user into `/design` with the conversation preserved. Text layer state on `design_image` follows the user back so they can adjust.
5. **Use this design** → `/order`. Size + color confirmation, pricing breakdown.
6. **Order/confirm** — Stripe Checkout. Webhook fires → Printful order with the composited PNG URL. Customer never sees the underlying separation between illustration and text layer.

What this validates about upstream choices:
- Transparency is load-bearing: the color picker only works as a no-regen interaction because the design is already RGBA.
- Native text layers must survive cross-product regeneration. The `parentImageId` provenance chain on `design_image` is the mechanism.
- The "AI-rendered text" escape hatch must follow the design through `/preview` and `/order` without divergence between what's previewed and what's printed.

Open issue tracked: #15 (silent regen hang on second product switch).

---

## 8. Non-goals for this build

Listed here so the implementer doesn't scope-creep. Mirrored from the plan file.

- Inpainting / mask-and-edit / region-select editor.
- Multi-text element layouts (single text element only in v1).
- Marketplace, design forking, or remix flows in the design loop. Marketplace is a separate workstream.
- Save / load / collections beyond the existing `design.status="draft"` persistence.
- Designer profile pages, accounts, or any social surface.
- Auto-syncing fonts, models, or product catalog.
- A general-purpose layer compositor — only what's needed for AI illustration + one text layer.
- Migrating off `@anthropic-ai/sdk` / changing the model stack as part of the design-loop work.

If a need surfaces during build for any of these, file a GH issue and continue.

---

## 9. How to use this doc

The synthesis (§4.5) and locked decisions (§3) are the build target. Phase order is the build order. Open the plan file (`/Users/nico/.claude/plans/feedback-for-the-coding-woolly-snowflake.md`) for the implementation specifics; this doc is the why and the journey sketches that justify the synthesis.

For UI work, pick a phase and treat its journey scenes (steps 1–8 within Journey B / D) as the screens to design phone-first.
