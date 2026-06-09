-- #26 guest-funnel + cart: additive prod migration (no drops, no backfill).
-- DDL derived from src/lib/db/schema.ts via drizzle-kit (scripts/print-ddl.ts).
ALTER TABLE `user` ADD COLUMN `is_anonymous` integer DEFAULT false;

CREATE TABLE `cart_item` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`design_id` text NOT NULL,
	`product_id` text NOT NULL,
	`size` text NOT NULL,
	`color` text NOT NULL,
	`placements` text,
	`quantity` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`design_id`) REFERENCES `design`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE TABLE `order_item` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`design_id` text NOT NULL,
	`product_id` text NOT NULL,
	`size` text NOT NULL,
	`color` text NOT NULL,
	`placements` text,
	`quantity` integer DEFAULT 1 NOT NULL,
	`item_price` real NOT NULL,
	`printful_cost` real,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `order`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`design_id`) REFERENCES `design`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE TABLE `generation_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`bucket` text NOT NULL,
	`day` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);

CREATE UNIQUE INDEX `generation_usage_bucket_day` ON `generation_usage` (`bucket`,`day`);
