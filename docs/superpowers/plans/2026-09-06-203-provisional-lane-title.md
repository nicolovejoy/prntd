# Plan: Studio pending lane shows the user's prompt, not "Untitled" (#203)

**Spec authority:** issue #203. Nico's smoke of #196 (2026-09-06): the
pending cell appears instantly but its lane reads "Untitled". Controller
rulings on the issue's open questions (recorded here so the implementer
does not re-decide them): Q1 silent replacement, no cross-fade — once the
server lane replaces the synthetic one its `title` is the first user chat
turn, i.e. the same words, so there is nothing to animate; Q2 an EXISTING
server lane with `title: null` also takes the prompt while an optimistic
entry is attached to it (cheap, same code path), but nothing changes in the
server read model; Q3 clamp to one line at the render site — the `truncate`
class already there does it, do not shorten the string in data.
Migration-free. One PR.

## Global Constraints

- Pure logic lives in `src/lib/studio-view.ts` (`applyOptimistic`); the
  client (`src/app/studio/studio-client.tsx`) only supplies the prompt on
  the entry it already builds in `submit()`. `src/lib/studio.ts` (server
  read model) does not change.
- `StudioLane.title` semantics stay "first user chat turn"; the provisional
  title IS that turn, supplied a poll earlier.
- Render sites keep `lane.title ?? "Untitled"` — "Untitled" remains the
  fallback for a lane with genuinely no words.
- `npm run lint`, `npm run typecheck`, `npm test` green.

## Task 1 — `OptimisticEntry.prompt` feeds the synthetic lane's title

Files: `src/lib/studio-view.ts`, `src/lib/__tests__/studio-view.test.ts`,
`src/app/studio/studio-client.tsx`,
`src/app/studio/__tests__/studio-client.test.tsx`.

1. `OptimisticEntry` gains `prompt: string` (required — every submit has
   one; the trimmed composer text). Docblock: it is the lane's provisional
   title until the server lane carries the first user turn.
2. `applyOptimistic`:
   - synthetic lane (no matching server lane): `title` = the prompt of the
     EARLIEST entry in the group by `startedAt` (the first words typed into
     that conversation, matching the server's "first user chat turn"), or
     `null` if that prompt is empty after trim.
   - existing server lane with `title === null` and an attached group:
     same rule; a lane that already has a title keeps it.
3. `submit()` in `studio-client.tsx` sets `prompt: trimmed` on the entry it
   pushes. Any other place that constructs an `OptimisticEntry` (tests,
   fixtures) gets the field.
4. Tests in `studio-view.test.ts`: synthetic lane title is the earliest
   entry's prompt; two entries into one unseen design → title from the
   earlier `startedAt`, not array order; whitespace-only prompt → `null`;
   existing lane with a title keeps it; existing lane with `null` title
   takes the prompt. In `studio-client.test.tsx`: after typing "big dogs
   don't jiggle" and submitting (with `generateDesign` mocked to resolve
   `{kind:"queued"…}` and never settle), the bench shows that text as a
   lane heading and no "Untitled" heading.

Commit: `Studio: pending lane titled with the prompt until the server turn lands (#203)`.
