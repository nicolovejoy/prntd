# Plan: #201 rebuilt — composition slice 5 drops + shops step 2, migration 0014

**Branch:** `claude/201-composition-drops-v2` (from `origin/main` at `fe7f515`).
**PR:** HELD. Nico merges and runs the migration himself. This branch carries
migration `0014_*`; it is applied here only to in-memory / file-backed test
databases.

**Sources.** The old branch `origin/cloud/composition-slice-5-drops` (PR #201,
last merged main at `89886b1`; 57 main commits behind, conflicts in 78 files):
its plan `docs/superpowers/plans/2026-09-05-composition-slice-5-drops.md`, its
ledger `docs/superpowers/ledgers/2026-09-05-composition-slice-5-drops-progress.md`,
its PR body (ten judgment calls + runbook), and
`docs/composition-first-class-plan.md` §2 (target schema) and §5 (slices).
Old commits reused where they still apply:

| Old commit | What | Lands in |
|---|---|---|
| `5916087` | shops step 2, code half | Task 1 |
| `448f416` | schema + migration + follow-through | Task 2 |
| `87b9625` | migration header, late-failure test, wording | Task 2 |
| `15445cd` + the merge's `delete-image.ts` repoint | delete-images seed | Task 2 |
| `2e8aab7` | dual-mode parity check, scripts, docs | Task 3 |
| `9c9bfbe` | parity pre-check hardening | Task 3 |
| `d1e6a0e`, `b5cbdb7` | CLAUDE.md entry + ledger | not reused (CLAUDE.md belongs to the main session) |

**What main added since `89886b1` that touches the dropped schema** (each must
be accounted for, not just the old branch's files): #198 back mockup on the
image detail page (`getListingBackMockup`), #214 anonymous publish gate +
`scripts/check-anonymous-listings.ts`, #219 `/shop` is now the community feed
(so `src/app/shop/page.tsx` stays; only `/shop/[slug]/**` and
`src/app/shop/actions.ts` go), #222/#224 Paper feed + image detail, #226 price
guard, #228 empty-title refusal (+ its test that queries
`product.storeId`/`designId`), #230 title length limit, #234 `order.abandoned_at`
(migration 0013 — ours is 0014), #238 library filter (`user-designs.ts`),
#242/#243 last-image-deletes-conversation (`delete-image.ts`,
`delete-design.ts` `removeDesignIfNowEmpty` keepers),
`scripts/dump-listing-mockups.ts`, `scripts/reparent-user.ts`.

## Tasks

### Task 1 — Shops step 2: code deletion, no schema change

Replay `5916087` onto main and resolve.

Delete: `src/app/dashboard/**`, `src/app/shop/[slug]/**`,
`src/app/shop/actions.ts`, `src/lib/store-service.ts`, `src/lib/stores.ts`,
their tests (`store-service.integration`, `store.integration`, `stores.test`),
`e2e/store-compose.spec.ts` and any e2e helper only it used,
`storesEnabled()`, `STORES_ENABLED` (playwright webServer env, `.env.tpl`),
the money-path "store order (Phase 3)" test. `reparentUserData` stops moving
`store` rows; its per-table test seeds a Shop-composition `product` instead.

Acceptance:
- `next build` route list has `/shop` (the feed) and no `/shop/[slug]` or
  `/dashboard` route.
- No remaining import of `store-service`, `@/lib/stores`, `storesEnabled`.
- lint 0 errors, typecheck clean, vitest green, build clean, `db:generate`
  "No schema changes".

Tests: removals as listed; `reparent-user.integration.test.ts` updated.

### Task 2 — Schema, migration 0014, chain test, compile follow-through

Schema (`src/lib/db/schema.ts`), from the old branch applied to main's current
schema (keep `order.abandonedAt`):
- drop `store`, `productOffering`; drop `order.storeId`;
- `product`: drop `storeId`, `designId`; add
  `frontImageId` = VIRTUAL generated `json_extract(placements, '$.front')` +
  `uniqueIndex("product_front_image_unique")`;
- `listing` → `imagePublication` (`image_publication`) with exactly
  `imageId`, `publishedAt`, `isHidden`, `createdAt`.

Migration: `drizzle-kit generate` against main's 0013 snapshot, answering the
interactive rename prompts through a pty driver (`listing` → rename to
`image_publication`; `front_image_id` → create). Keep drizzle-kit's snapshot
and journal. Replace the SQL body by hand, in this order:
1. guard: scratch `__slice5_guard (n CHECK (n = 0))` fed by
   `count(order WHERE store_id IS NOT NULL)` and
   `count(order JOIN product ON store_product_id WHERE p.design_id IS NOT NULL OR p.store_id IS NOT NULL)`;
   drop the scratch table;
2. `DELETE FROM product WHERE design_id IS NOT NULL OR store_id IS NOT NULL`;
3. `listing` → `image_publication`, drop its four frozen columns;
4. `ALTER TABLE order DROP COLUMN store_id` (inline REFERENCES from 0002 —
   re-verify it still works after 0006 and 0013 touched `order`);
5. `product` recreated by hand (0010 pattern), `INSERT … SELECT` naming only
   columns that exist on the old table, then the unique index;
6. `DROP TABLE store`, `DROP TABLE product_offering`.
Header: "APPLY ONLY VIA `npm run db:migrate`", why each step is hand-written.

