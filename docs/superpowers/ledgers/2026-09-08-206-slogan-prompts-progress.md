# SDD ledger — plan: docs/superpowers/plans/2026-09-08-206-slogan-prompts.md
Worktree .claude/worktrees/206-slogans, branch fix/206-slogan-prompts, base def0edb. Single batched task.

## Preflight scan
| Item | Finding |
|---|---|
| 1a fallbackSpec vs existing test | The existing "dog doing calisthenics"→obj test CONFLICTS with 1a. Ruling: short prompts reaching the fallback become lettering; test updated. Cost if wrong: a 3-word concrete prompt that the brief somehow clarifies on renders as words instead of a drawing (the brief prompt now says never clarify on those, so the path is rare). |
| 1a vs 1b | disjoint files (design-spec.ts vs ai.ts); consistent intent. |
| 1b test | prompt-content toContain; harmless. |

Ruling: scope extended to src/app/design/__tests__/generation-races.integration.test.ts — three assertions pinned the old obj fallback shape; they follow the 1a ruling. Cost if wrong: none beyond the test edit. Also: implementer added a wasTruncated guard (an essay cut at 400 chars must not become lettering) — left for the reviewer to judge.
Task 1: complete (commits def0edb..0bdae8d, review clean; wasTruncated guard judged necessary and tested)
Ruling (final review): single-task plan, clean Sonnet review over the whole branch diff, no separate Opus pass — not money-adjacent; the only cross-file consequence (race-test assertions) was found by the suite and folded in. Cost if wrong: a stale comment elsewhere describing the old obj fallback.
