/**
 * Publish helpers for design_image rows.
 *
 * Publishing happens at the image level, not the thread level: the
 * conversation that produced an image stays private to the designer;
 * the resulting image is the shareable artifact. published_at is the
 * public marker — set it to list the image, clear it to take it down.
 * Publishing is reversible (see unpublishImage); admin moderation flips
 * is_hidden independently.
 *
 * Deletion is no longer gated on publish state. The real constraint is
 * order references: an image an order depends on must never be deleted.
 * See imageReferencedByOrders.
 */

export type OrderPlacementRef = {
  placements: Record<string, string> | null;
};

/**
 * Whether deleting `imageId` would orphan an order that depends on it.
 * Replaces the old "published images are immortal" lock: publishing is
 * now reversible, so deletion keys off real order references instead.
 *
 *  - Direct pin: the image id appears in an order's placements. The
 *    buy-existing path always sets placements.front = imageId, and
 *    designed orders pin their placement renders there.
 *  - Legacy fallback: a pre-Phase-2 order has null/empty placements and
 *    resolves to the design's primary image, so deleting that primary
 *    would change what the order displays.
 *
 * `orders` must be the orders for the image's own design.
 */
export function imageReferencedByOrders(
  imageId: string,
  designPrimaryImageId: string | null,
  orders: OrderPlacementRef[]
): boolean {
  for (const o of orders) {
    if (o.placements && Object.values(o.placements).includes(imageId)) {
      return true;
    }
  }
  if (imageId === designPrimaryImageId) {
    const hasFallbackOrder = orders.some(
      (o) => !o.placements || Object.keys(o.placements).length === 0
    );
    if (hasFallbackOrder) return true;
  }
  return false;
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

/**
 * Decide whether an image may be used as a placement source (the back of a
 * shirt) on an order for `orderDesignId` (#72). Three allowed origins,
 * matching the /preview picker's groups:
 *
 *  - This design: the image belongs to the order's own design thread.
 *  - My Designs: the requesting user owns the image's design.
 *  - Shop: the image is published and not admin-hidden (the buy-existing
 *    surface — same visibility rule as canBuyPublishedImage).
 *
 * Checked at the checkout choke points (createCheckoutSession / addToCart)
 * so a forged image id can't get a private image printed, and at the
 * preview render/mockup actions so the picker's reach and the guard agree.
 */
export function canUseAsPlacementSource(params: {
  image: {
    designId: string;
    publishedAt: Date | null;
    isHidden: boolean;
  };
  /** Owner of the image's design. */
  imageOwnerId: string;
  /** The design the order/preview is for. */
  orderDesignId: string;
  /** The requesting user. */
  userId: string;
}): boolean {
  if (params.image.designId === params.orderDesignId) return true;
  if (params.imageOwnerId === params.userId) return true;
  return params.image.publishedAt !== null && !params.image.isHidden;
}

/**
 * Collapse a published-image feed to one entry per design. Publishing
 * happens per design_image, so a maker who publishes several generations
 * within one design would otherwise flood the storefront with
 * near-identical cards. We keep the most-recently-published image as the
 * design's single storefront representative and return the result newest
 * first. Order-independent: the input need not be pre-sorted.
 */
export function dedupeFeedByDesign<
  T extends { designId: string; publishedAt: Date },
>(rows: T[]): T[] {
  const byDesign = new Map<string, T>();
  for (const row of rows) {
    const existing = byDesign.get(row.designId);
    if (!existing || row.publishedAt.getTime() > existing.publishedAt.getTime()) {
      byDesign.set(row.designId, row);
    }
  }
  return [...byDesign.values()].sort(
    (a, b) => b.publishedAt.getTime() - a.publishedAt.getTime()
  );
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
