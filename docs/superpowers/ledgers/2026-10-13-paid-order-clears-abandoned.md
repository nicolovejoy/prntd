# Ledger: a paid order is never abandoned (#327)

Date: 2026-10-13. Branch `claude/paid-clears-abandoned`. Nico away; every ruling below is Claude's.

## Rulings

1. **Option 1 from the issue, not option 2.** The paid claim in `handleStripeCheckoutCompleted` sets
   `abandoned_at` to null. `/admin/usage` is unchanged. Cost if wrong: a reader that wanted to know an
   order had once been abandoned loses that fact; no reader does today (the admin list and detail
   pages show "Abandoned" only on pending rows). A `console.warn` after the claim keeps the record in
   the logs (whole-branch review finding 4).
2. **Existing Production rows are counted, not fixed.** `scripts/check-paid-abandoned-orders.ts` is
   read-only. If it prints a non-zero count, clearing those rows is a one-line UPDATE Nico decides on.
   Cost if wrong: `/admin/usage` under-counts those buyers until then; the ledger and fulfilment are
   already right for them.
3. **The script lists every order past `pending`, canceled included** (both reviews): a paid, then
   Printful-canceled order that was abandoned before payment also breaks the invariant, and a backfill
   sized from the count should see it. Cosmetic today, since every reader excludes canceled.
4. **The CLAUDE.md clause left this branch** and went into the open docs PR #330, which edits the same
   Payment flow line; two PRs on one line would conflict and a conflicted PR runs no CI.
5. **The second new test was replaced** (both reviews): the redelivery test passed on main too. The
   replacement claims an abandoned order, then runs `handleStripeCheckoutExpired` (a late expiry
   redelivery or a #315 confirmation) and expects `ignored` with `abandoned_at` still null. Two
   existing tests that run the real abandon writers before a claim now also assert the null.
6. **No change to `user-orders.ts`'s module comment** (implementer's call, accepted): it describes how
   abandoned orders get marked, not paid ones.
7. **Task 3 of the plan produced no change** (implementer's call, accepted): the usage integration
   test already seeds paid and shipped orders with `abandonedAt` null and counts them.
8. **UTC in the script's output stays** (whole-branch nit 7): the trailing `Z` keeps it unambiguous,
   and the script is an ops reader, not a page.

## Reviews

- **Whole-branch (Opus): READY.** Checked that every abandon writer requires `status = 'pending'`
  (`handleStripeCheckoutExpired`, `abandonSessionlessOrder`, `expireEarlierCheckoutSessions`, the
  `/checkout` hidden refusal, the legacy script) and no transition leads back to pending; that no
  reader relied on `abandoned_at` staying set after a claim; that the script's seconds-to-ms
  conversion matches the schema's `integer … mode: "timestamp"`. A mutation check (the new line
  removed in a scratch copy) made the first new test fail.
- **Adversarial (Opus): nothing Blocking or Important.** Fourteen throwaway sequences against the
  real in-memory database, on the branch and on main with only `webhook-handlers.ts` swapped:
  `completed`/`expired` in both orders with redeliveries and a batch spy landing the expiry between
  the claim's read and its write; `expireEarlierCheckoutSessions` confirming an expiry of a just-paid
  order; `abandonSessionlessOrder` followed by a paid completion (the claim backfills the session id,
  cart cleanup and `/order/confirm` work, the retry cron recovers a Printful failure); the async
  payment events; concurrent runs. Every sequence ends `submitted`, `abandoned_at` null, ledger
  exactly `cogs`, `sale`, `stripe_fee`, Printful called once. Nine of fourteen fail on main, each only
  on `abandoned_at`.

## Known limits (PR body)

1. Existing Production rows are not backfilled (ruling 2).
2. The fix runs only when a paid completion is processed. An abandoned order whose payment Stripe takes
   but whose webhook never succeeds stays pending and abandoned, hidden from `/orders`, labelled
   Abandoned in admin with no Recover button (Recover refuses a session-less row). Predates this PR;
   reaching it needs Stripe to complete a session it confirmed expired.
3. The claim does not ask why an order was abandoned: a payment landing after a hidden-artwork refusal
   at `/checkout` is claimed and printed, as on main.

## Smoke

No on-screen smoke exists: the state needs a payment to land on an order already marked abandoned,
which Stripe's rules prevent. In its place: (1) Nico runs the read-only script on Production and
reads the count; (2) a dispatched Stripe e2e on the branch, which pays through the webhook claim whose
UPDATE changed.

## Process

One Sonnet implementer in its own worktree (TDD, first test red before the fix); the controller
re-installed the laptop's stale `node_modules` (`fflate` from #261 was missing) and ran the gate
itself (one jsdom file timed out under the parallel reviewers and passed alone, as the batch lesson
says); one Opus whole-branch review and one Opus adversarial review in parallel with the gate; one
fix round to the same implementer.
- Merged by Nico 2026-10-14 as `d0e659c` (second try; the first merge command did not take). Production had 0 affected rows before the merge.
