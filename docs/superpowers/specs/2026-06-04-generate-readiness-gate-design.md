# Generate-readiness gate — design

Date: 2026-06-04
Branch: `feat/multi-generator` (folds in with the multi-generator work)

## Problem

The `/design` chat input presents **Send** and **Generate** as co-equal
buttons. Nothing enforces the "chat to refine, then Generate" order the empty
state suggests, so users hit Generate on a thin description. When that
description lacks a style, the chat agent (correctly) asks a clarifying
question instead of rendering — which, before today's fix, 500'd, and even now
produces a no-image round-trip that feels like a dead click.

We want the UI to nudge users to develop the idea in chat first, and to reflect
the agent's own judgment of when the idea is concrete enough to render.

## Decisions (from brainstorming)

- **Soft nudge, not a hard gate.** Generate (and Compare) look greyed/dimmed
  until ready, with a tooltip, but stay clickable. A wrong readiness call never
  blocks the user; the clarification safety-net (already shipped) catches a
  too-thin prompt if they override.
- **Readiness is Claude-driven**, not a message count. The chat agent emits a
  `readyToGenerate` boolean; the button reflects it.
- **Ready rubric: subject AND style both concrete.** Ready only when both WHAT
  (subject/content) and HOW (visual style/medium) are clear. Subject-only is
  not enough — that is exactly the case that tripped the Esalen tiger.
- **Compare shares the gate.** It runs both models (~$0.11), so it should not be
  easier to fire prematurely than Generate. Both grey/brighten in lockstep.

## Where the signal comes from

The idea is developed in the **chat** path (Send → `chatAboutDesign`), so that
is where readiness is assessed.

- `chatAboutDesign` returns `{ message, readyToGenerate }` (was `{ message }`).
  `CHAT_SYSTEM_PROMPT` switches to raw-JSON output, mirroring the existing
  `constructFluxPrompt` pattern:
  ```json
  { "message": "...conversational reply...", "readyToGenerate": true|false }
  ```
  Rubric in the prompt: set `readyToGenerate: true` only when the conversation
  pins down both a concrete subject and a concrete visual style/medium;
  otherwise `false` (and the `message` should be the question that moves toward
  one of those).
- **Parse failure → `{ message: <raw text>, readyToGenerate: false }`.** Safe
  degradation: the button stays greyed, the user can still override.

The **Generate** path reinforces the same state:
- A successful `generateDesign` → ready = true (you clearly had something
  concrete).
- The clarification branch (empty `fluxPrompt`, shipped today) → ready = false,
  and shows Claude's question.
- `compareGenerators` mirrors: success → true, clarification → false.

So both server actions return a `readyToGenerate` hint alongside their existing
payloads, and `page.tsx` updates the single source-of-truth state from whichever
action last ran.

## State & initial value

`readyToGenerate` is React state in `src/app/design/page.tsx`.

- **Initial value = `images.length > 0`.** Opening an existing design that
  already has renders is immediately ready (the idea was clearly concrete enough
  to have produced images). A brand-new empty thread starts greyed.
- Updated on every chat send and every generate/compare result.

## Button behavior

In `src/app/design/chat-panel.tsx`, Generate and Compare gain a readiness-aware
appearance:

- **Not ready:** dimmed/greyed styling, still clickable,
  `title="Keep describing — I'll light this up when it's ready to generate."`
- **Ready:** normal primary (Generate) / secondary (Compare) styling.
- The existing `disabled={busy || (messages.length === 0 && !input.trim())}`
  hard-disable stays as-is (covers the truly-empty case and in-flight requests).
  Readiness only changes the *visual* emphasis + tooltip, not the disabled
  attribute — soft nudge, override preserved.

`ChatPanel` gains a `readyToGenerate: boolean` prop.

## Files touched

- `src/lib/ai.ts` — `CHAT_SYSTEM_PROMPT` → JSON output + readiness rubric;
  `chatAboutDesign` returns `{ message, readyToGenerate }` with safe-parse
  fallback.
- `src/app/design/actions.ts` — `sendChatMessage` passes the flag through;
  `generateDesign` / `compareGenerators` return a `readyToGenerate` hint
  (true on success, false on the clarification branch).
- `src/app/design/page.tsx` — `readyToGenerate` state (init from images),
  updated from each action's result, threaded to `ChatPanel`.
- `src/app/design/chat-panel.tsx` — `readyToGenerate` prop; greyed/bright
  styling + tooltip on Generate and Compare.

## Testing

- `ai.ts` is the testable unit. Add cases for `chatAboutDesign`'s parsing:
  valid JSON with `readyToGenerate` true/false → passed through; malformed
  JSON → `{ message: raw, readyToGenerate: false }`. (Mirror the existing
  `constructFluxPrompt` test style; Anthropic client mocked.)
- Button styling / state threading is presentational — covered by the manual
  smoke test on `/design`, not unit tests.

## Out of scope

- No change to the Generate-button hard-disable logic or the Compare cost.
- No "Generate this →" affordance inside chat bubbles (that was the rejected
  third brainstorming option).
- No persistence of readiness across reloads beyond the `images.length > 0`
  initial heuristic — it is ephemeral UI state.
