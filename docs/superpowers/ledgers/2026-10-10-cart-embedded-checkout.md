# Ledger — cart on embedded checkout (#278 slice 6b, #135 slice 4), 2026-10-10

Pull request: https://github.com/nicolovejoy/prntd/pull/314 (draft, titled HOLD until its three gates pass).
Spec: `docs/superpowers/specs/2026-10-10-cart-embedded-checkout.md`. Plan: `docs/superpowers/plans/2026-10-10-cart-embedded-checkout.md`. Plan review: `docs/superpowers/ledgers/2026-10-10-cart-embedded-checkout-plan-review.md`.

Built subagent-driven in one session (1009): one Sonnet implementer and one Sonnet reviewer per task, an Opus whole-branch review and an Opus adversarial money-path review, one fix wave with a scoped re-review. The two Opus reviews and the controller's rulings on every finding are PR comments:

- Whole-branch review and rulings: https://github.com/nicolovejoy/prntd/pull/314#issuecomment-6104243477
- Adversarial money-path review and rulings: https://github.com/nicolovejoy/prntd/pull/314#issuecomment-6104283995

Follow-up issues opened from the reviews: #315 (expire the earlier Stripe session), #316 (cap checkout attempts and cart lines), #317 (`/order/confirm` and return-path hardening), and item 7 on #310 (an image hidden while a checkout session is open).

Commits on the branch, after the spec, plan and plan-review docs: `b1a9d45` (Task 1), `b3e94c8` (Task 2), `cf7de27` (Task 3), `aa900d2` (Task 4), `7d4cfed` (Task 5), `ebdd8d6` and `f8da08e` (review fixes).

Every line below that contains "Ruling:" is a decision the controller made on Nico's behalf, with its reason and what it costs if wrong. What follows is the session's working ledger as written during the run.

---


Controller: session 1009 (2026-10-10 evening, laptop). Worktree `.claude/worktrees/cart-embedded-checkout`, branch `claude/cart-embedded-checkout`.
Spec: `docs/superpowers/specs/2026-10-10-cart-embedded-checkout.md`.
Models: Sonnet implementers and task reviewers, Haiku scoped re-reviews, Opus whole-branch and adversarial reviews.
Reports: subagents cannot write report files here; each hand-back is condensed by the controller into `task-N-report.md` in this directory.

## Setup

