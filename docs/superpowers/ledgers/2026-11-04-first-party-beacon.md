# SDD ledger — plan: docs/superpowers/plans/2026-11-04-first-party-beacon.md
Spec: CLAUDE.md Current state "Next (Nico agreed 2026-11-03)" entry.
Preflight scan: one task; files (component, its test, layout, layout test) are each created/touched once; tests 1-10 match the given code. Clean.
Ruling: wd also honours ?pl_agent=1 and localStorage pl_agent, not only navigator.webdriver — live beacon.js (read 2026-11-04) has that kill switch and the spec says "the same contract as the live beacon.js" — cost if wrong: two extra try/catch probes, harmless.
Ruling: after a client-side navigation ref = location.origin + previous pathname, not document.referrer — document.referrer does not change on client navigation, so repeating it would credit every page view to the landing referrer — cost if wrong: prompt-lab's referrer stats show prntd.org as an internal referrer (beacon.js already did so for hard navigations).
Ruling: fetch fallback kept (no-cors, keepalive) — beacon.js has it — cost if wrong: none.
Ruling: no admin skip — spec says optional, counts only — cost if wrong: Nico's own admin page views counted.
Ruling: prompt-lab told of the plan before the build (handoff c836b0a), per Nico 2026-11-04.
BASE task 1: 2e000df
Task 1: implementer DONE d8e150d (lint 0 errors, typecheck clean, 273 files / 4269 tests; controller re-ran focused 12/12 and typecheck)
Ruling: one Opus whole-branch review stands in for both the task review and the final review — a one-task, four-file plan; two reviews would read the same diff — cost if wrong: one review lens less (the Opus review is the stronger one).
Task 1: build exit 0 at d8e150d (main checkout, CI dummy vars)
Final review (Opus): READY WITH FIXES, 0 Critical/Important. Minor 1 (fetch catch unpinned) and Minor 2 (?pl_agent=1 untested) sent as fix round 1.
Ruling: Minor 3 (bfcache restore sends nothing) parked — parity with beacon.js — cost if wrong: Back-from-Stripe restores not counted.
Ruling: Minor 4 (ids in paths: /d/{imageId}, /admin/*; foreign ref keeps its path) parked and put to Nico as a question — unchanged from #363's script, and the spec says origin+path — cost if wrong: unpublished image ids sit in prompt-lab's DB while R2 objects are public.
Minor 5 (CLAUDE.md stale after merge): docs commit to main after the merge.
Task 1: fix round 1/5 (2 addressed, 0 open; commits d8e150d..f733214). Ruling: controller's own mutation run (query check → false: the new test fails 1/11; restored 11/11) stands in for the scoped re-review — test-only diff of two cases — cost if wrong: an unreviewed test file line.
Task 1: complete (commits 2e000df..f733214, review clean, 2 parked)
Task 2 (Nico chose option 2 on #365 ids question). BASE task 2: 6749208
Task 2: implementer DONE f2ca9f6 (lint 0 errors, typecheck clean, 273/4277; 7 mutations each failed their test; controller re-ran 18/18)
Task 2 review (Sonnet): spec ✅, Approved, 0 Critical/Important.
Task 2: minor (deferred): isAdminPath duplicates beaconPath's admin condition.
Ruling: a referrer from another prntd host (www., a Vercel preview) is treated as cross-origin, so its /d/<id> path is not scrubbed — the brief keeps cross-origin as origin+path, and prntd.org has no second host that serves /d pages to the same visitor — cost if wrong: an id in prompt-lab from a preview→prod hop.
Ruling: the case-sensitive /d/ regex stands — Next routes are case-sensitive, and usePathname returns the route path — cost if wrong: none found.
Task 2: complete (commits 6749208..f2ca9f6, review clean)