Code follow-through: `listingTable` → `imagePublicationTable` everywhere;
`listingSyncStatement` → `publicationSyncStatement`, `buildListingRow` →
`buildPublicationRow` (+ types); `isShopMirror()` removed, readers join on
`product.frontImageId`; mirror lookups (`findMirrorProduct` /
`requireMirrorProduct`) keyed on `frontImageId`; `order/actions.ts` loses the
`storeId` param; the `"product"` bulk-delete skip reason removed (old judgment
call 4 — re-check it against #242/#243's `removeDesignIfNowEmpty` "shop
product" keeper before applying); `composition-backfill.ts` +
`scripts/backfill-composition-products.ts` deleted. Every main-only reader
listed above swept by grep, not by the old diff.

Chain test `src/lib/__tests__/migration-0014-slice5-drops.integration.test.ts`
through the REAL migrator (`drizzle-orm/libsql/migrator`): 0000–0013 replayed,
`__drizzle_migrations` stamped at 0013's journal `when`, folder truncated at
0014. Cases: clean apply (asserts every drop, the rename's exact columns,
`front_image_id` + unique index, surviving mirror intact, order line + ledger
intact, `order.abandoned_at` value preserved, ledger row count); guard on
`order.store_id`; guard on an order pointing at an organizer product; late
failure (duplicate fronts → `CREATE UNIQUE INDEX` fails after the recreate →
full rollback).

Acceptance:
- `npm run db:generate` → "No schema changes" on the committed tree.
- The four chain cases pass; `PRAGMA foreign_key_check` empty after apply.
- The generated `__new_product` DDL matches what drizzle-kit derives from
  `schema.ts` (test-db.ts builds from `schema.ts`, the chain test from the SQL
  files; both must agree on column set).
- lint / typecheck / vitest / build green.
- No test that asserts "0013 is the last migration" is left false.

### Task 3 — Verification tooling, scripts, docs

- `src/lib/composition-parity.ts` + `scripts/check-composition-read-parity.ts`
  dual-mode, renumbered: pre-0014 = PRE-CHECK (structural parity + the guard's
  stop conditions + duplicate surviving fronts + malformed placements JSON +
  leftover scratch tables + the rows step 2 deletes + a note of the newest
  ledger `created_at` vs 0013's journal `when`); post-0014 = VERIFY (drops,
  rename's exact columns, generated column, index, a ledger row at 0014's
  `when`, 1:1 publication ↔ composition, hidden ⇔ status,
  `listed_at = published_at`). Real-DB tests in both modes against databases
  built from the real `drizzle/*.sql` chain.
- Scripts repointed at `image_publication` / dropped columns:
  `check-model-b-tables.ts`, `restore-designs-from-backup.ts` (pre-0014 source
  into post-0014 target), `cleanup-e2e-leftovers.ts`, `delete-designs-since.ts`,
  and main-only `dump-listing-mockups.ts`, `check-anonymous-listings.ts`.
  `check-model-b-parity.ts` deleted.
- Docs: `docs/composition-first-class-plan.md` "Slice 5 status"; RETIRED
  banners on `docs/organizer-pivot-plan.md` + `docs/phase-3-storefront-plan.md`;
  `docs/design-system.md` + README organizer remnants. CLAUDE.md is NOT edited
  (main session owns it) — the Data Model line change is handed back.

Acceptance: parity tests pass in both modes; CLI runs against file-backed
pre/post DBs (pre: exits 1 with seeded problems; post: `POST-0014 VERIFY CLEAN`);
typecheck covers the scripts' imports; gate green.

### Task 4 — Whole-branch review, merge→migrate window, runbook

Fresh pass over `git diff origin/main...HEAD` and the files around it: stale
docblocks naming `listing` / organizer products / `store_id`, invariants other
modules rely on (`removeDesignIfNowEmpty`, `imageReferences`, checkout guards),
e2e helpers. Re-trace the merge→migrate window against current main: Stripe
webhook paid-claim, `checkout.session.expired` (#234), fulfillment,
retry-fulfillment cron, emails, every surface that 500s. Produce the runbook
(pre-check → backup → merge → migrate → verify, prod + preview + dev).

## Gate (Task 4 end)

`npm run lint` (0 errors) · `npm run typecheck` · `npx vitest run` ·
`npm run build` with the CI dummy env · `npm run db:generate` → "No schema
changes" (the migration is committed, so a clean tree is the pass condition).

## Ledger

`docs/superpowers/ledgers/2026-09-25-201-composition-drops-v2-progress.md`.

## Status

Built on this branch; migration `drizzle/0014_thin_pride.sql` awaits Nico's
hand-apply (runbook in the PR body). Deviations from the text above:

- The generated column's expression is `placements ->> '$.front'`, not
  `json_extract(placements, '$.front')`: drizzle-kit 0.31's SQLite
  introspection truncates a generated expression at its first `)`, so the
  nested form made every `db:push` against a migrated database propose
  dropping and re-adding the column. Same values (probed).
- `removeDesignIfNowEmpty` lost its "a product FKs this design" keeper (#243's
  step 5), whose only source was `product.design_id`.
- `dump-listing-mockups.ts` and `check-anonymous-listings.ts` read the
  post-0014 shape only (ops reads run after the migration).
- The old branch's ledger was copied into `docs/superpowers/ledgers/`.
- CLAUDE.md is untouched (the main session owns it).