- Plan review's eight edits applied to the plan: `cafac46`.
- main (`4a9630e`, #312, comment only in `buy-panel.tsx`) merged: `b606e92`. No file in the fence changed.
- `npm ci` exit 0. Baseline `vitest run` over the slice's files: 16 files, 185 tests, all pass.
- Slice 6a not in flight (no PR, no branch).
- `CART_ENABLED` is listed in Vercel's Preview scope (`vercel env ls preview`, names only), which settles the plan's open question 5 as far as the name goes; its value was not read.

## Preflight scan

Checked: each task's Files list against every other task's; the identifiers that cross tasks (`uiMode`, `return_url`, `%2Fcart`, `checkout-review`, `checkout-preview`, `compact`, `CHECKOUT_FAILED`, `cart-checkout-error`) by where the plan uses them; the plan's own "Preflight" table; the plan review's "Cross-task seams agree" and "Checked and found correct" sections (a Sonnet reviewer traced every anchor against the code at `b1b5e61`).

| Pair | Produces / consumes | Found |
|---|---|---|
| T1 → T2 | `buildCartCheckoutSessionParams({ uiMode })` / `checkoutCart` passes `uiMode` and `appUrl`; T2's tests rebuild expected hosted params with the builder | Agree. T2 must start after T1's commit. |
| T2 → T3 | `checkoutCart()` returns a relative `/checkout?session=…&from=%2Fcart` or throws / `handleCheckout` assigns `url`, catches a throw | Agree. T3 mocks the action; no shared file. |
| T2 → T4 | N `order_item` rows reach `/checkout` with `from=/cart` / loader and page tests seed their own rows | Agree. No shared file. |
| T4 → T5 | `data-testid="checkout-review"` wrapping one `checkout-preview` per line, Back link / nightly counts and reads `href` | Agree. `checkout-preview` matches twice with two lines; T5 scopes every use. |
| T2 → T5 | Cart Checkout lands on `/checkout?session=cs_test_…&from=%2Fcart` / nightly waits for it | Agree. |
| T5 ↔ all | T5 edits `CLAUDE.md` standing lines and docs only | No product file shared with T1–T4. |

| Task | Own text agrees with itself |
|---|---|
| T1 | Yes. Tests use the existing `cartBase`; the builder change is one optional parameter. |
| T2 | Yes after the plan-review edit to the inserted comment. Comments-only edits in `flags.ts` and `embedded-checkout.ts` now include `embedded-checkout.ts:5`. |
| T3 | Yes. |
| T4 | Yes. |
| T5 | Yes. Cannot run its spec; checked by typecheck and `playwright --list` only. |

No conflict found. No ruling needed before Task 1.

## Tasks

- Task 1: implementer (Sonnet) DONE, commit b1a9d45; RED 2 failed/23 passed, GREEN 25/25, typecheck clean.
- Task 1: review (Sonnet): spec ✅, quality Approved, no Critical or Important.
- Task 1: ⚠️ to confirm after Tasks 2–4: the `uiMode` docblock says "/checkout's own Back link, which `checkoutCart` points at the cart". True only once Task 2 lands.
- Task 1: minor (deferred): the hosted pin's expected object restates the builder's formulas (`cents()`, the `PRNTD ` name prefix), so a rule changed in both places would pass. Plan-mandated; amounts are pinned independently by the older line-item tests.
- Task 1: minor (deferred): the embedded case's `line_items` and `shipping_options` length assertions add little beyond its deep-equal.
- Task 1: complete (commits b606e92..b1a9d45, review clean)

- Task 2: implementer (Sonnet) DONE_WITH_CONCERNS, commit b3e94c8; RED 10 failed/9 passed (both sets as the brief lists), GREEN 15 files/192 tests, typecheck clean, lint 0 errors, db:generate "No schema changes".
- Task 2: claimed departures: the config/`appUrl` block sits above the "Order-level row" comment rather than under it (still before `const head` and the `db.batch`); reflowed comment lines. Sent to review as claims.
- Watch item (not this slice's code): `src/app/cart/__tests__/cart-page.test.tsx` "recovers on Retry" and "absorbs a single transient failure…" flaked under load during Task 2's runs (real-timer ~800 ms retries against a 1000 ms `findBy*` timeout; 24 s and 173 s durations suggest machine stalls). Passed on a clean rerun. Expect it in the gate; rerun before concluding.
- Ruling: Task 3's implementer was dispatched while Task 2's review was still running — Task 3 edits two files no other task touches and mocks the action, so it does not build on Task 2's code; only one mutating agent is in the tree at a time (a Task 2 fix round waits for Task 3's commit) — costs a wasted Task 3 run only if Task 2's review changes `checkoutCart`'s return contract. BASE for Task 3: b3e94c8.
- Task 2: review (Sonnet): spec ✅, quality Approved, no Critical or Important. The reviewer diffed the committed test file against the brief's code block (identical), confirmed both claimed departures, and ran the new file once: 19/19, no noise.
- Task 1's ⚠️ resolved: `checkoutCart` returns `embeddedCheckoutPath(checkoutSession.id, CART_PATH)`, so the builder docblock's "Back link … points at the cart" is true as of b3e94c8.
- Task 2: ⚠️ to confirm after Tasks 3 and 4: the cart page handles a thrown `checkoutCart` (Task 3) and `/checkout` renders a multi-line cart order (Task 4). With b3e94c8 alone and the switch on, cart buyers reach `/checkout`; the branch is not mergeable before both land.
- Task 2: minor (deferred): `src/lib/embedded-checkout.ts:1-12` header comment reflow left a ragged break ("EMBEDDED_CHECKOUT_ENABLED)," alone on a line).
- Task 2: minor (deferred): "the rows are the same in both modes" compares `hasComposition` across modes but never asserts it true, so it proves parity, not attribution.
- Task 2: minor (deferred): the switch-off and embedded param checks build the expected value with the production builder (plan-mandated, no price in fixtures); the builder's own output is pinned only by Task 1's tests.
- Task 2: complete (commits b1a9d45..b3e94c8, review clean)

- Task 3: implementer (Sonnet) DONE, commit cf7de27; RED 2 failed/25 passed/3 errors as the brief expects, GREEN 27/27 clean over three runs, typecheck clean, lint 0 errors. The two known-flaky tests passed in all four runs.
- Task 4's implementer dispatched while Task 3's review runs, under the same ruling as Task 3's dispatch (disjoint files; one mutating agent at a time). BASE for Task 4: cf7de27.
- Task 3: review (Sonnet): spec ✅, quality Approved, no Critical or Important. Test and handler text match the brief; `beforeEach` resets the mocks so the persistent rejections do not leak.
- Task 2's ⚠️ half-resolved: the cart page now catches a thrown `checkoutCart` (cf7de27). The `/checkout` multi-line half waits on Task 4.
- Task 3: minor (deferred): "a refusal keeps its own message when the cart re-read after it fails" never asserts `getCart` was called a second time, so it would pass with the post-refusal `refresh()` deleted; its failure signal is Vitest's run-level unhandled-rejection error. `expect(getCart).toHaveBeenCalledTimes(2)` would pin it.
- Task 3: minor (deferred, pre-existing, known limit): the `finally` re-enables Checkout while the browser is still navigating, so a second tap makes a second order and session. Decision 7; goes in the follow-up issue (Task 9). More reachable on the embedded path, where the navigation is a same-origin page load.
- Task 3: complete (commits b3e94c8..cf7de27, review clean)

- Task 4: implementer (Sonnet) DONE_WITH_CONCERNS, commit aa900d2; loader tests 3/3 pass on the unedited loader (expected); RED 3 failed in `src/app/checkout`; GREEN 5 files/70 tests, typecheck clean, lint 0 errors.
- Task 4: implementer's concern: the brief's Step 2 says FAIL "in the two `compact` cases"; the `default` compact case passes before the change (it pins today's layout), so 3 failed, not 4. Sent to review as a claim.
- Task 5's implementer dispatched while Task 4's review runs, under the same ruling (Task 5 edits the e2e spec, docs and comments; no file shared with Task 4). BASE for Task 5: aa900d2.
- Task 4: review (Sonnet): spec ✅, quality Approved, no Critical or Important. Non-compact class strings are character-identical to the old ones; the `> 1` boundary is tested both ways; the reviewer agrees the brief's "two compact cases fail" was loose and 3 RED is the true count.
- Task 2's ⚠️ fully resolved: `/checkout` renders a multi-line cart order (aa900d2), loader and page tests added.
- Task 4: ⚠️ for the controller: no act()/React warnings in the checkout tests' output is unverified; check in the gate's test log.
- Task 4: ⚠️ for the controller: with N lines `checkout-preview` matches N times; Task 5's spec must scope or count every use (Playwright strict mode). Check in Task 5's review.
- Task 4: minor (deferred): `page.test.tsx` "a cart session: one review row per line…" searches the whole review block for colour/size, `×2` and "Back design", so none is tied to its own row; a row swap would pass. Plan-mandated. Per-line correctness is pinned by the loader test. Tighten with `within(<row>)`.
- Task 4: minor (deferred): the loader test's comment says it "pins that the summary comes back in insert order, which is cart order"; `loadCheckoutSummary` orders by `asc(createdAt)` only and the lines tie, so the test pins rowid scan order, not a guarantee. The spec lists this under "Found, not changed" and the plan review could not determine tie order on Turso's remote path. Soften the comment, or give the loader a tiebreaker in a separate change.
- Task 4: minor (deferred, pre-existing): `ReviewBlock` rows use `key={i}`; static list, harmless.
- Task 4: complete (commits cf7de27..aa900d2, review clean)

- Task 5: implementer (Sonnet) DONE, commit 7d4cfed; typecheck clean; `playwright --list` shows 3 tests, the first the new cart test. Spec not run (cannot run here); its real run is the dispatched workflow (Task 8).
- Task 5: stale text found by the implementer and left (no instruction): `docs/stripe-e2e.md:15` "slice 6" (now 6a); `docs/stripe-e2e.md:132` "`/checkout` shows `checkout-preview`" (now one per line); `.github/workflows/stripe-e2e.yml:139` "Stripe's hosted checkout DOM"; the older plan's slice 6 text. For the final review to triage.
- Gate 1 at 7d4cfed (controller, while Task 5's review ran): lint 0 errors (25 warnings, all pre-existing), typecheck clean, `npm test` 251 files / 3877 tests passed, `db:generate` "No schema changes" and `drizzle/` clean, build passed with ci.yml's dummy env. Test log: 0 act() warnings, no unhandled errors. The two flaky cart-page tests passed.
- Task 4's ⚠️ (act/React warnings) resolved: none in the full run.
- `npm run e2e` not run locally: the worktree has no local database env. The PR's own `e2e` job runs that suite on an ephemeral Turso branch (plan, Task 6 Step 2).
- Task 5: review (Sonnet): spec ✅, quality Approved, no Critical or Important. Workflow diff is comments only; `CLAUDE.md` has exactly three one-line hunks; every selector, test id, URL and helper the cart test uses exists as written and none can trip strict mode; the cart-emptied poll is not racy (the webhook deletes cart lines before fulfillment submission).
- Task 4's ⚠️ (scoping of `checkout-preview` in the spec) resolved: `:350` scoped to `checkout-review` with count 2, `:479` count 1, `:501` `.first()`.
- Task 5: ⚠️ noted: `docs/stripe-e2e.md:9-10` "as production does since #278 slice 6b" is true only after merge. Plan-mandated wording; fine once merged.
- Task 5: minor (deferred): `.github/workflows/stripe-e2e.yml:139` "Stripe's hosted checkout DOM is the flaky part of this job" is now untrue (the nightly no longer touches hosted checkout). Change to "checkout DOM".
- Task 5: minor (deferred): `e2e/helpers/db.ts:257-258` says the Stripe spec extracts `cs_test_…` "from the hosted-checkout URL". Reword to "from the /checkout URL". (File is outside the plan's fence list but is a comment in an e2e helper.)
- Task 5: minor (deferred): `e2e/stripe-money-path.spec.ts:84-85, 92, 123-124` describe `StripeRoot = Page | FrameLocator` as "hosted … or embedded"; no caller passes a `Page` since this slice.
- Task 5: minor (deferred): `docs/stripe-e2e.md:22` "slice 6" vs `CLAUDE.md`'s "slice 6a"; `docs/stripe-e2e.md:132` "`/checkout` shows `checkout-preview`" is now one per order line.
- Task 5: minor (deferred): the no-price assertion covers only `checkout-review`; a price elsewhere on `/checkout` would pass. Matches the brief and the page tests.
- Task 5: complete (commits aa900d2..7d4cfed, review clean)

## Final reviews
- Ruling: the adversarial money-path review (plan Task 7) is dispatched in parallel with the whole-branch review (Task 6 Step 3), before the PR is open, and its report is posted on the PR once the PR exists — both are read-only Opus reviews of the same head (7d4cfed) and their findings go into one fix wave with one scoped re-review — costs a second adversarial pass only if the whole-branch fixes change the money path materially (the scoped re-review covers the fix diff either way).
- Ruling: the branch is pushed and `stripe-e2e.yml` dispatched on it now as a calibration run, before the reviews return — the embedded DOM with two line items has never been exercised and each run takes about ten minutes — costs one workflow run; it does not count as gate 1 unless the head is unchanged when the gates are taken.
- Stripe e2e calibration run on the branch at 7d4cfed: green on the first try. https://github.com/nicolovejoy/prntd/actions/runs/38101528763 . Log read, not only the check: "Running 3 tests using 1 worker", ✓ `:284` cart: two designs → embedded checkout on /checkout → …, ✓ `:549` owner's unpublished image, ✓ `:560` old /preview link, "3 passed (1.4m)"; Printful contract check passed; ephemeral Turso branch destroyed. Whole run 2m42s (the last nightly on main: 3 passed in 1.6m), so a re-dispatch after a fix commit costs about three minutes, not the ten the plan assumed.
- The log's `generateOrderName failed: Error: 401 … invalid x-api-key` (three times) is expected: the workflow sets `ANTHROPIC_API_KEY: sk-ant-ci-skip`, and the last nightly on main (38059977654) prints the same line three times. Not from this branch.
- This run counts as gate 1 only if the head is still 7d4cfed when the gates are taken; any code commit from the review fix wave reopens it.
- Whole-branch review (Opus) at 7d4cfed: no Critical, no Important, 8 Minor; "ready to merge with fixes, none blocks on its own". Full text and rulings: `whole-branch-review.md` in this directory and the PR comment.
- Draft PR opened after the whole-branch review returned: https://github.com/nicolovejoy/prntd/pull/314 (title "HOLD: …", draft). Whole-branch review and rulings posted as a comment.
- Ruling: whole-branch findings 1, 2, 4, 5, 8 (docblock) and the six triaged deferred items are fixed in one fix wave — they are tests and comments the reviewer showed to be missing or untrue — costs one implementer dispatch and one re-dispatch of the Stripe e2e.
- Ruling: `CLAUDE.md:32` ("Stripe Checkout (hosted) for payments") is fixed in the fix wave although the plan named only three CLAUDE.md lines; `CLAUDE.md:183` (Current state) is left for the post-merge docs commit — the standing line is untrue the moment this merges, the Current state line is true until then — costs one more line in this PR's CLAUDE.md diff.
- Ruling: whole-branch finding 6 (a right-mode key from another Stripe account does not fall back to hosted) changes no code; it is added to the PR's Known limits, the two doc sentences that say "fails closed to hosted" are corrected, and one sentence is added to CLAUDE.md's Stripe bullet — detecting a foreign account's key needs a Stripe call at config time, which nobody has decided to build — costs a buyer-facing dead form after a bad key change, on both surfaces, until someone notices.
- Ruling: whole-branch finding 7 (Checkout returns to idle while /checkout loads; steppers and Edit links live again) stays with the follow-up issue per Nico's decision 7; the reviewer's two notes are added to the issue text — cost: a double tap makes one extra pending order that expires, no charge.
- Ruling: comment-only edits in `scripts/e2e-stripe.sh`, `e2e/helpers/db.ts` and `src/lib/action-copy.ts`, outside the plan's fence list — the branch made those comments untrue — costs three comment hunks to revert.
- Ruling: `src/lib/flags.ts:48-50` ("each buy surface is switched independently") is left for slice 6a, which rewrites that docblock — costs a stale sentence until 6a.
- Adversarial money-path review (Opus) at 7d4cfed: no Critical. 3 Important, all EXISTING on main (earlier session stays payable; image hidden after the session exists is still payable and printed; `checkoutCart` has no limit). 8 Minor, one NEW for the cart (right-mode key from another Stripe account: same as whole-branch finding 6). Ran: nothing in the diff changes what is written to `order`, `order_item`, `cart_item` or `ledger_entry`; switch off is byte-identical to the base commit (params with key order, returned value, rows). Full text and rulings: `adversarial-review.md` here and the PR comment. Working tree clean after both reviewers' probes.
- Ruling: adversarial finding 1 (earlier session payable) is left per Nico's decision 7 and goes into the follow-up issue with the reviewer's evidence — the owner decided it on 2026-10-10 — costs two paid orders and a shirt printed twice for a buyer who pays an old session from history; same on main.
- Ruling: adversarial finding 2 (hidden after the session exists) is not fixed here; recorded on #310 with a question for Nico — it exists on main for both surfaces and the fix needs a decision on what happens to a paid order whose image was hidden meanwhile — costs up to two hours in which an open session can still buy and print a hidden image.
- Ruling: adversarial finding 3 (no limit on `checkoutCart`, no cart line cap) gets a follow-up issue — a cap needs a new refusal line, which this plan forbids, and a number from Nico — costs pending orders and Stripe sessions piling up from one signed-in account; no money moves.
- Ruling: adversarial findings 5, 6, 7, 8, 9, 11 (existing behaviour of `/order/confirm` and the return-origin and return-path checks) go to one hardening follow-up issue — none is changed by this PR, the fixes sit outside the fence (`src/app/order/**`) or need new copy — costs: an unpaid buyer back from a redirect-based method can read "Order confirmed." if the Stripe read fails at that moment (newly reachable for the cart); the rest as on main.
- Ruling: adversarial finding 10 (cart cleanup by line identity) left; known limit, noted in the follow-up issue for finding 1 — costs as on main.
- Ruling: the cart integration tests keep building expected params with the production builder — no price literal in a fixture is a standing rule and the builder has its literal pin in `checkout.test.ts` — costs: a builder bug is caught by one file, not two.
- PR CI at 7d4cfed: `check` pass (3m24s), `e2e` pass (3m35s), Vercel preview deployed. https://github.com/nicolovejoy/prntd/actions/runs/38102282672
- Fix wave dispatched (one Sonnet implementer, brief `fix-wave-brief.md`: T1 ordering test, T2 `checkoutCart` → `/checkout` loader test, T3 re-read assertion, C1–C11 comment and doc corrections). FIX_BASE: 7d4cfed.
- Follow-up issues opened: #315 (expire the earlier session; plan Task 9 Step 1, with adversarial finding 1 and 10 and whole-branch finding 7 as evidence), #316 (cap checkout attempts and cart lines; adversarial 3), #317 (`/order/confirm` and return-path hardening; adversarial 5–9, 11, and `from` on the resume link). Adversarial finding 2 added to #310 as item 7 with question 6.
- Fix wave: implementer (Sonnet) DONE_WITH_CONCERNS, commit ebdd8d6 (11 files). T1–T3 and C1–C11 done; T1 and T3 proven as discriminators by breaking the product code and restoring it (product files not in the commit). Verify: 18 files / 229 tests, typecheck clean, lint 0 errors, 3 tests listed. Two edits beyond the listed lines (a second "failed closed to hosted" bullet in `docs/stripe-e2e.md`; "success/cancel redirects" → `return_url` in the script comment and a doc step), sent to the re-review as claims. One leftover reported: `docs/stripe-e2e.md:95` "mismatched" is ambiguous.
- Gate 2 at ebdd8d6 (controller, while the scoped re-review ran): lint 0 errors (25 pre-existing warnings), typecheck clean, `npm test` 251 files / 3879 tests passed (two more than gate 1: T1 and T2), `db:generate` "No schema changes" with `drizzle/` clean, build passed. 0 act() warnings, no unhandled errors.
- Fix wave: scoped re-review (Sonnet) of 7d4cfed..ebdd8d6: T1–T3 and C1–C11 all ADDRESSED; no new Critical or Important breakage; both declared extra edits true, keep. T1 fails if the config-and-origin block moves below the insert; T2 drives the real `checkoutCart` and the real loader and compares against the seeded cart.
- Fix wave: residual, both non-blocking: the word "mismatched" at `docs/stripe-e2e.md:95-96` and `e2e/stripe-money-path.spec.ts:12` can be read as including a key from another account, which does not fall back to hosted.
- Ruling: the two "mismatched" wordings are sent back to the fix implementer as a two-line follow-up, not parked — the skill allows one fix wave, but these are one word each in a doc and a comment, the reviewer recommends fixing before merge, and no gate has been taken on the final commit yet, so it costs no gate — costs one short dispatch; the controller reads the two-line diff in place of a third review.
- Fix wave: minor (deferred, cosmetic): `src/lib/action-copy.ts:62` heading is one long line carrying a note that belongs in the comment; the new comment sits between the "No 'Try again' on these two" comment and its constants.
- Fix wave: out of scope (deferred): `e2e/stripe-money-path.spec.ts:339` and `:479` failure messages for "opened on Stripe's hosted page" suggest checking the key is "from the same Stripe test account"; a different-account key does not cause that symptom. `resolveReturnOrigin` also trusts `https://prntd.org` and `*.prntd.org`, which the reworded script comment does not mention.
- Fix wave: out of scope (noted, existing): `buildCart` reads `cartItem` with no `orderBy`, so cart order is SQLite insertion order; T2 relies on it as the code does.
- Follow-up commit f8da08e (same implementer, resumed): "mismatched" → "missing, malformed or other-mode" in `docs/stripe-e2e.md` and the spec's header comment. Diff read by the controller: those two wordings and a reflow, nothing else. typecheck clean, eslint clean, 3 tests listed. Final head: f8da08e. The full local gate ran at ebdd8d6; f8da08e differs by one doc paragraph and one comment, and PR CI re-runs the gate on it.
- Pushed f8da08e; `stripe-e2e.yml` dispatched on it (this is the gate-1 run).
- Preview URL confirmed from the Vercel bot's PR comment: https://prntd-git-claude-cart-embedded-checkout-nico-lovejoys-projects.vercel.app . It matches `PREVIEW_HOST_RE` (`^prntd-[a-z0-9-]+-nico-lovejoys-projects\.vercel\.app$`), so an embedded purchase returns to it.
- Preview env names present in Vercel's Preview scope (`vercel env ls preview`, names only): `EMBEDDED_CHECKOUT_ENABLED`, `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `PRINTFUL_DRY_RUN`, `CART_ENABLED`. Values not read.
- The Preview is behind Vercel Authentication (an unauthenticated request gets a 302 to `vercel.com/sso-api`). A fresh Playwright browser cannot reach it without the bypass secret, which the controller does not read. The Preview smoke therefore goes to Nico, in a browser signed in to Vercel, or is run through his Chrome if he allows it (asked this session, not yet answered).

## Gates on the pull request (#314)

- Gate 1, Stripe e2e dispatched on the branch: green at f8da08e. https://github.com/nicolovejoy/prntd/actions/runs/38103234200 . Log read: "Running 3 tests using 1 worker"; ✓ `:289` cart: two designs → embedded checkout on /checkout → …; ✓ `:554` owner's unpublished image; ✓ `:565` old /preview link; "3 passed (1.5m)".
- PR CI at f8da08e: `check` pass (4m39s), `e2e` pass (3m23s), Vercel deployment completed. https://github.com/nicolovejoy/prntd/actions/runs/38103236662
- PR state checked after the runs: OPEN, draft, title still "HOLD: …", head f8da08e. Not merged early.
- Gate 2, adversarial review: posted with rulings (https://github.com/nicolovejoy/prntd/pull/314#issuecomment-6104283995). No finding is fixed by changing product code in this PR; each is ruled on above and the three follow-up issues (#315, #316, #317) and #310 carry them.
- Gate 3, Nico's Preview smoke: owed. Sent to him in full at the end of session 1009. The result is recorded on the PR (third checkbox), not here.
- This ledger was copied to `docs/superpowers/ledgers/2026-10-10-cart-embedded-checkout.md` and committed as a docs-only commit before the smoke was sent, so that no commit is needed between a passed smoke and the merge. The Stripe e2e was dispatched once more on that commit.
