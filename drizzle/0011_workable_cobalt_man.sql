CREATE TABLE `image_generation` (
	`id` text PRIMARY KEY NOT NULL,
	`design_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text NOT NULL,
	`operation` text NOT NULL,
	`image_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`anchor_image_id` text,
	`generation_number` integer NOT NULL,
	`day_key` text NOT NULL,
	`ip` text,
	`cost` real DEFAULT 0 NOT NULL,
	`error` text,
	`cancelled_at` integer,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`design_id`) REFERENCES `design`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `image_generation_user_status` ON `image_generation` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `image_generation_design_status` ON `image_generation` (`design_id`,`status`);