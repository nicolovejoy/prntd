# Paper slice 5 — image detail page (#188) — SDD progress ledger

Branch `feat/188-paper-image-detail`. Plan: `docs/superpowers/plans/2026-09-07-paper-image-detail.md`.
Controller: Opus. Implementers + task reviewers: Sonnet. Whole-branch final review: Opus.


## Pre-flight conflict scan

| Pair / task | Shared surface | Produced vs consumed | Finding |
| --- | --- | --- | --- |
| T1 → T2 | `page.tsx`, `published-image-view.tsx` | T1 produces `MONO_LABEL`, `IdentityBlock`; T2 consumes `MONO_LABEL` and replaces the owner JSX | **CONFLICT P1** — T1 step 6 replaces `metaBlock`, which drops the only uses of `PublishCta`, `ConversationActions` and `EditableNaming` in `page.tsx`, yet the step says "leave those two imports in place". T1 step 9 runs `npm run lint`, which errors on unused imports. It also silently deletes the owner's Publish / Open / Delete affordances for the length of one commit. |
| T1 → T3 | `MONO_LABEL` | produced T1, consumed T3 | clean |
| T1 → T4 | `MONO_LABEL` | produced T1, consumed T4 | clean |
| T2 ↔ T3, T2 ↔ T4, T3 ↔ T4 | none | — | disjoint files, clean |
| T1 self | tests vs code | mocks `../editable-naming`, imports it in `identity-block.tsx`; `forkChain` field names match `page.tsx` | clean |
| T2 self | tests vs code | `unpublish-action.test` clicks `getAllByRole("button", {name:"Un-publish"})[1]` | **CONFLICT P2** — the ConfirmSheet's confirm button carries `data-testid="confirm-sheet-confirm"`; an index into a role query is positional and breaks if the trigger's label ever changes. |
| T3 self | tests vs code | `getBlankOrThrow`/`expand()` already imported in the file; `ACTIVE_BLANKS.length > 1` holds (3 blanks) so the Product label renders | clean |
| T4 self | tests vs code | fixture is `{imageId, imageUrl}` | **CONFLICT P3** — `SiblingImage` (`src/app/d/actions.ts:248`) also requires `isPrimary: boolean`; the fixture will not typecheck. |

Ruling: **P1** — T1 keeps the owner links rendering, unchanged, as a temporary
`ownerLinks` fragment below the identity block; T2 deletes that fragment and
renders `OwnerActions` in its place. Every import stays used at every commit,
lint stays green, and no commit on the branch ships a page with the owner's
actions missing. Costs, if wrong: one throwaway fragment that lives for one
commit and shows up in T2's diff as a deletion.

Ruling: **P2** — the confirm click targets `getByTestId("confirm-sheet-confirm")`.
Costs, if wrong: nothing; it is strictly the more stable selector.

