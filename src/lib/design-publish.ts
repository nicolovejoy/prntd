/**
 * Publish/lock helpers for design_image rows.
 *
 * Publishing happens at the image level, not the thread level: the
 * conversation that produced an image stays private to the designer;
 * the resulting image is the shareable artifact. An image becomes
 * "locked" the moment it is first published — published_at is set once
 * and the row is immortal from then on (deleteDesignImage refuses).
 *
 * There is no separate is_public flag — published_at is the public
 * marker. To remove an image from the discover feed (and lock it,
 * permanently), admin moderation flips is_hidden. We don't offer
 * self-unpublish today.
 */

export type ImageLockFields = {
  publishedAt: Date | null;
};

export function isLocked(image: ImageLockFields): boolean {
  return image.publishedAt !== null;
}

/**
 * Guard for image-mutation actions (today only deleteDesignImage).
 * Callers already fetch the design_image row for the auth check; pass
 * it in. Throws if the image is locked (published).
 */
export function assertNotLocked(image: ImageLockFields): void {
  if (isLocked(image)) {
    throw new Error(
      "Image is locked — published images cannot be deleted."
    );
  }
}

/**
 * Decide whether `callerId` may fork an image. Self-fork is always
 * allowed (useful for starting a new thread from your own past work).
 * Otherwise the source image must be published and not admin-hidden.
 */
export function canFork(params: {
  sourceImage: { publishedAt: Date | null; isHidden: boolean };
  sourceDesign: { userId: string };
  callerId: string;
}): boolean {
  const { sourceImage, sourceDesign, callerId } = params;
  if (sourceDesign.userId === callerId) return true;
  return sourceImage.publishedAt !== null && !sourceImage.isHidden;
}

/**
 * Decide whether an image may be bought via the buy-existing path
 * (`/d/[imageId]`). Unlike forking there is no owner shortcut: the image
 * must be published and not admin-hidden for anyone — including its
 * owner, who buys their own unpublished work through the normal /order
 * flow instead.
 */
export function canBuyPublishedImage(image: {
  publishedAt: Date | null;
  isHidden: boolean;
}): boolean {
  return image.publishedAt !== null && !image.isHidden;
}

export type ForkChainRow = {
  imageId: string;
  title: string | null;
  designerName: string;
  forkedFromImageId: string | null;
  publishedAt: Date | null;
  isHidden: boolean;
};

export type ForkChainEntry = {
  imageId: string;
  title: string | null;
  designerName: string;
};

/**
 * Walk a fork chain starting at `startImageId`, returning entries
 * immediate-parent-first (i.e. the start image is first, the root is
 * last). Stops at the first invisible link (unpublished or hidden) so
 * moderation actions also break the public attribution trail. Guards
 * against cycles and runaway depth.
 *
 * Pure-logic wrapper around a fetcher callback so it can be unit-tested
 * without a database.
 */
export async function buildForkChain(
  startImageId: string | null,
  fetchRow: (id: string) => Promise<ForkChainRow | null>,
  maxDepth = 10
): Promise<ForkChainEntry[]> {
  const chain: ForkChainEntry[] = [];
  const seen = new Set<string>();
  let currentId: string | null = startImageId;
  while (currentId && chain.length < maxDepth && !seen.has(currentId)) {
    seen.add(currentId);
    const row: ForkChainRow | null = await fetchRow(currentId);
    if (!row) break;
    if (!row.publishedAt || row.isHidden) break;
    chain.push({
      imageId: row.imageId,
      title: row.title,
      designerName: row.designerName,
    });
    currentId = row.forkedFromImageId;
  }
  return chain;
}
