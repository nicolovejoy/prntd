import { and, eq, sql, type SQL } from "drizzle-orm";
import { cartItem as cartItemTable } from "@/lib/db/schema";

type OrderLine = {
  designId: string;
  productId: string;
  size: string;
  color: string;
  placements: Record<string, string> | null;
};

/** `json_extract(placements, '$.<key>')` equals the image id, or is null when
 * there is none: an absent key (or null placements) equals a missing image id.
 * Compares values, so the key order of the stored JSON does not matter. `key`
 * is a literal, never user input. */
function placementIs(key: "front" | "back", value: string | null): SQL {
  const extracted = sql`json_extract(${cartItemTable.placements}, ${sql.raw(`'$.${key}'`)})`;
  return value === null ? sql`${extracted} is null` : sql`${extracted} = ${value}`;
}

/**
 * The cart lines a paid order line bought (#289): same buyer, design, garment,
 * size and colour, and the same front and back images. Matching the images as
 * well keeps the cleanup from removing an unpaid line for a different image of
 * the same conversation. A line with null placements (from before the front
 * was pinned) matches only an order line with null placements. The line left
 * behind may be the one just paid for (a legacy null-placements line bought
 * through a buy-now path lingers, so the buyer could pay for it twice);
 * nothing is deleted that was not paid for.
 */
export function cartLineMatch(userId: string, line: OrderLine): SQL {
  return and(
    eq(cartItemTable.userId, userId),
    eq(cartItemTable.designId, line.designId),
    eq(cartItemTable.productId, line.productId),
    eq(cartItemTable.size, line.size),
    eq(cartItemTable.color, line.color),
    placementIs("front", line.placements?.front ?? null),
    placementIs("back", line.placements?.back ?? null)
  )!;
}
