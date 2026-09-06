-- Composition slice 5 (docs/composition-first-class-plan.md §5) + organizer
-- storefront retirement step 2 (#191): drop `store` and `product_offering`,
-- `order.store_id`, `product.store_id` / `product.design_id`, the four frozen
-- sellable columns on `listing`, and rename `listing` → `image_publication`.
-- Hand-written: drizzle-kit's generated SQL for this change is invalid on
-- libSQL (see RECREATE below), so the file was replaced and the snapshot kept.
--
-- GUARD. `drizzle-kit migrate` runs every statement in this file as ONE batch
-- (client.migrate: PRAGMA foreign_keys=off; BEGIN DEFERRED … COMMIT) and rolls
-- the whole batch back — the __drizzle_migrations row included — if any
-- statement fails. The scratch table `__slice5_guard` turns the two data
-- pre-checks into statement failures: it CHECKs that no order carries a
-- store_id (an organizer-storefront sale the drops would orphan) and that no
-- order's store_product_id points at an organizer product (which the DELETE
-- below would remove from under the FK). A non-zero count fails the INSERT,
-- the batch rolls back, and the database is untouched: a stop, not silent data
-- loss. Both counts are confirmed 0 on prod by hand before this is applied
-- (the PR body carries the read-only query).
--
-- DELETE. Organizer product rows (design_id or store_id set) are test-era
-- only — no organizer store ever sold — and once both columns are gone they
-- would be indistinguishable from Shop compositions (a stale one pinning the
-- same front image would even collide with the new unique index). They go
-- before the drops, and only after the guard has proven no order needs them.
--
-- RECREATE. `product` is rebuilt by hand rather than `ALTER TABLE … DROP
-- COLUMN` (what drizzle-kit emitted): Drizzle declares FKs as table-level
-- constraints, and libSQL refuses to drop a column a table-level FOREIGN KEY
-- clause names ("unknown column "store_id" in foreign key definition").
-- `order.store_id` (migration 0002) was added with an inline REFERENCES, so its
-- plain DROP COLUMN works. The INSERT…SELECT lists the surviving columns
-- explicitly and every one of them exists on the OLD table, so SQLite's
-- double-quoted-string fallback — which turned unknown "columns" into string
-- LITERALS in the slice-1 generated SQL (0010) — cannot fire here. The
-- __new_product DDL is byte-identical (bar the name) to the CREATE TABLE
-- drizzle-kit derives from schema.ts, which is what the schema-derived test DB
-- and the drift gate both build.
--
-- GENERATED COLUMN. `front_image_id` = json_extract(placements, '$.front') as
-- a VIRTUAL column plus an ordinary unique index on it is the DB-enforced "one
-- composition per front image" rule. A generated column rather than an
-- expression index because drizzle-kit splits an expression index on its comma
-- and backtick-quotes the halves — invalid SQL in both the migration and the
-- test-DB derivation.
--
-- APPLY ONLY VIA `npm run db:migrate`. The guard depends on the migrator
-- running this whole file as one client.migrate() batch (FKs off, BEGIN …
-- COMMIT, rollback on any failure). A statement-by-statement run — `turso db
-- shell < file`, `.read`, pasting into a console — has NO transaction: the
-- guard's failing INSERTs would be reported and execution would simply
-- continue, dropping `store`, `listing` and `order.store_id` with the
-- pre-check unmet. That leaves the database half-migrated and recoverable only
-- from the backup. The PRAGMA foreign_keys pair below is a no-op inside the
-- batch (SQLite ignores it inside a transaction, and the migrator has already
-- turned enforcement off); it is harmless and stays only so the file reads
-- like 0010.
CREATE TABLE `__slice5_guard` (`n` integer NOT NULL CHECK (`n` = 0));--> statement-breakpoint
INSERT INTO `__slice5_guard` SELECT count(*) FROM `order` WHERE `store_id` IS NOT NULL;--> statement-breakpoint
INSERT INTO `__slice5_guard` SELECT count(*) FROM `order` o JOIN `product` p ON p.`id` = o.`store_product_id` WHERE p.`design_id` IS NOT NULL OR p.`store_id` IS NOT NULL;--> statement-breakpoint
DROP TABLE `__slice5_guard`;--> statement-breakpoint
DELETE FROM `product` WHERE `design_id` IS NOT NULL OR `store_id` IS NOT NULL;--> statement-breakpoint
ALTER TABLE `listing` RENAME TO `image_publication`;--> statement-breakpoint
ALTER TABLE `image_publication` DROP COLUMN `title`;--> statement-breakpoint
ALTER TABLE `image_publication` DROP COLUMN `description`;--> statement-breakpoint
ALTER TABLE `image_publication` DROP COLUMN `background_color`;--> statement-breakpoint
ALTER TABLE `image_publication` DROP COLUMN `feed_rank`;--> statement-breakpoint
ALTER TABLE `order` DROP COLUMN `store_id`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_product` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`blank_id` text,
	`placements` text,
	`price` real,
	`status` text DEFAULT 'draft' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`title` text,
	`description` text,
	`backdrop_color` text,
	`feed_rank` integer,
	`listed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`front_image_id` text GENERATED ALWAYS AS (json_extract(placements, '$.front')) VIRTUAL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_product`("id", "owner_id", "blank_id", "placements", "price", "status", "position", "title", "description", "backdrop_color", "feed_rank", "listed_at", "created_at", "updated_at") SELECT "id", "owner_id", "blank_id", "placements", "price", "status", "position", "title", "description", "backdrop_color", "feed_rank", "listed_at", "created_at", "updated_at" FROM `product`;--> statement-breakpoint
DROP TABLE `product`;--> statement-breakpoint
ALTER TABLE `__new_product` RENAME TO `product`;--> statement-breakpoint
CREATE UNIQUE INDEX `product_front_image_unique` ON `product` (`front_image_id`);--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
DROP TABLE `store`;--> statement-breakpoint
DROP TABLE `product_offering`;
