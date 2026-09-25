# Progress — #201 rebuilt: composition slice 5 drops + shops step 2 (migration 0014)

Plan: `docs/superpowers/plans/2026-09-25-201-composition-drops-v2.md`.
Branch: `claude/201-composition-drops-v2`, from `origin/main` `fe7f515`.
Old branch: `origin/cloud/composition-slice-5-drops` (PR #201, head `b5cbdb7`).

## Method, and a deviation from the batch brief

The batch brief asks for one implementer subagent and one fresh reviewer
subagent per task, plus a whole-branch review on a stronger model. This
controller session has **no Agent tool** (checked via tool search: only
SendMessage/TaskStop exist, no spawn). So the controller implements every task
itself and runs each review as a separate pass over the committed diff
against the task's acceptance criteria. Those reviews are not independent in
the way the brief intends — the same context that wrote the code reviews it —
and that is the weaker part of this branch. Mitigations: (a) most of the code
is the old branch's, which was independently reviewed task by task and
adversarially at the migration and the merge→migrate window; (b) the reviews
below work from `git diff` and fresh greps, not memory; (c) the main session
should treat this PR as needing an independent review before Nico merges.

## Pre-build findings (controller)

- The worktree clone was shallow (50 commits). Deepened by 100 to find the
  merge base: old branch last merged main at `89886b1`; main is 57 commits
  past it.
- Main's `drizzle/` ends at `0013_omniscient_talkback.sql` (#234,
  `ALTER TABLE order ADD abandoned_at`), journal `when` `1788900841733`. Ours
  is 0014. Plain `db:generate` on main: "No schema changes".
