# SDD ledger — plan: docs/superpowers/plans/2026-08-29-design-spec.md

Branch: feat/design-spec, STACKED on feat/edit-as-operation (PR #168, open+green).
After #168 squash-merges: `git rebase --onto origin/main origin/feat/edit-as-operation feat/design-spec` (memory reference_conflicting_pr_no_ci — a conflicting PR runs zero CI).

## Preflight conflict scan
| Pair / task | Producer vs consumer | Finding |
|---|---|---|
| T1→T3 | parseDesignSpec/DesignSpec vs constructDesignBrief imports | Match, clean |
| T1→T4 | renderSpecSummary + DesignSpec vs actions.ts/types.ts imports | Match, clean |
| T2→T4 | generateTransparentV4(V4JsonPrompt, aspect?) + GENERATE_COST_PER_IMAGE vs adapter | Match, clean |
| T3→T4 | DesignBrief union {clarify|generate|edit} vs actions.ts routing branches | Match (all three arms handled), clean |
| T3↔T4 ordering | T3 additive (old constructFluxPrompt untouched); T4 deletes it after call-site switch | Sequencing sound; tree green at each commit |
| T2 internal | v4 test asserts real FormData fields incl. absence of magic_prompt/negative_prompt | No vacuous asserts |
| T4 internal | deletes isClarificationOnly/isSubjectlessPrompt only after sole caller gone; isGenerateIntent explicitly kept; v3 generateTransparent deletion gated on grep | Self-consistent |
| T4 internal | mock update list = the 5 files matched by grep for constructFluxPrompt mocks | Complete per grep run at plan time |
| T5 internal | gates + docs note | Clean |

## Pre-execution rulings (controller, made while planning)
Ruling: "variation" folds into generate — v4 generate-transparent takes no seed, so a variation has no mechanical difference from a generate; the ledger entry in slice 3 can reintroduce it as an operation value if the job table wants it. Cost if wrong: a classifier distinction rebuilt later.
Ruling: negativePrompt retires with v3 — v4 has no negative_prompt channel; the system prompt translates push-away into affirmative style fields. Cost if wrong: style-adherence regression until the slice-4 eval harness can measure it (accepted by the spec's own framing).
Ruling: an edit turn with no resolvable anchor (imageless thread) becomes a clarification, never a generate — generating would need a spec the model didn't produce. Cost if wrong: an extra chat turn for the user.
Ruling: edit with referenceImage null anchors on the latest output image ("make it larger" means the latest). Cost if wrong: an edit lands on the wrong image when the user meant an older one and didn't say — recoverable by saying so.
Ruling: image.prompt stores renderSpecSummary() for generates (human-readable scene description — partially repairs #169's generate half) and the edit instruction for edits; the structured spec is NOT persisted this slice (slice 3's image_generation.design_spec_json is its home). Cost if wrong: a re-parse from summary is lossy; slice 3 fixes properly.
Ruling: no bbox emission this slice (untested layout control, YAGNI). Cost if wrong: none — additive later.
Ruling: v4 request sends rendering_speed TURBO only; output_resolution and enable_copyright_detection unset (defaults). Cost if wrong: config tweak.
Ruling: slice 2 proceeds stacked on unmerged #168 — waiting would block on review with no code reason; the rebase recipe is recorded above. Cost if wrong: one rebase's work after squash-merge.

## Progress
Task 1: complete (commits 9064a96..5f81e05, review clean)
Task 2: complete (commits 5f81e05..5fc6f73, review clean)
Task 3: complete (commits 5fc6f73..0c5fd33, review clean; 2 minors noted as non-gate: no local spec-null regression test — Task 1 owns that safety; whitespace-only vs absent editInstruction — identical guard path)
Task 4: minor (deferred): no e2e pin on stored image.prompt — add expect(row.prompt).toBe("a happy cat") to one integration test later
Task 4: minor (deferred): registry.test.ts cost-ordering invariant duplicative until a second adapter exists
Task 4: minor (deferred): "Prompt used:"/published-naming surface now sees delta instructions for edited images (already tracked as issue #169)
Task 4: complete (commits 0c5fd33..49670a2, review clean; implementer concerns 1-4 all adjudicated by reviewer as non-gate observations)
Task 5: complete (docs-only, review clean; post-#168-merge rebase onto origin/main done first — 6 commits replayed clean, 982/982 green re-verified)
Final review: With fixes (4 Important, 5 Minor). Fix wave scope ruled: fixes 1-4 (readiness edit-turn sentence; seed-anchor fallback + test; style vocabulary table restored; CHAT_SYSTEM_PROMPT de-contradiction) + minors 5 (non-object JSON guard), 7 (stale comments), 8 (doc coherence), 9 (outputs comment).
Ruling: minor 6 (no envelope salvage on the brief path) parked — identical to the deleted constructFluxPrompt's behavior, pre-existing class, #33's salvage helper can be wired in a follow-up; not a regression. Cost if wrong: a rare mixed prose+JSON reply shows a raw blob in chat once.
Ruling: deferred "#169 delta-instructions compound in gallery context" promoted to a MUST for slice 3 (design_spec_json), per reviewer. Cost if wrong: model's picture of its own gallery degrades on long edit threads until slice 3.
Final fix wave: complete (016d936..22facb4; scoped re-review: all 8 ADDRESSED, no new breakage). 984 tests green.