Ruling: **P3** — T4's fixture carries `isPrimary`, matching `SiblingImage`, and
the implementer is told to read the existing fixtures in the file first.
Costs, if wrong: a typecheck failure caught in the task's own verify step.
Task 1: dispatched (implementer sonnet), BASE 950185b
Task 1: complete (commits 950185b..71a1e6b, review clean — spec ✅, quality Approved)
Task 1: ⚠️ resolved by controller — "does text-text-faint sit on a coloured backdrop?" No. `publishedBackdrop` is applied only to the hero card's wrapper inside `published-image-view.tsx`; `ownerLinks` renders in the page body on `--background`. Not a gap.
Task 1: minor → Ruling: `EditableNaming` must always render the h1. Its `(title || canEdit)` guard means an owner viewing their own UNPUBLISHED, untitled image (canEdit is `isOwner && isPublished` = false) gets no h1 at all — which was merely a missing heading before, but is now an empty labelled TITLE row in the identity block. Fixed as an extra step in Task 2. Costs if wrong: that page shows the h1 "Untitled" where it previously showed nothing, which is what the Title row already implies.
Task 2: dispatched (implementer sonnet), BASE 71a1e6b
Task 2: complete (commits 71a1e6b..6ce1f43, review clean — spec ✅, quality Approved)
Task 2: minor (deferred to Task 3 dispatch): `unpublish-action.tsx` docblock ships a literal `#?` issue-number placeholder — my plan's own text, copied verbatim as instructed. Ruling: drop the placeholder rather than guess an issue number (reversible un-publish predates the numbered-issue era in this repo's notes). Comment-only, no behaviour. Costs if wrong: a docblock without a cross-reference.
Task 3: dispatched (implementer sonnet), BASE 6ce1f43
Task 3: implementer reported DONE_WITH_CONCERNS (505a6ec). Concern 2 is a real screen-level collision, not just a test one: the new mono section label "Back" in the buy panel duplicates buy-hero's existing Front/Back side-label pill, so two different things read "Back" at once whenever a back design is picked.
Task 3: Ruling: rename the panel's section label from "Back" to "Back design". It matches the section's own existing strings ("Add a back design", "Back design"), is more literal (persona C), and removes the duplicate label rather than papering over it with a `within()`-scoped test assertion. Landing as an extra step in Task 4. Costs if wrong: a two-word mono label instead of one.
Task 3: complete (commits 6ce1f43..505a6ec, review clean — spec ✅, quality Approved; reviewer independently diffed pre/post buy-panel.tsx and confirmed every money-path boundary byte-identical)
Task 4: dispatched (implementer sonnet), BASE 505a6ec
Task 4: complete (commits 505a6ec..736da13, review clean — spec ✅, quality Approved)
Task 4: ⚠️ resolved by controller — `.bg-checkerboard`'s border was stripped by PR #213 (Paper slice 1) on main, not by this branch; `git diff origin/main...HEAD --stat` shows globals.css untouched here. Not a gap.
Task 4: minor (for the final review's fix wave): `buy-hero.test.tsx`'s comment justifying the `within(...)` scoping still says the buy panel has a "Back" heading — it says "Back design" now (Extra A).
Final whole-branch review: dispatched (opus)

## Final whole-branch review (opus) — 5 Important, 5 Minor. Verdict: mergeable after named fixes.

Ruling: fix findings 1-8 in ONE fix wave. 9 and 10 are parked.
- F1 stale comment in `buy-hero.test.tsx` — KEEP the `within(...)` scoping (the task-3 reviewer showed it asserts what the original queries intended, per-SideMockup-subtree) but rewrite the comment, which now states a false reason. Costs if wrong: a slightly over-defensive test scope with an honest comment.
- F2 "Back design" renders twice ~8px apart once a back is picked — my own Task 4 ruling created this. Delete the redundant sub-caption; the mono section label above already names it. Costs if wrong: the picked-back row loses a caption it did not need.
- F3 an EMPTY-STRING title yields an empty `<h1>` and a blank labelled TITLE row for every viewer (`updatePublishedNaming` persists `title.trim()` with no non-empty check, and the inline editor has no validation). `title ?? "Untitled"` does not catch `""`. This is the missing half of Task 1's minor. Fix in the component (`title?.trim() || "Untitled"`), NOT in `designs/actions.ts` — that file is outside this slice's boundary.
- F4 the title EDIT input dropped to 14px; iOS Safari auto-zooms any focused input under 16px and does not zoom back. The displayed h1 stays 14px/500 as specified — only the input gets `text-base`. Phone-first is the repo's first design principle. Costs if wrong: the edit field is 16px instead of 14px.
- F5 `MONO_LABEL` living in `identity-block.tsx` makes two client components import a server component to get a string, which is why three tests carry a TOTAL `vi.mock("../identity-block")`. Move the constant to its own module and delete the mocks. Costs if wrong: one extra 3-line file.
- F6 the strip thumb's radius changed `rounded-lg` -> `rounded-md`, contradicting recorded ruling R6. Revert the class; R6 stands.
- F7 the error slot's `basis-full` div renders unconditionally and always eats a flex row in the OWNER row. Make it conditional.
- F8 `<dd>` lacks `sm:flex-1 sm:min-w-0`, so the owner's edit input will not span the row at `sm:`. Cosmetic.
Parked: F9 (R7's visible cost — sans Size/Color labels between mono ones; the frozen-file reasoning holds, it goes loud in the PR body and to whichever slice owns `product-options.tsx`). F10 (nothing tests `page.tsx`'s composition — it is a server component with a session read and a DB read; a container test would need the whole page's deps mocked, which tests the mocks. Ruling: park, and note it in the PR body. Costs if wrong: an assembly regression would be caught by the prod smoke rather than CI.)
Fix wave: dispatched (sonnet), BASE 736da13
Fix wave: complete (commits 736da13..66e43a5). Scoped re-review: all eight ADDRESSED, no new breakage, no weakened assertions, no stale comments introduced.
Branch verification at 66e43a5: lint 0 errors (21 pre-existing warnings elsewhere), typecheck clean, 159 test files / 1667 tests passing, build succeeds.
