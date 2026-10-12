/**
 * Which sides of a cart or order line show admin-hidden artwork (#310 items
 * 1 and 7). Not a "use server" module: it trusts the ids it is given.
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { design as designTable } from "@/lib/db/schema";
import { isPlacementImageHidden } from "@/lib/back-sources";

export type LineHiddenArt = { front: boolean; back: boolean };

/**
 * Which sides of a cart or order line show admin-hidden artwork.
 * front: the `front` pin when the line has one; otherwise the design's
 *   `primary_image_id` (a pinless legacy line prints the primary); false when
 *   there is neither.
 * back: the `back` pin when the line has one; otherwise false.
 * A pin that is a placement render is judged by the image it renders.
 */
export async function lineHiddenArt(line: {
  designId: string;
  placements: Record<string, string> | null;
}): Promise<LineHiddenArt> {
  const frontPin = line.placements?.front ?? null;
  const backPin = line.placements?.back ?? null;

  const frontId = frontPin ?? (await primaryImageId(line.designId));
  const [front, back] = await Promise.all([
    frontId ? isPlacementImageHidden(frontId) : false,
    backPin ? isPlacementImageHidden(backPin) : false,
  ]);
  return { front, back };
}

async function primaryImageId(designId: string): Promise<string | null> {
  const [row] = await db
    .select({ primaryImageId: designTable.primaryImageId })
    .from(designTable)
    .where(eq(designTable.id, designId))
    .limit(1);
  return row?.primaryImageId ?? null;
}
