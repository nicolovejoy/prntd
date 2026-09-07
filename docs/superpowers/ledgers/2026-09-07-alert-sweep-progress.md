# SDD ledger — plan: docs/superpowers/plans/2026-09-07-alert-sweep.md

Spec: reproduced in the plan's "Spec" section (controller dispatch brief). No separate spec file.
Branch: feat/alert-sweep. Worktree: /Users/nico/src/prntd/.claude/worktrees/alert-sweep
Baseline before any change: 146 test files, 1594 tests passing.

## Preflight scan

Cross-task rows (every pair sharing a file or an interface):

| Pair | Produces → consumes | Finding |
| --- | --- | --- |
| T1 → T2 | `InlineNotice`; `OPEN_CONVERSATION_FAILED`, `DELETE_CONVERSATION_FAILED`, `START_FROM_IMAGE_FAILED`, `SET_PRIMARY_IMAGE_FAILED` | Names match T1 Step 5 exactly. Clean. |
| T1 → T3 | `useNotice`; `DELETE_IMAGE_ERROR`, `START_FROM_IMAGE_ERROR` (design-client), `CLOSE_/REOPEN_CONVERSATION_ERROR` (design-view) | Clean. The `as const` objects are structurally `NoticeOptions` minus optional `closeLabel`; assignable. |
| T1 → T4 | `InlineNotice`, `InlineNoticeTone`; 6 `ADMIN_*` constants + 3 builders | Clean. `InlineNoticeTone` is exported as a type in T1 Step 6, imported as a type in T4. |
| T1 → T5 | T1's new files are scanned by the guard | `inline-notice.tsx` contains the string `"alert"` in `role={tone === "negative" ? "alert" : "status"}`. The guard regex requires `alert\s*\(`; no paren follows, so no false positive. Clean. |
| T2 ↔ T3 | Both touch a `START_FROM_IMAGE_*` name | Two distinct exports: `START_FROM_IMAGE_FAILED` (string, inline) and `START_FROM_IMAGE_ERROR` (object, sheet). An implementer importing the wrong one fails typecheck (string vs `{title, body}`), so the collision is caught mechanically. Named here so neither implementer "fixes" the other's name. |
| T2 → T3 | `conversation-actions.tsx` imports `DELETE_CONVERSATION_TITLE` from `@/lib/design-view`; T3 adds an export to that file | Additive, T3 runs after T2. Clean. |
| T3 → T1 | `design-view.ts` (node env) imports `action-copy.ts` | `action-copy.ts` imports nothing — no cycle, no client-only code pulled into a node test. Clean. |
| T3 → T5, T4 → T5 | Guard scans the files T3/T4 edited | Guard runs after both. Clean. |
| T2/T3/T4 → T6 | Full gate | Clean. |

Per-task self-consistency rows:

| Task | Finding |
| --- | --- |
| T1 | Tests reference `notice-sheet` / `notice-sheet-close` / `inline-notice` test ids that the specified implementation provides. `useNotice` Harness increments its counter after `notice()`, so first click renders "Failure 0" and second "Failure 1" — matches the replace test. Modal's Escape listener is on `window` with capture, so `fireEvent.keyDown(window, …)` reaches it. Clean. |
| T2 | Every specified test drives a failure path, so none reaches `window.location.assign` (unimplemented in jsdom). The one success-adjacent case (retry clears the line) uses a never-settling promise for exactly that reason, and the plan says so. Clean. |
| T3 | `conversationToggleError`'s test compares against the same constants the function returns — it pins the branch *direction* (closed → reopen message), which is the only decision in the helper, not the copy text. Accepted as written. |
| T4 | Step 2 expects the test to pass on first run rather than red-first, because T1 already wrote the constants. Called out in the plan text. These are regression pins on copy a future sweep could silently change; they assert real string shape, not `expect(true)`. Accepted as written. |
| T5 | Threshold `> 100` source files verified against the current tree: 182 non-test `.ts`/`.tsx` files under `src/`. The guard file itself lives in `__tests__` and matches `.test.ts`, so it is excluded twice over and cannot flag its own regex literal. Clean. |
| T6 | Changes nothing unless red. Clean. |

No conflicts requiring a ruling. Proceeding to Task 1.

## Progress

