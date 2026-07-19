CREATE TABLE `product` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`store_id` text,
	`design_id` text NOT NULL,
	`blank_id` text NOT NULL,
	`placements` text,
	`price` real,
	`status` text DEFAULT 'draft' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`store_id`) REFERENCES `store`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`design_id`) REFERENCES `design`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `product_offering` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`printful_category_id` integer,
	`available_from` integer,
	`available_until` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `store` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`accent_color` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `store_slug_unique` ON `store` (`slug`);