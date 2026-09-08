# SDD ledger — plan: docs/superpowers/plans/2026-09-08-deferred-cleanups.md
Worktree: .claude/worktrees/cleanups, branch chore/deferred-cleanups, base db7e695 (plan commit on main 28dcf05). No spec doc — plan is the spec. Single batched task.

## Preflight scan
| Item | Produces vs consumes | Finding |
|---|---|---|
| 1a alt fallbacks | 3 sites `??` → `||` | Self-consistent. |
| 1b error copy | 3 constants in action-copy.ts consumed by error.tsx + global-error.tsx; rendered text byte-identical | Self-consistent; existing boundary tests unaffected. |
| 1c title limit | MAX_IMAGE_TITLE_LENGTH=80 in design-publish.ts, TITLE_TOO_LONG in action-copy.ts, consumed by designs/actions.ts + editable-naming.tsx; client already maxLength=80 | Self-consistent. Plan hedges on constant location ("check; if none fits, design-publish.ts") — Ruling: design-publish.ts unless updatePublishedNaming already imports a naming-rules module; implementer decides and reports. Cost if wrong: one import path. |
| 1d confirm copy | "View My Orders" → "View orders" at 2 sites + 2 test queries | Self-consistent. |
| 1b ↔ 1c | both add to action-copy.ts | Same file, different sections; one implementer, no conflict. |

Task 1: minor (deferred): no cross-reference from action-copy.ts to where MAX_IMAGE_TITLE_LENGTH is enforced (discoverability nit)
Task 1: complete (commits db7e695..09aa43a, review clean)
Ruling (final review): single-task plan with a clean Sonnet task review over the entire branch diff; no separate Opus whole-branch pass — nothing money-adjacent, every file the branch touches was in the one reviewed diff. Cost if wrong: a cross-file invariant no task diff shows, which for a one-diff branch is the same diff.
