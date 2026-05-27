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
