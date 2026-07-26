-- Data-model Phase 1c: `order_item` becomes the only record of what was bought.
--
-- Orders placed before Phase 1b (PR #54) wrote no order_item row — their line
-- lives only in the scalar columns this migration drops. Backfill first so the
-- drop can't orphan them. Idempotent: skips any order that already has a line,
-- so this file is safe to apply to dev, preview, or prod in any order.
--
-- item_price is NOT NULL on order_item; pre-1B orders have a null order-level
-- item_price, so fall back to total minus shipping (and 0 if neither is known).
-- printful_cost copies the order-level COGS onto the single line — exact for a
-- one-line order, which is what every backfilled row is.
INSERT INTO `order_item` (
	`id`, `order_id`, `design_id`, `product_id`, `size`, `color`,
	`placements`, `quantity`, `item_price`, `printful_cost`, `created_at`
)
SELECT
	'legacy-' || o.`id`,
	o.`id`,
	o.`design_id`,
	o.`product_id`,
	o.`size`,
	o.`color`,
	o.`placements`,
	1,
	COALESCE(o.`item_price`, o.`total_price` - COALESCE(o.`shipping_price`, 0), 0),
	o.`printful_cost`,
	o.`created_at`
FROM `order` o
WHERE NOT EXISTS (
	SELECT 1 FROM `order_item` oi WHERE oi.`order_id` = o.`id`
);--> statement-breakpoint
ALTER TABLE `order` DROP COLUMN `placements`;--> statement-breakpoint
ALTER TABLE `order` DROP COLUMN `size`;--> statement-breakpoint
ALTER TABLE `order` DROP COLUMN `color`;--> statement-breakpoint
ALTER TABLE `order` DROP COLUMN `product_id`;
