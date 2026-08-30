# SDD ledger — plan: docs/superpowers/plans/2026-08-29-edit-as-operation.md

## Preflight conflict scan
| Pair / task | Producer vs consumer | Finding |
|---|---|---|
| T1→T2 | editTransparent(prompt, anchorUrl, aspect?) + EDIT_COST_PER_IMAGE vs T2 adapter imports | Match, clean |
| T1→T3 | same exports vs preview/actions.ts consumption + test mock (EDIT_COST_PER_IMAGE: 0.2) | Match, clean |
| T2↔T3 | T2 rewrites adapter/types; T3 bypasses adapter (direct editTransparent) | No shared surface, clean |
| T2↔T4 | T4 touches ai.ts prompt text only; envelope shape unchanged | Clean |
| T3 internal | deletes generateAnchoredTransparent/generateImage but keeps removeBackground (scripts import it) | Self-consistent with Global Constraints |
| T4 internal | Refinements rewrite conflicts with existing POSITIVE-ONLY section → task explicitly scopes that section to fresh generations | Self-consistent |
| T1 internal | tests assert real multipart fields/errors; no vacuous asserts | Clean |
| T5 internal | gates + docs note only | Clean |

## Pre-execution rulings (made while planning, controller)
Ruling: generate branch stays on v3 generate-transparent; v4 swap moves to slice 2 — v4 text_prompt force-enables magic prompt + has no negative_prompt; json_prompt is DesignSpec's target. Cost if wrong: slice 2 does the v4 swap slightly later than it could have.
Ruling: /v1/edit at $0.20/image accepted (secondhand pricing), tracked per-operation, verify against first real bill. Cost if wrong: mis-stated internal accounting until corrected; no customer-facing price depends on it.
Ruling: generate/edit split keyed off existing referenceImage signal; "variation" classification deferred to slice 2. Cost if wrong: none — slice 2 builds the classifier anyway.
Ruling: anchor sent as multipart images bytes (image_urls accepts Ideogram-hosted URLs only per openapi). Cost if wrong: an extra R2 download per edit (~free).
Ruling: Task 4 (system-prompt rewrite) ships without prompt-text unit tests — prompt-string asserts are brittle; efficacy is slice 4's eval harness. Cost if wrong: a prompt regression rides until slice 4.
Ruling: placement re-renders priced as edits ($0.20 via EDIT_COST_PER_IMAGE) since they now call /v1/edit. Cost if wrong: internal accounting only.

## Progress
Task 1: minor (deferred): anchor-image fetch not wrapped in withTimeout (plan-mandated shape; ideogram.ts:164)
Task 1: minor (deferred): anchor Blob MIME hardcoded image/png (safe: R2 images are always PNG)
Task 1: complete (commits 6922525..7190e6b, review clean)
Task 2: complete (commits 7190e6b..c70e523, review clean; accepted deviation: vi.hoisted mock wrapper in adapter test)
Task 3: minor (deferred): no test exercises the cache-MISS branch — editTransparent call args + EDIT_COST_PER_IMAGE landing in insert + atomic increment (pre-existing test-scope boundary; reviewer sketched the missing case: seed no render, mock editTransparent, assert args + 0.2 cost)
Task 3: complete (commits c70e523..4364511, review clean)
Task 4: complete (commits 4364511..0bd56de, review clean; noted overshoot: negations scoping used header+sentence instead of literal "one clause" — accepted, brief allowed equivalent minimal scoping)
Final review: With fixes (2 Important, 5 Minor). Fix wave scope ruled below.
Ruling: final Minor #4 resolved by controller from the fetched openapi — '1x2' IS in /v1/edit's aspect_ratio enum; no gap, no action. Cost if wrong: a latent 422 on a discontinued product's placement.
Ruling: final Important #2 (daily worst-case spend ~6.7x under $0.20 edits: ~$1.60 guest / $4 IP / $10 user) — accepted explicitly, noted in the spec doc; cap trims are env config Nico can adjust without code. Cost if wrong: bounded overspend at those ceilings.
Ruling: final Important #1 fixed IN-WAVE for the print-affecting consumer only (placement re-render gets a fixed reframe instruction instead of primary.prompt, per the reviewer's own fix direction; also closes deferred T3 with the cache-miss test). The two ai.ts prompt-as-scene-description consumers (generatePublishedNaming, "Prompt used:" history) are a follow-up issue — slice 2 (DesignSpec) restructures prompt storage anyway. Cost if wrong: mildly off auto-proposed titles until the follow-up.
Ruling: fix wave also takes final Minor #3 (anchor fetch timeout) and Minor #6 (CLAUDE.md tech-stack line). Minors #5/#7 ride.
Final fix wave: complete (commit 859fbae..fa2c9be; scoped re-review: all 4 findings ADDRESSED, no new breakage). Note: placement_render schema has no prompt column, so finding 1's "record the instruction on the row" sub-clause is moot — disclosed in test + report.