Task 1: implemented (commit e4dbbbf) — NoticeSheet/useNotice, InlineNotice, action-copy.ts, ui/index exports, 14 tests (9 sheet + 5 inline). Lint 0 errors, typecheck clean. Plan text said "11 tests" against its own verbatim test bodies, which contain 14 — a controller miscount in prose, not a code discrepancy. Task reviewer dispatched.
Task 1: minor (deferred, ruled): `inline-notice.tsx` pairs `role="alert"` with an explicit `aria-live="polite"`, which downgrades the role's implicit `assertive`. Ruling: KEEP the polite downgrade — every (b) site renders this line immediately beside a control the user just activated and is already looking at, so interrupting a screen reader mid-utterance buys nothing; `role="alert"` stays for the semantic category. Cost if wrong: a blind user on a slow connection could tab away before the line is announced. Reviewer raised it as a conscious-call item, not a defect.
Task 1: complete (commits edffb07..e4dbbbf, review clean — spec PASS, quality PASS, 0 Critical/Important).
Task 2: implemented (commit 3f54b5c) — five image-detail call sites converted to InlineNotice; 7 test files / 53 tests pass in src/app/d/[imageId]/__tests__; lint 0 errors; typecheck clean; grep under src/app/d returns nothing. Task reviewer dispatched.
Task 2: review 1 — spec PASS; quality: 1 Important + 2 Minor.
Task 2: minor (deferred): no test covers conversation-actions' error-clears-on-retry path (start-from-image has one; the logic is symmetric setError(null) at the top of both handlers).
Task 2: minor (deferred): a stale error from a failed open() stays visible beneath the confirm sheet until the user confirms a delete (clearing happens at action start, not at prompt time). Matches the specified pattern; harmless.
Task 2: fix round 1/5 (1 addressed pending re-review, 0 open — stale useError across lightbox navigation; fix shape chosen: clear-on-navigate via a showInLightbox(index) helper wired into both the strip thumbnail onClick and ImageLightbox onNavigate; commits 3f54b5c..6677691; 54 tests).
Task 2: re-review — finding ADDRESSED (showInLightbox covers both entry points; the new test genuinely fails without the fix). No new breakage.
Task 2: complete (commits e4dbbbf..6677691, review clean, 2 minors deferred).
Task 3: implemented (commit ea1fdc5) — three /design sites on useNotice, conversationToggleError added to design-view.ts + tested; 15 files / 183 tests; lint 0; typecheck clean; grep on design-client.tsx empty. Step 7 (bounded container-test attempt): STOPPED AT BUDGET as instructed — mounting DesignPageClient needs a 4th mock beyond the three allowed, because the unconditional ensureGuestSession() mount effect pulls better-auth/react → @opentelemetry/api (not installed) and fails at module resolution. Attempt deleted. Consequence stands as planned: the {noticeSheet} wiring is covered by the prod smoke and the Task 5 guard test, not by CI.
Task 3: review — spec PASS, quality PASS, 0 Critical/Important. Reviewer independently confirmed ensureGuestSession runs unconditionally on mount (design-client.tsx:376), so the Step 7 stop was justified, and read the real JSX to confirm {noticeSheet} is an unconditional sibling of <PublishModal>.
Task 3: minor (deferred): conversationToggleError's return type is a hand-written { title; body? } literal rather than importing NoticeOptions — structurally compatible today, would silently diverge if NoticeOptions gained a required field. Specified that way by the plan.
Task 3: complete (commits 6677691..ea1fdc5, review clean).
Task 4: implemented (commit 6353b32) — 11 admin sites converted to InlineNotice; 3 files / 14 tests; lint 0; typecheck clean; grep under src/app/admin empty. Task reviewer dispatched.
Task 4: review — spec PASS, quality PASS, 0 Critical/Important. Reviewer specifically verified the heaviest risk (per-row result leakage on the list page): setActionResult(null) fires before the async work and the render is gated on exact orderId equality, so no line can attach to the wrong row across a refetch/reorder.
Task 4: minor (deferred): src/app/admin/page.tsx:483 — the wrapping <td className="... space-x-2"> gives the InlineNotice an unintended small margin-left as a non-first child. Cosmetic; flagged and consciously left by the implementer.
Task 4: complete (commits ea1fdc5..6353b32, review clean).
Task 5: implemented (commit 65ff48f) — guard test added, observed RED (naming app/cart/page.tsx) then GREEN. The guard also matched a prose comment "owner alert (" in src/app/api/webhooks/stripe/route.ts, which the implementer reworded.
Task 5: Ruling — rewording the prose beats teaching the guard to skip comments. A comment-aware regex is more code that can itself be wrong, and it still would not catch `alert(` inside a string literal or JSX text; the guard is deliberately blunt. Cost if wrong: future comments in src/ must avoid the phrase "alert(" — a small, visible tax that fails loudly rather than silently.
Task 5: review — spec PASS, quality PASS except one Important: the rewording itself was malformed ("notificationfire-and-forget" fused, orphaned close paren) in a money-path file, and the report never mentioned that file. Fix round 1 dispatched.
Task 5: fix round 1/5 (1 addressed, 0 open — comment restored to "// Send confirmation + owner notification (fire-and-forget; helper swallows errors)"; commits 65ff48f..ed9eb75). Re-review ADDRESSED; controller independently confirmed the fix commit touches exactly one line in one file and changes no executable code.
Task 5: complete (commits 6353b32..ed9eb75, review clean).
Task 6: full gate — lint 0 errors (21 pre-existing warnings), typecheck clean, 152 files / 1623 tests passing (baseline was 146/1594), build green. NOTE: a bare `npm run build` in this worktree fails at "Neither apiKey nor config.authenticator provided" because worktrees have no .env.local; it builds clean under CI's dummy env block from .github/workflows/ci.yml. Not a code defect.
Task 6: complete (no changes needed).

