PRAGMA foreign_keys=OFF;--> statement-breakpoint
-- Hand-added ahead of the drizzle-generated recreate: the INSERT…SELECT below
-- references the five NEW columns, and on a table that doesn't have them yet
-- SQLite's double-quoted-string fallback silently turns "title" etc. into
-- string LITERALS — every existing row would get title='title'. Adding the
-- columns to the old table first makes the SELECT resolve them as real
-- (NULL) columns. Verified against a scratch DB with the pre-migration shape.
ALTER TABLE `product` ADD COLUMN `title` text;--> statement-breakpoint
ALTER TABLE `product` ADD COLUMN `description` text;--> statement-breakpoint
ALTER TABLE `product` ADD COLUMN `backdrop_color` text;--> statement-breakpoint
ALTER TABLE `product` ADD COLUMN `feed_rank` integer;--> statement-breakpoint
ALTER TABLE `product` ADD COLUMN `listed_at` integer;--> statement-breakpoint
CREATE TABLE `__new_product` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`store_id` text,
	`design_id` text,
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
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`store_id`) REFERENCES `store`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`design_id`) REFERENCES `design`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_product`("id", "owner_id", "store_id", "design_id", "blank_id", "placements", "price", "status", "position", "title", "description", "backdrop_color", "feed_rank", "listed_at", "created_at", "updated_at") SELECT "id", "owner_id", "store_id", "design_id", "blank_id", "placements", "price", "status", "position", "title", "description", "backdrop_color", "feed_rank", "listed_at", "created_at", "updated_at" FROM `product`;--> statement-breakpoint
DROP TABLE `product`;--> statement-breakpoint
ALTER TABLE `__new_product` RENAME TO `product`;--> statement-breakpoint
PRAGMA foreign_keys=ON;