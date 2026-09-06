# Plan: composition slice 5 — drops + rename, and shops step 2

**Spec authority:** `docs/composition-first-class-plan.md` §2 (target schema),
§5 "Slice 5 — drops + rename" and the "Slice 4 status" notes; issue #191
"Step 2" (organizer storefront retirement). **Branch:** this one
(`cloud/composition-slice-5-drops`). **This PR carries a migration: open it
titled `HOLD: …` and do NOT apply it anywhere but the in-memory/CI test DB.**
Nico applies prod/preview/dev by hand from a self-contained block you put in
the PR body (backup → migrate → verify).

## Scope (one PR, in this order inside the branch)

1. **Shops step 2 (retire organizer storefronts for real).** Delete: the
   `/dashboard/**` routes, `/shop/[slug]/**` routes, `src/lib/store-service.ts`,
   `e2e/store-compose.spec.ts` (and any helper only it used), the
   `STORES_ENABLED` flag reads (`storesEnabled()` and friends), the
   `store`/`product_offering` tables, `order.store_id`, `product.store_id`.
   Before dropping `order.store_id`: the PR body must include a read-only
   prod check for Nico (`select count(*) from "order" where store_id is not
   null`) and the migration must be written so a non-zero count is a stop,
   not silent data loss (the drop happens only after Nico confirms 0;
   state this in the body). `reparent-user.ts` and its per-table integration
   test lose the store/product rows they moved. `src/lib/db-target.ts`
   preflight is untouched.
2. **Composition drops.** Drop `product.design_id` (now that no organizer
   product exists, the mirror rows are the only `product` rows; re-key the
   mirror-uniqueness guard onto the placements front image — add a real
   unique index if libSQL lets you express it, else a documented conditional
   insert per the slice-4 status note). Drop `listing.title`,
   `listing.description`, `listing.background_color`, `listing.feed_rank`
   (frozen since slice 4 — do NOT reconcile them into `product`; they are
   stale by design). Rename `listing` → `image_publication`, and the Drizzle
   symbol `listingTable` → `imagePublicationTable` everywhere.
3. **Verification tooling.** `scripts/check-composition-read-parity.ts` must
   still run clean before the drops (structure only). `scripts/migration-smoke.ts`
   exits 1 on ANY dropped table so it is invalid here — say so in the PR body
   and give Nico a parity-script-based verify instead (same pattern as
   `scripts/check-model-b-parity.ts` gating the Model B drop).

## Gotchas you must handle

- **drizzle-kit's recreate SQL corrupts data** when a column is renamed or
  dropped on SQLite: its `INSERT … SELECT` turns unknown double-quoted column
  names into string LITERALS (slice 1 caught a generated migration that would
  have set every `title` to the literal `'title'`). Hand-review every
  generated `drizzle/00NN_*.sql`; prefer `ALTER TABLE … DROP COLUMN` /
  `ALTER TABLE … RENAME TO` (both supported by libSQL) over recreate. Keep
  the drift gate green: CI runs `db:generate` and fails on a dirty tree, so
  the committed SQL + snapshot must match what drizzle-kit emits, or you
  hand-edit both consistently and prove the gate passes.
- Migration numbering: the next free number after `drizzle/0012_*.sql`.
  Never touch an earlier snapshot.
- `src/lib/__tests__/test-db.ts` derives DDL from `schema.ts`, so unit and
  integration tests pick up the drops automatically; the migration file is
  exercised by `src/lib/__tests__/migration-*.test.ts`-style tests — add one
  that applies the whole chain to a file-backed libSQL and asserts the
  renamed table + dropped columns.
- Some tests seed `store` rows via `src/lib/__tests__/factories.ts`; remove
  those factories with the table.
- `vercel.json` is at the Hobby 2-cron limit; you add no cron.
- You cannot reach prntd.org or any Vercel preview from a cloud session;
  do not try. Local `next build` + the test suite are your verification.

## Tasks

1. Shops step 2 code deletion (no schema yet): routes, service, spec, flag
   reads, nav/footer remnants, factories, reparent rows. `npm run lint`,
   `typecheck`, `test`, `build` green.
2. Schema edit + migration: `store`, `product_offering` dropped;
   `order.store_id`, `product.store_id`, `product.design_id` dropped; listing
   columns dropped; `listing` → `image_publication`. Hand-reviewed SQL.
   Chain-apply test.
3. Code follow-through: every `listingTable` reader → `imagePublicationTable`;
   `findMirrorProduct`/`requireMirrorProduct` re-keyed off `design_id`;
   `buyPublishedDesign` still sets `order.storeProductId`; parity script
   updated to the new names; docs (`composition-first-class-plan.md` "Slice 5
   status", `CLAUDE.md` data-model line) updated.
4. PR body: HOLD title; the prod pre-check query; the backup + migrate +
   verify block for prod, preview and dev; list of every judgment call.

Use superpowers:subagent-driven-development to execute (one implementer per
task, task review after each, whole-branch review at the end). Ledger lives
in `.superpowers/sdd/<plan-basename>/progress.md`.