## Final whole-branch review (Opus)

0 Critical, 3 Important, 6 Minor. The three Importants are exactly the class per-task reviews cannot see:
1. conversation-images.tsx:161 — the fix round taught showInLightbox to clear useError on NAVIGATE but not onClose, so closing the lightbox after a failed save left the line rendering in the strip beside a different image. Same bug, one code path over.
2. admin (both pages) — archive/unarchive/classification/tag handlers never clear actionResult, so a failed Refund's money-language line and raw error hint stay pinned through unrelated actions with no dismiss. window.alert was transient; this is behaviour the translation ADDED.
3. action-copy.ts DELETE_IMAGE_ERROR told the user to "Refresh the page and try again" for a refusal that is unconditional — an order-referenced image never deletes. Persona C's "what to do" was actively wrong.
ONE fix dispatch covering all three.

Ruling: do NOT broaden the guard regex to window.confirm/window.prompt this branch, though a real window.prompt survives at src/app/dashboard/page.tsx:183 (clipboard-failure path). Broadening would fail CI on a mothballed route (#191, already 404 on prod) that PR #201 deletes outright, dragging an unrelated file into this slice. Cost if wrong: that one native dialog stays reachable until #201 lands. Noted in the PR body.
Ruling: do NOT edit CLAUDE.md's stale "window.alert sweep (10 sites)" line (the real count was 19) from inside this slice — roadmap bookkeeping belongs to the handoff. Cost if wrong: the roadmap reads stale until then. Noted in the PR body.
Ruling: fix finding 3 (the copy) inside this branch rather than deferring it to Nico. The plan's own persona-C constraint is binding and the instruction is factually wrong, so leaving it would ship copy the plan forbids. Cost if wrong: Nico prefers different wording and changes one constant.
Correctly deferred per the reviewer's own triage: the aria-live downgrade, the missing clear-on-retry test for conversation-actions, the stale error beneath the confirm sheet, conversationToggleError's hand-written return type, the <td space-x-2> margin, NoticeSheet's lack of a focus trap (parity with ConfirmSheet, not a regression), and the pre-existing hand-rolled error line in feedback-widget.tsx.
Escape-key note (Minor, accepted): Modal and ImageLightbox both listen capture-phase on window, so Escape closes the notice and the lightbox together; and {noticeSheet} paints above the lightbox only because it is later in source (both z-50). Left as is — this branch introduces the first Modal-over-lightbox stack on /design and the behaviour is not wrong, only undocumented.
Final fix wave: commit f36f3f5 — all three findings ADDRESSED per the scoped re-review, no new breakage. Suite 152 files / 1624 tests (one new test for the lightbox-close clearing).
Residual, parked with ruling: `handleAddTag` on both admin pages still does not clear `actionResult`, so a stale Retry/Recover/Refund error line survives an Add-Tag click. Real but small, and it is fire-and-forget with no try/catch, so it never writes a line of its own. Ruling: park it — there is no second fix wave, the four handlers that actually gate the operator's attention are covered, and widening now would re-open a file the wave already closed. Cost if wrong: one stale line persists through one more interaction than intended.
Branch complete. Full gate green: lint 0 errors, typecheck clean, 1624 tests, build green under CI env.
