CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE `chat_message` (
	`id` text PRIMARY KEY NOT NULL,
	`design_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`image_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`design_id`) REFERENCES `design`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `design` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`primary_image_id` text,
	`generation_count` integer DEFAULT 0 NOT NULL,
	`generation_cost` real DEFAULT 0 NOT NULL,
	`mockup_urls` text,
	`original_designer_id` text,
	`forked_from_image_id` text,
	`active_generator_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `design_image` (
	`id` text PRIMARY KEY NOT NULL,
	`design_id` text NOT NULL,
	`parent_image_id` text,
	`aspect_ratio` text NOT NULL,
	`product_id` text,
	`placement_id` text,
	`image_url` text NOT NULL,
	`prompt` text,
	`generation_cost` real DEFAULT 0 NOT NULL,
	`is_approved` integer DEFAULT false NOT NULL,
	`published_at` integer,
	`is_hidden` integer DEFAULT false NOT NULL,
	`title` text,
	`description` text,
	`background_color` text,
	`generator` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`design_id`) REFERENCES `design`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `generation_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`bucket` text NOT NULL,
	`day` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `generation_usage_bucket_day` ON `generation_usage` (`bucket`,`day`);--> statement-breakpoint
CREATE TABLE `ledger_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text,
	`type` text NOT NULL,
	`amount` real NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`description` text NOT NULL,
	`metadata` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `order`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `order` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`design_id` text NOT NULL,
	`placements` text,
	`printful_order_id` text,
	`stripe_session_id` text,
	`size` text NOT NULL,
	`color` text NOT NULL,
	`product_id` text DEFAULT 'bella-canvas-3001' NOT NULL,
	`display_name` text,
	`quality` text,
	`total_price` real NOT NULL,
	`item_price` real,
	`shipping_price` real,
	`tax_collected` real,
	`status` text DEFAULT 'pending' NOT NULL,
	`shipping_name` text,
	`shipping_address1` text,
	`shipping_address2` text,
	`shipping_city` text,
	`shipping_state` text,
	`shipping_zip` text,
	`shipping_country` text,
	`stripe_payment_intent_id` text,
	`tracking_number` text,
	`tracking_url` text,
	`printful_cost` real,
	`tags` text,
	`classification` text,
	`discount_code` text,
	`discount_amount` real,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`design_id`) REFERENCES `design`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`is_anonymous` integer DEFAULT false,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
