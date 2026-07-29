CREATE TABLE `app_error` (
	`id` text PRIMARY KEY NOT NULL,
	`digest` text,
	`message` text NOT NULL,
	`stack` text,
	`path` text,
	`method` text,
	`context` text,
	`created_at` integer NOT NULL
);
