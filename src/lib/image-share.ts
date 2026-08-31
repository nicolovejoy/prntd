/**
 * What a link to `/d/[imageId]` shows when it is pasted into a chat client:
 * the design itself rather than the site-wide branded card.
 *
 * Read by `generateMetadata` and by the segment's `opengraph-image` /
 * `twitter-image` routes. Kept out of `d/actions.ts` on purpose — that file
 * is "use server", so anything exported from it becomes a server action, and
 * a Route Handler should not be importing one.
 */
import { eq } from "drizzle-orm";
import { db } from "./db";
import { image as imageTable, listing as listingTable, user as userTable } from "./db/schema";

export type ImageShareCard = {
  imageUrl: string;
  /** Listing title; null when the owner never named it. */
  title: string | null;
  designerName: string;
  /** Pinned storefront backdrop; null means the White default (#76). */
  backgroundColor: string | null;
};

/**
 * Whether an image may appear in a link preview.
 *
 * Deliberately STRICTER than `canViewImagePage`, which lets an owner view
 * their own unpublished work: the image routes that call this are cached
 * Route Handlers keyed on the URL, not on a viewer, so a response computed
 * for one person is served to whoever asks next. Reading the session to
 * restore the owner shortcut would make the route dynamic AND make that
 * cache unsafe, and buys nothing — a crawler has no session. Private work
 * falls back to the site card.
 */
export function canShareImageCard(image: {
  publishedAt: Date | null;
  isHidden: boolean;
}): boolean {
  return image.publishedAt !== null && !image.isHidden;
}

/**
 * The share card for one image, or null when there is nothing shareable
 * (unknown id, never published, unpublished — the listing row is deleted —
 * or admin-hidden). Callers fall back to the site-wide card on null.
 */
export async function getImageShareCard(
  imageId: string
): Promise<ImageShareCard | null> {
  const rows = await db
    .select({
      imageUrl: imageTable.imageUrl,
      title: listingTable.title,
      backgroundColor: listingTable.backgroundColor,
      publishedAt: listingTable.publishedAt,
      isHidden: listingTable.isHidden,
      designerName: userTable.name,
    })
    .from(imageTable)
    .innerJoin(userTable, eq(userTable.id, imageTable.ownerId))
    .leftJoin(listingTable, eq(listingTable.imageId, imageTable.id))
    .where(eq(imageTable.id, imageId))
    .limit(1);

  const r = rows[0];
  if (!r) return null;
  if (!canShareImageCard({ publishedAt: r.publishedAt, isHidden: r.isHidden ?? false })) {
    return null;
  }

  return {
    imageUrl: r.imageUrl,
    title: r.title,
    designerName: r.designerName,
    backgroundColor: r.backgroundColor,
  };
}
