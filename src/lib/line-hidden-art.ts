/**
 * Which sides of a cart or order line show admin-hidden artwork (#310 items
 * 1 and 7). Not a "use server" module: it trusts the ids it is given.
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { design as designTable } from "@/lib/db/schema";
import { isPlacementImageHidden } from "@/lib/back-sources";
import { getDesignDisplayImageUrl } from "@/lib/design-images";

export type LineHiddenArt = { front: boolean; back: boolean };

/**
 * Which sides of a cart or order line show admin-hidden artwork.
 * front: the `front` pin when the line has one. A line with no front pin
 *   shows and prints the design's display image (the primary when it
 *   resolves, otherwise the design's latest output; `order-fulfillment`
 *   prints the same fallback), so it is judged by that image: hidden when the
 *   primary is hidden (followed through render sources, as for a pin), or when
 *   the display image differs from what the display resolves to with
 *   `excludeHidden` (the two differ exactly when the image it would show is
 *   hidden, so no fallback order is restated here). False when the design has
 *   no image at all.
 * back: the `back` pin when the line has one; otherwise false.
 * A pin that is a placement render is judged by the image it renders.
 */
export async function lineHiddenArt(line: {
  designId: string;
  placements: Record<string, string> | null;
}): Promise<LineHiddenArt> {
  const frontPin = line.placements?.front ?? null;
  const backPin = line.placements?.back ?? null;

  const [front, back] = await Promise.all([
    frontPin
      ? isPlacementImageHidden(frontPin)
      : pinlessFrontHidden(line.designId),
    backPin ? isPlacementImageHidden(backPin) : false,
  ]);
  return { front, back };
}

async function pinlessFrontHidden(designId: string): Promise<boolean> {
  const [primaryId, shown, shownVisible] = await Promise.all([
    primaryImageId(designId),
    getDesignDisplayImageUrl(designId),
    getDesignDisplayImageUrl(designId, { excludeHidden: true }),
  ]);
  if (primaryId && (await isPlacementImageHidden(primaryId))) return true;
  return shown !== shownVisible;
}

async function primaryImageId(designId: string): Promise<string | null> {
  const [row] = await db
    .select({ primaryImageId: designTable.primaryImageId })
    .from(designTable)
    .where(eq(designTable.id, designId))
    .limit(1);
  return row?.primaryImageId ?? null;
}