- `/shop` is now the community feed page (#219), so the old branch's "delete
  `src/app/shop/**`, leave `/shop` absent" becomes "delete `/shop/[slug]/**`
  and `shop/actions.ts`, keep `shop/page.tsx`".
- Dry-run replay of `5916087` onto main: 3 modify/delete conflicts (files main
  re-skinned that we delete) + one docblock conflict in `e2e/helpers/auth.ts`.

## Task 1 — shops step 2, code half — DONE (`d6611c7`)

Replayed `5916087`. Conflicts: three modify/delete (files main had
re-skinned in the Paper sweeps, deleted anyway) and the
`e2e/helpers/auth.ts` docblock (took main's "the Studio" redirect wording
with the old branch's account/buys framing). Main-only follow-through:

- **Ruling T1-1.** `/shop` is the community feed since #219, so only
  `src/app/shop/[slug]/**` and `src/app/shop/actions.ts` go; `shop/page.tsx`
  stays. `route-redirects.test.tsx` asserted the slug route's PRESENCE (to
  stop the feed being folded into it); it now asserts the feed page exists
  and `shop/[slug]` does not. Flipping an assertion because the thing it
  protected was deliberately deleted — not a weakened test.
- **Ruling T1-2.** `src/middleware.ts` comment line naming the slug route
  trimmed. Slice A (#241) edits the same file (the protected-route list two
  lines below); expect a trivial comment conflict at merge.
- **Ruling T1-3.** `shop/page.tsx` docblock said a card shows "price" —
  false since #226 and the kind of line CLAUDE.md names as the "$19.43"
  re-entry vector. Fixed while rewriting the same docblock.
- **Finding, not fixed (scope).** `src/lib/product-compose.ts` and the
  organizer pricing helpers in `src/lib/pricing.ts` (`computeProceeds`,
  `priceForProceeds`, `minViablePrice`, `suggestedPrice`,
  `estimateComposeCogs`, `PRNTD_OPS_FEE`, `MIN_ORG_PROCEEDS`) are now reached
  only by their own tests. The old branch left them too. Follow-up candidate.

Gate: lint 0 errors, typecheck clean, 1768 tests / 170 files, build clean
(route list has `/shop`, no `/dashboard`, no `/shop/[slug]`), `db:generate`
"No schema changes".

Review (controller, separate pass over `git show d6611c7`): acceptance met;
the orphaned-helpers finding above is the only item.

## Task 2 — schema, migration 0014, chain test, follow-through — DONE (`1f27260`)

Replayed `448f416`, then the `87b9625` non-SQL hunks and `15445cd`'s seed by
hand. Conflicts: `designs/actions.ts` (main's `deleteImages` + publish gate +
empty-title return type vs the rename), `design-images.ts`
(`deleteDesignImageRow` had moved to `delete-image.ts` in #200 — kept main's
deletion), `composition-mirror` test (main's plan/execute helper, minus the
deleted backfill import). The old 0013 SQL/snapshot/journal were discarded
and regenerated.

- **Ruling T2-1 — generated expression is `placements ->> '$.front'`, not
  `json_extract(placements, '$.front')`.** Found by applying the full chain
  0000–0014 with `drizzle-kit migrate` to a fresh file DB and running
  `drizzle-kit push --strict`: it proposed `DROP COLUMN front_image_id` +
  `ADD` every time. Root cause in `node_modules/drizzle-kit/bin.cjs`
  `extractGeneratedColumns`: `line.substring(line.indexOf("("),
  line.indexOf(")") + 1)` — the introspected expression stops at the FIRST
  `)`, so any nested call reads back truncated. The drop would also fail on
  the unique index, so `db:push` on dev would have been broken after 0014
  (the old PR's judgment call 2 had flagged `db:push` as untried). The arrow
  operator has no inner parentheses: after the switch, the same
  migrate-then-push reports "No changes detected". Semantics probed on the
  local libSQL (3.45.1): text / NULL placements / missing slot / numeric
  value under text affinity / unique rejection / malformed-JSON error all
  match `json_extract`. `->>` needs SQLite 3.38+; every libSQL build is
  newer. The CI e2e "Apply migrations" step is the first run against a real
  Turso server.
- **Ruling T2-2.** `removeDesignIfNowEmpty` (#243) loses step 5 ("a product
  FKs this design → keep"). `product.design_id` was its only source; a
  composition that pins one of the design's images already turns that image's
  delete into a detach, so the image survives for it and the conversation does
  not need to. Docblocks in `delete-image.ts`, `design/actions.ts`
  (`deleteDesignImage`) and `designs/actions.ts` (`deleteImages`) that listed
  "a shop product" as a conversation keeper updated. Test (g) in
  `delete-image-empty-conversation` rewritten to the reachable case: another
  composition pins the last image on its back → image and composition
  survive, conversation deleted (not archived).
- **Ruling T2-3.** Old judgment calls 1–10 re-applied unchanged except the
  numbering (0013 → 0014) and T2-1. The SQL body is byte-identical to the old
  reviewed 0013 apart from the generated expression (diffed).
- **Main-only readers swept** (not in the old diff): `publish-gate`,
  `empty-title`, `delete-images`, `delete-image-empty-conversation` tests;
  `image-share` test titles; two test docblocks; `scripts/reparent-user.ts`
  (`d29f6d4`) counted `schema.store` — scripts sit outside tsconfig, so
  typecheck could not see it.
- Chain test gained an `order.abandoned_at` (0013) preservation assertion.
  Guard mutation-checked: deleting its two INSERTs fails both guard cases.
- `__new_product` DDL diffed against the DDL `drizzle-kit/api` derives from
  `schema.ts`: identical bar the name.

Gate: lint 0 errors, typecheck clean, 1765 tests / 171 files, build clean,
`db:generate` "No schema changes".

Review (controller, adversarial pass on the SQL — see the deviation note at
the top about independence): statement order checked against every FK
(`order.store_product_id` → `product` survives the drop/rename because the
FK is by name and ids are copied; nothing FKs `listing`; `order.store_id` is
dropped before `store`); `order` has no index on `store_id`, no triggers or
views anywhere; `order` was never recreated after 0002 (0006 and 0013 used
ALTER), so `store_id` still carries its inline REFERENCES and plain DROP
COLUMN works; every column in the INSERT…SELECT exists on the 0010-shape
`product`; hrana `migrate()` path re-read in `@libsql/client` 0.17.2 (each
step conditioned on the previous, conditional ROLLBACK). No findings beyond
T2-1/T2-2.

## Task 3 — verification tooling, scripts, docs — DONE (`223f3ab`)

`composition-parity.ts`, its CLI and its 19-case test taken from the old head
(main had not touched them) and renumbered with placeholders so 0014-era
strings shifted to 0015, 0013 → 0014, 0012 → 0013 without double-shifting.

- **Ruling T3-1.** Main-only `dump-listing-mockups.ts` and
  `check-anonymous-listings.ts` repointed at the post-0014 shape only (not
  dual-mode): they are ops reads Nico runs after the migration. The anonymous
  audit also read the FROZEN `listing.title`; it now reads the composition's
  title.
- **Ruling T3-2.** The old branch's ledger copied into
  `docs/superpowers/ledgers/` verbatim so its independent review rulings
  outlive the branch; the 2026-09-05 plan gained a Status pointer.
- **Finding.** `drizzle-kit migrate` (0.31.10) exits 1 with NO error text
  when the guard refuses — only the spinner, then the exit code. Verified by
  seeding an order with `store_id` on a file DB: exit 1, `listing` + `store`
  still there, one ledger row, all products intact. The runbook therefore
  tells Nico to run the pre-check first and read the exit code, not stderr.
- CLI smoke on file-backed DBs: pre-check CLEAN on a seeded 0013 DB (names
  the organizer row the migration deletes; ledger note "= 0013's journal
  when"); `npm run db:migrate` applies 0014; post VERIFY CLEAN;
  `dump-listing-mockups`, `check-anonymous-listings`, `check-model-b-tables`
  all run clean. A tsc probe over the eight touched scripts passes.
- CLAUDE.md NOT edited (main session owns it). Its Data Model line and the
  "PR #201 composition slice 5 (HOLD; regenerate 0013→0014…)" line need the
  main session's update.

Gate: lint 0 errors, typecheck clean, 1784 tests / 172 files.

## Task 4 — whole-branch review

Fresh pass over `git diff origin/main...HEAD` plus greps of the whole tree
(not just the diff) for `listing`, `store`, `organizer`, `design_id IS NULL`,
future-tense "slice 5". Fixed:

- `design-publish.ts` `ImageReferenceFlags.product` said a pin would "blank
  the organizer's sellable" — now describes a composition slot and says the
  image's own front-only composition is not a reference.
- `design-images.ts` `resolveImagesByIds` docblock named "organizer products".
- `designs/actions.ts` publish comment — reworded (the rebuilt text read
  "keeps a re-publish from reviving nothing").
- `discover-feed` test said "composition slice 5+ will start writing" fixed
  blanks — nothing does.
- `cleanup-e2e-leftovers.ts` "throwaway organizer accounts".

**Merge→migrate window, re-traced on current main** (the old judgment call
7 is partly stale):

- New code, old schema (merge first, migrate after the deploy): the Stripe
  paid-claim batch (`order`, `ledger_entry`, `cart_item`) commits — nothing it
  touches changes shape. Fulfillment fails closed at
  `getDesignImageWithOwner`'s `image_publication` join → `paid_printful_failed`
  (no Printful order, no COGS, order `paid` with no `printfulOrderId`);
  recovery = admin Retry or the 08:00 UTC `retry-fulfillment` cron. Emails:
  front-only orders send without titles; a TWO-SIDED order's email loader
  throws on the back image (`resolveHeroImages` → `getDesignImageById`) so
  BOTH the confirmation and the owner alert are skipped and never resent.
  Printful `package_shipped` for a two-sided order: status + tracking commit,
  shipping email skipped the same way, redelivery ignored — that email is
  lost (tracking still on `/orders`). `checkout.session.expired` (#234) is
  unaffected. **Stale in the old trace:** `/orders` does NOT survive (the
  line-identity mapper reads `product.front_image_id`), and a checkout CAN
  start — `/cart` → `checkoutCart` reads neither table — then lands as paid +
  unsubmitted. `/order/confirm` degrades to its "receipt couldn't be loaded"
  state. `/` 500s, so `prod-smoke.yml` (which polls `/` for ~2 minutes after
  the deploy succeeds) files a `prod-smoke` issue if the migrate lags.
- Old code, new schema (migrate before the deploy is live): Drizzle selects
  `order.store_id` → the Stripe and Printful webhooks throw before any write →
  400 → both redeliver; checkout's order insert names `store_id` → throws
  before a Stripe session. Money-safe too, and nothing gets stuck, but a
  failed or dropped Vercel build (#117 caught one) would leave the old code
  on the new schema indefinitely.
- **Ruling T4-1.** Runbook keeps the reviewed order (merge → deploy Ready →
  migrate at once → verify) and adds: run the migrate within ~2 minutes of
  the deploy going Ready; afterwards check `/admin` for paid orders with no
  Printful id created in the window and Retry them.

Interplay with this batch's other branches (for the main session): this
branch removes `storeId` from `createStripeCheckoutForOrder`'s params
(`order/actions.ts`) and the comment in `d/actions.ts` `buyPublishedDesign`
— slice S (#138 slice 3) and slice C (#135 slice 2) touch those files; and
`middleware.ts` (slice A).

## Final gate (after the Task 4 fixes)

lint 0 errors (22 pre-existing warnings) · typecheck clean · **1784 tests /
172 files** · `npm run build` with the CI dummy env clean (route list: `/shop`
present, no `/dashboard`, no `/shop/[slug]`) · `npm run db:generate` → "No
schema changes".

Runtime check beyond the gate: `next start` on the built app against the
file DB that `npm run db:migrate` produced from a seeded 0013 database (not
the schema-derived test DB): `/`, `/shop` (feed with both compositions'
titles), `/d/img1`, `/d/img2`, `/d/img1/opengraph-image`,
`/api/health?db=1` all 200; `/dashboard` and `/shop/club` 404; no SQL errors
in the server log.

Not verified from here: anything on prntd.org, a Vercel preview, or a real
Turso server (unreachable from this session). The PR's CI e2e job applies
0014 to an ephemeral copy of `prntd-preview` over hrana — the first run on a
real server.

## Independent review (main session) → fix round

An independent whole-branch review of `08d9334` found no Critical. It
verified the migration, the guard on both migrator paths, the recreate, the
`->>` generated column, drift, reader coverage and the tests by running them,
and called judgment calls 1–4 sound. Fix round on the same branch:

- **Ruling T5-1 — runbook order is MIGRATE FIRST, then merge. Supersedes
  T4-1.** Traced against current main. Merge-first (new code, old schema):
  every paid order in the gap lands `paid_printful_failed`
  (`getDesignImageById` → `getDesignImageWithOwner` joins
  `image_publication`, `design-images.ts` ~l.443), and two-sided orders
  permanently lose their confirmation, owner-alert and shipping emails
  (`resolveHeroImages`, `order-emails.ts` ~l.58), for a gap with no upper
  bound if the deploy stalls. Migrate-first (old code, new schema) is
  lossless. The Stripe webhook's `order.findFirst` selects `store_id` and
  throws before the paid-claim → 400 → Stripe redelivers. The Printful webhook
  400s and is retried. Old-code order inserts name every column (Drizzle's
  SQLite insert emits `null` for unset columns), so checkout throws before a
  Stripe session exists. The costs are 500 pages and guest sign-in / sign-up
  failing (old `reparentUserData` updates `store`) for the ~2–4 minute
  merge+build gap. A failed migration just means no merge. The plan now
  carries the full runbook: pre-check → rehearsal on a throwaway prod copy →
  backup → migrate + verify (the merge gate) → merge → preview AFTER the merge
  (CI e2e, the nightly and Vercel previews branch from `prntd-preview`) → dev
  → what to do if the guard fires or a payment landed in the gap. Added two
  preconditions: the PR is green and mergeable against current main BEFORE
  step d, so no merge conflict can stretch the gap; and the 0014 file and
  journal stay untouched after step d, because the prod ledger row is stamped
  with its journal `when`.
- **Considered alternative, not built:** swap the fulfillment image resolver
  so the new code tolerates the old schema, which would make merge-first safe.
  Migrate-first makes it unnecessary, and it would put a compatibility shim
  on the money path.
- **Ruling T5-2 — dead organizer code deleted.** `src/lib/product-compose.ts`
  and its test. From `pricing.ts`: `PRNTD_OPS_FEE`, `MIN_ORG_PROCEEDS`,
  `SUGGESTED_ORG_PROCEEDS`, `ProceedsBreakdown`, `computeProceeds`,
  `priceForProceeds`, `minViablePrice`, `suggestedPrice`,
  `estimateComposeCogs`, plus `proceeds.test.ts`. The shipping-once-per-order
  contract stays pinned by `pricing.test.ts`. The no-preselection-price guard
  is untouched. **Kept, with a judgment call:** `validatePlacementFit`
  (`blanks.ts`) and `probeImageAlpha` (`image-alpha.ts`) are now production-
  dead too (their only caller was `product-compose.ts`), but they are
  print-validity rules about the blank and the artwork, not organizer code,
  and a Shop compose UI for two-sided compositions would need exactly them.
  Their docblocks now say they have no production caller and why they stay.
- **Ruling T5-3 — one "own composition" rule for both delete paths.**
  `delete-image.ts` found an image's own composition by its front slot
  (`findMirrorProduct` → `front_image_id`), while `delete-design.ts`'s
  `isOwnMirror` required a single-slot `{front}` row. For a two-sided
  composition fronted by one of the conversation's images, the conversation
  delete treated it as a pin and detached the image, while the image delete
  deleted it with the image. The fix is `compositionFrontImageId(placements)`
  in `model-b-writes.ts`, the in-memory twin of the generated column.
  `delete-design.ts` uses it: the row fronted by one of its images is that
  image's own composition (deleted with it), and every OTHER image the row
  places is pinned by it. That is exactly delete-image's probe ("a product
  pins image I unless it is I's own composition"), including the degenerate
  `{front: I, back: I}`. Nothing writes two-sided compositions yet. New
  `composition-ownership.integration.test.ts` runs both planners on one
  fixture, three cases: own two-sided composition deleted with its front;
  another conversation's composition keeps our back image; the single-slot
  publish shape unchanged. Mutation check: restoring the single-slot rule
  fails case 1. Plus a unit test for the helper.
- Item 4 (the tombstone route test) left as is.

Fix-round gate: lint 0 errors · typecheck clean · **1771 tests / 171 files**
(−17 tests and −2 files deleted with the organizer helpers; +4 tests and +1
file added) · build with the CI dummy env clean · `db:generate` "No schema
changes".
