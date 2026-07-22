CREATE TABLE `conversation_image` (
	`id` text PRIMARY KEY NOT NULL,
	`design_id` text NOT NULL,
	`image_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`design_id`) REFERENCES `design`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_image_unique` ON `conversation_image` (`design_id`,`image_id`,`role`);--> statement-breakpoint
CREATE TABLE `image` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`r2_key` text,
	`image_url` text NOT NULL,
	`aspect_ratio` text NOT NULL,
	`prompt` text,
	`generator` text,
	`generation_cost` real DEFAULT 0 NOT NULL,
	`parent_image_id` text,
	`seed_image_id` text,
	`original_designer_id` text,
	`source_design_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `listing` (
	`image_id` text PRIMARY KEY NOT NULL,
	`published_at` integer NOT NULL,
	`is_hidden` integer DEFAULT false NOT NULL,
	`title` text,
	`description` text,
	`background_color` text,
	`feed_rank` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `placement_render` (
	`id` text PRIMARY KEY NOT NULL,
	`design_id` text NOT NULL,
	`source_image_id` text,
	`blank_id` text NOT NULL,
	`placement_id` text NOT NULL,
	`image_url` text NOT NULL,
	`aspect_ratio` text NOT NULL,
	`generation_cost` real DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`design_id`) REFERENCES `design`(`id`) ON UPDATE no action ON DELETE no action
);
