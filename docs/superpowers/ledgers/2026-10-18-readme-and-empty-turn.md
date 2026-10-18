# Ledger: README rewrite and the wordless-turn refusal (2026-10-18)

Cloud session, Nico away. Two items from CLAUDE.md's 2026-10-17 known list, built from main `5436b23` on `claude/vibrant-shannon-e635kv`. Process: one Sonnet implementer per item in its own worktree (`.claude/worktrees/readme`, `.claude/worktrees/empty-turn`), the two commits cherry-picked onto the one branch, the controller's gate in the main checkout, one Opus whole-branch review (READY WITH FIXES, nothing Blocking), one fix round by the controller. `/readup` and `/handoff` are not installed in this environment; this ledger and the PR body are the record.

## Item 1: README.md

Rewritten from the code on main and CLAUDE.md's Project, Tech Stack, Commands, Tooling and Architecture sections.

Removed, because none of it is true any more: chatting on `/design` (JSON envelope, readiness flag, quick replies), the Haiku readiness pre-check, Ideogram v3 Turbo through Replicate, BiRefNet background removal, Recraft v3 and the generator adapter paragraph, `/preview` as the buy page, "440 Vitest tests", "18 tables", "Playwright against live preview deploys", "the only API routes are the webhooks", "order classification kept separate from freeform tags" (unverified), the "Known gaps" line.

Rulings (implementer's unless marked):

1. No test, table or garment counts, no prices, no dates, no issue or PR numbers. Counts change; prices belong to the buy panel (CLAUDE.md's no-price-before-size rule).
2. "image detail page (`/d/[imageId]`)" once, then "image detail page".
3. The dropped LLM-envelope paragraph is replaced by a still-true bullet on conditional writes and `db.batch`; the "no negations" idea survives as its own bullet (the brief prompt in `src/lib/ai.ts` still says it).
4. Env var names only, from CLAUDE.md's list; `REPLICATE_API_TOKEN` noted as ops scripts only.
5. Review fixes (controller): "Printful API: product catalog" → "mockups, cost estimates, order submission, status webhooks" (the catalog is `src/lib/blanks.ts`); cart cap is per cart (40 lines), not per IP; the nightly runs several real Stripe test checkouts, not one; local setup says `cp .env.example .env.local` and points at `.env.tpl`'s own three-step header for 1Password users, instead of `op inject` straight onto `.env.local`; `NEXT_PUBLIC_FEEDBACK_PROJECT_ID` added to the list.

Left for later (out of scope): `CONTRIBUTING.md` lines 13 and 23 are stale (get `.env.local` from Nico; flip `.env.local` to prod and `db:push`, which contradicts the migration discipline and the db-preflight guard). CLAUDE.md's Commands block still says `e2e:stripe` runs "one real Stripe test-mode checkout".

## Item 2: a wordless generate turn

Before: `generateDesign(designId, undefined | "" | "  ")` consumed a generation unit, could create the design row for a new id, ran a paid `constructDesignBrief` call, and then either re-rendered the conversation's previous user words (`latestUserText`, also the explicit-anchor fallback) or, with no earlier words, wrote an assistant `clarification` turn, refunded the unit and rendered nothing. The Studio composer trims and never sends an empty turn, and the landing seed is trimmed and non-empty, so this was reachable only by a direct server-action call.

Rulings (controller's, given to the implementer; Nico can reverse any of them):

- R1. Refuse any turn where `!userMessage?.trim()`, whatever the conversation holds, explicit anchor included. The "wordless turn re-renders the previous words" path goes away. If wrong: a direct caller that relied on a re-roll gets a refusal; no UI uses it.
- R2. The refusal sits right after the session check and the job-id format check, before the replay check, the design lookup, `assertConversationOpen`, the quota, the capacity check, any write and any model call. It writes nothing. A wordless request carrying a known job id cannot be a real replay (a replay carries the original's words), so refusing before that read is safe. An empty turn on a closed or foreign conversation now gets `empty` instead of a throw; that tells the caller nothing about the conversation.
- R3. It returns `{ kind: "empty"; message }`, a new `GenerateResult` member, not a throw, so the Studio's existing non-queued branch shows the line as its notice. No client change was needed.
- R4. Copy, Claude's: `EMPTY_GENERATE_TURN = "Type what you'd like on the shirt first."` in a new "Studio composer" section of `src/lib/action-copy.ts`.
- R5 (corrected by the implementer and the review). The clarify branch's `if (!spec)` exit is now unreachable and is a throw (`"Clarify brief reached with no user words"`), which the outer catch refunds exactly once. The anchorless-edit `clarification` exit stays as a defensive guard: `constructDesignBrief` downgrades an edit with an empty instruction to `clarify` (`src/lib/ai.ts`), so production briefs never reach it. Its comment and its test's title now say so.
- R6. Pinned with a real-DB test, `src/app/design/__tests__/empty-turn.integration.test.ts` (9 tests): undefined, `""` and whitespace on a new id; `""` on a conversation with words and an image, with and without an explicit anchor; a user at the daily cap gets `empty`, not `limit`; `""` with a job id that belongs to another conversation gets `empty`, not the replay check's throw; the job-id format check still runs first; a turn with words still queues. Each refusal asserts no new design, chat_message, image_generation or generation_usage rows, no brief call and no `after()` callback. Mutations run by the implementer and the reviewer: guard disabled (6 of 8 fail), guard narrowed to `=== undefined` (5 fail), guard after the quota (6 fail), guard after the replay check (the added replay test fails).
- R7. `generation-races.integration.test.ts`: "falls back to the last user turn when Generate is tapped with an empty composer" deleted (it pinned R1's removed behaviour); the wordless "refuses and refunds a clarify turn" test rewritten to reach the defensive anchorless-edit exit with words, still asserting the refund.

Fix round (controller, from the review):

- `src/lib/design-prompt.ts` (`latestUserText`) and its test deleted: no caller left, and its docblock described the removed behaviour.
- Explicit anchor made deterministic: the instruction is `(brief.operation === "edit" && brief.editInstruction) || userMessage.trim()`, and the old `if (instruction)` fall-through is gone. On main an `edit` brief with an empty instruction fell through and edited the latest image rather than the tapped one; `constructDesignBrief` never returns that shape, so this changes no production turn, but the tapped image is now edited in every case.
- `PreparedGeneration` excludes `{ kind: "empty" }`, which `prepareGeneration` never returns.
- CLAUDE.md's known-item line about this exit is marked fixed on this branch.

Side effect, noted: a whitespace-only turn no longer writes a whitespace user `chat_message` row (main did).

## Gate (controller, main checkout, on the fix-round head)

Lint 0 errors (21 warnings, existing), typecheck clean, 263 files / 4126 tests (was 264 / 4131 before the fix round: `design-prompt.test.ts` removed, one test added), `db:generate` "No schema changes", build exit 0 with CI's dummy env. No migrations, no prod reads, no smokes run from here.
