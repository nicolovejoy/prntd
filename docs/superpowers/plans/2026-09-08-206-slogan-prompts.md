# #206 — slogan-shaped prompts render as lettering, never as literal junk

**Source:** issue #206 + the 2026-09-08 local repro (issue comment): "statements are pointless" → brief `clarify` → `fallbackSpec` renders the sentence as an `obj`; "Partisanship averse" → brief `generate` but paraphrased the slogan to "AVERSE TO ALL OF IT"; "big dogs don't jiggle" → correct (dog + verbatim text). No spec doc; this plan is the spec.

## Global Constraints

- Two changes only: the brief system prompt (`DESIGN_BRIEF_SYSTEM_PROMPT` in `src/lib/ai.ts`) and `fallbackSpec` in `src/lib/design-spec.ts`. No schema, no UI, no change to `constructDesignBrief`'s parser.
- `fallbackSpec` stays a pure function; `DesignSpec` type unchanged.
- Existing test `"renders the user's own words as a valid spec"` in `src/lib/__tests__/design-spec.test.ts` currently pins `"dog doing calisthenics"` → an `obj` element. **Ruling:** that expectation CHANGES — a short prompt that reached the fallback (the brief found nothing drawable) is better served as lettering. Update the test; do not add a special case to keep it.
- Run `npm run lint`, `npm run typecheck`, `npx vitest run src/lib/__tests__/design-spec.test.ts src/lib/__tests__/ai.test.ts` before committing; full `npm test` once.

## Task 1 (batched): prompt rules + fallback backstop

### 1a. `fallbackSpec` backstop (`src/lib/design-spec.ts`)

Add `const MAX_SLOGAN_WORDS = 8;` next to `MAX_FALLBACK_SUBJECT`. In `fallbackSpec`, after computing the trimmed `subject`, if the text has at most `MAX_SLOGAN_WORDS` whitespace-separated words AND contains no newline, return:

```ts
{
  subject: `Bold lettering reading "${words}"`,
  elements: [{ type: "text", text: words, desc: "bold lettering, the user's words exactly, centered" }],
}
```

where `words` is the trimmed text (not truncated — it is ≤ 8 words). Otherwise keep today's `obj` shape. Update the docblock: the fallback fires only when the brief declined to produce a spec, i.e. it found nothing drawable; for a short prompt that means the words ARE the design (a slogan), so they render as lettering rather than as an object description of a sentence (#206).

Tests (`src/lib/__tests__/design-spec.test.ts`, `describe("fallbackSpec")`):
- change `"renders the user's own words as a valid spec"` to expect the text shape for `"dog doing calisthenics"`; rename it `"renders a short prompt as lettering, the words verbatim"`.
- add `"renders the #206 repro slogans as lettering"`: for each of `"statements are pointless"`, `"Partisanship averse"`, `"big dogs don't jiggle"` assert exactly one element, `type === "text"`, `text` equals the input verbatim, and `parseDesignSpec(spec)` is not null.
- add `"renders a long prompt as an object description, not lettering"`: a 12-word sentence → single `obj` element whose `desc` is the text; and a two-line prompt → `obj`.
- keep the essay-cap and empty-input tests as they are.

### 1b. Brief prompt rules (`src/lib/ai.ts`, `DESIGN_BRIEF_SYSTEM_PROMPT`)

1. Under "Choosing the operation", directly after the `"clarify"` bullet, add:
   `- A short phrase with no drawable subject — a slogan, a quip, a sentence — IS a design request: it is lettering. Emit a text element carrying the user's exact words, add an illustration only if one follows naturally from the words, and never answer it with "clarify".`
2. Under "Text in designs", add as the first bullet:
   `- When the user's turn reads as the text to print, the text element's "text" is those words unchanged (letter case may follow the typography). Do not paraphrase, shorten, or replace them with your own phrasing.`

Test (`src/lib/__tests__/ai.test.ts`, following whatever pattern the file already uses for prompt-content assertions — if there is none, add a small `describe("DESIGN_BRIEF_SYSTEM_PROMPT")`): assert the prompt contains `"it is lettering"` and `"Do not paraphrase, shorten, or replace"`. If `DESIGN_BRIEF_SYSTEM_PROMPT` is not exported, export it (it is a const string; exporting is harmless).

Commit as one commit: `#206: slogan prompts render as lettering — brief rules + fallbackSpec text backstop`.

## Verification after merge (Nico, not CI)

`node --env-file=.env.local --import tsx scripts/repro-206-brief.ts` — expect all three prompts `generate` with a verbatim `text` element. If "statements are pointless" still clarifies, the fallback now renders the words as lettering anyway.
