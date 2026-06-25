ALTER TABLE `order` ADD `store_id` text REFERENCES store(id);--> statement-breakpoint
ALTER TABLE `order` ADD `store_product_id` text REFERENCES product(id);