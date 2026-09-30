# #263 generation IP cap for signed-in users — controller ledger

Branch claude/263-gen-ip-cap, base origin/main ca8c294. Worktree /Users/nico/src/prntd/.claude/worktrees/263-gen-ip-cap.

## Spec (Nico, 2026-09-29)
USER_IP_GEN_DAILY_CAP default 100; guests keep IP_GEN_DAILY_CAP 20; identity refusal does not bump ip:; GUEST_FUNNEL_ENABLED no-op removed from the quota path; signed-in IP refusal copy without "Sign in"; refunds match bumps; atomic increments kept.

## Controller rulings (before implementation)
1. One implementer task (quota module + action copy + refund pairing + tests + docs). Too coupled to split.
2. Refund pairing hole found while reading: the replay branch in generateDesign (quota refused, but the same client jobId is already queued) calls refundGenerationQuota({userId, ip}), which unbumps BOTH buckets. After this change an identity refusal no longer bumps ip:, so that refund must skip the IP bucket when quota.reason === "identity". Otherwise it decrements another caller's ip: count. Ruling: fix it there and test it.
3. Signed-in identity refusal copy also says "Sign in" today ("You've reached today's free design limit. Sign in to keep designing."). Spec names only the IP case; ruling: generationLimitMessage takes isAnonymous too, and signed-in users get no "Sign in" copy for either reason. Guests keep both of today's strings verbatim. Signed-in copy: identity "You've reached today's design limit. Try again tomorrow."; ip "This network has hit today's design limit. Try again tomorrow."
4. Mirror consumeChatQuota's shape (identity bump, early return on identity refusal, skip IP when null, then IP bump against a caller-dependent cap). A shared private helper used by both families is allowed. quotaDecision becomes dead if unused: delete it and its unit tests rather than keep dead code (record which tests were removed).
5. refundGenerationQuota also drops its GUEST_FUNNEL_ENABLED no-op, so consume and refund stay paired whatever the flag.
6. The env template lists the gen caps as commented defaults, so USER_IP_GEN_DAILY_CAP goes there too (controller edits it by hand: a secrets hook blocks shell reads of .env* paths). CLAUDE.md in this worktree predates the batch-3-docs branch's chat-cap line; add the new var to the existing generation line only.

## Task 1 (Sonnet implementer, TDD) — done
- generation-quota.ts: USER_IP_GEN_DAILY_CAP (default 100); private consumeBuckets helper now serves both generation and chat (identity bump → refuse without IP bump → IP bump against caller-dependent cap); guestFunnelEnabled no-op removed from consume and refund; quotaDecision deleted.
- actions.ts: generationLimitMessage(reason, isAnonymous); replay refund after a refusal passes ip: null when reason is identity; generateDesign passes db to consumeGenerationQuota (mirrors sendChatMessage).
- Implementer finding: generation-races "hands two concurrent generates distinct keys" failed once the quota stopped short-circuiting with the flag off — URL_INVALID from the fallback `import("./db")` racing under vitest (known vite-node issue with concurrent dynamic import of a mocked module, documented in refused-submit-no-row). Passing db fixes it without test edits. Ruling: accept; it is also the pattern chat uses.
- Tests added: src/lib/__tests__/generation-quota.integration.test.ts (signed-in past guest IP cap allowed; refused past USER_IP ceiling; guest refused at IP cap + 1; identity refusal leaves ip: unchanged; concurrent at ceiling-1 admits one; refund restores both; enforced + refund with flag unset); src/lib/__tests__/chat-quota.integration.test.ts (defaults 8/50/20/100, garbage fallback for new cap); new src/app/design/__tests__/generation-quota.integration.test.ts (exact copy: signed-in ip, signed-in identity, guest ip, guest identity; signed-in not blocked by guest IP cap; identity-refused replay leaves ip: unchanged; ip-refused replay refunds both).
- Existing tests changed: "no-ops when the funnel flag is off" → "is enforced with the funnel flag unset"; refund flag-off no-op test → "refunds with the funnel flag unset"; quotaDecision unit tests removed with the function (dayKeyUTC tests kept); chat-quota GEN garbage test now covers USER_IP_GEN_DAILY_CAP.

## Review round 1 (Sonnet) — APPROVE, 5 minor
All 9 attack vectors held (no IP bump on identity refusal; every refund call site pairs; isAnonymous computed once and used for cap + copy; bumps atomic, concurrency test real; flag removed only from quota path; chat unchanged).
Minors fixed by controller: flags.ts docblock (caps apply regardless of flag); refused-submit-no-row comments blaming GUEST_FUNNEL_ENABLED (real cause was the fallback import; note added, simulation kept); actions.ts "nudge to sign in" comment and a long line; added guest-identity exact-copy test (also asserts no ip: row). Not fixed: a `.catch((e) =>` line-break style in the replay refund (cosmetic; no formatter in the gate).
Not fixed, noted: the now-redundant GUEST_FUNNEL_ENABLED assignments in generation-races / refused-submit-no-row tests (harmless; some tests still need the flag for guest access elsewhere).
Haiku scoped re-review: all four resolved.

## Gate (controller, in worktree)
npm ci ok; lint 0 errors (33 pre-existing warnings, none in touched files); typecheck clean; npm test 208 files / 2508 tests pass; db:generate "No schema changes"; build with CI dummy env ok.
