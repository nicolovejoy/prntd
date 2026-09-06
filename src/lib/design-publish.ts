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
 *  - Direct pin: the image id appears in an order line's placements. The
 *    buy-existing path always sets placements.front = imageId, and
 *    designed orders pin their placement renders there.
 *  - Legacy fallback: a pre-Phase-2 order has null/empty placements and
 *    resolves to the design's primary image, so deleting that primary
 *    would change what the order displays.
 *
 * `orders` must be the order_item lines for the image's own design.
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
 * Everything that can hold a reference to an image once images are shared
 * across conversations (Model B slice 4, plan §7). The caller gathers the
 * flags with whatever queries fit its batch; this stays pure so the decision
 * matrix is unit-testable (image-refcount.test.ts).
 */
export type ImageReferenceFlags = {
  /** Pinned in any order/order_item placements, or the legacy-fallback case
   * (imageReferencedByOrders). Orders are financial records. */
  order: boolean;
  /** A conversation_image link from another design (seed carried into a
   * fresh-start thread, or a backfilled share). */
  otherConversation: boolean;
  /** Pinned in a shop product's placements — deleting would blank the
   * organizer's sellable. */
  product: boolean;
  /** Pinned in someone's cart_item placements (e.g. picked as a back design
   * from Shop). Carts are ephemeral, but a dangling id breaks checkout. */
  cart: boolean;
};

export type ImageReferenceDecision =
  /** No references — the image row (and its image_publication row) may be
   * hard-deleted. */
  | "delete"
  /** Order-referenced: refuse outright. What was printed must stay resolvable. */
  | "blocked"
  /** Referenced elsewhere (link/product/cart): detach this conversation's
   * link only; the image row, its image_publication row and other references
   * survive. */
  | "detach";

/**
 * Slice-4 ref-count rule: an image is deletable only when nothing references
 * it. Order references block deletion entirely (the caller surfaces an
 * error); any other reference downgrades the delete to a link-detach so the
 * referencing surface keeps rendering.
 */
export function imageReferences(flags: ImageReferenceFlags): ImageReferenceDecision {
  if (flags.order) return "blocked";
  if (flags.otherConversation || flags.product || flags.cart) return "detach";
  return "delete";
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
 *  - This design: the image belongs to the order's own design thread AND
 *    the requesting user owns that design. Thread membership alone is not
 *    enough: on a /d buy (and an unchecked addToCart), orderDesignId is the
 *    SELLER's design, so an unqualified thread allowance would let a
 *    cross-owner buyer print the seller's private, unpublished generations
 *    by forging an image id from that thread.
 *  - My Designs: the requesting user owns the image's design.
 *  - Shop: the image is published and not admin-hidden (the buy-existing
 *    surface — same visibility rule as canBuyPublishedImage).
 *
 * Checked at the checkout choke points (createCheckoutSession / addToCart /
 * buyPublishedDesign) so a forged image id can't get a private image
 * printed, and at the preview render/mockup actions so the picker's reach
 * and the guard agree.
 */
export function canUseAsPlacementSource(params: {
  /** Publish state only — Model B keeps it in `image_publication`, and the guard has
   * never had a thread-membership grant to spend a designId on. */
  image: {
    publishedAt: Date | null;
    isHidden: boolean;
  };
  /** Owner of the image's design. */
  imageOwnerId: string;
  /** The design the order/preview is for. No longer grants access on its
   * own (the cross-owner leak above); kept so call sites keep stating which
   * order the check is for. */
  orderDesignId: string;
  /** The requesting user. */
  userId: string;
}): boolean {
  // Ownership covers the This-design origin too: on /preview and /order the
  // order's design is verified as the caller's before this guard runs, so its
  // thread images are the caller's own. There is deliberately NO standalone
  // `image.designId === orderDesignId` grant — see the docstring.
  if (params.imageOwnerId === params.userId) return true;
  return params.image.publishedAt !== null && !params.image.isHidden;
}

/**
 * Decide whether `userId` may start a fresh conversation seeded from an
 * image (Model B slice 3). Same visibility rule as canUseAsPlacementSource,
 * minus the order framing: your own image, or a published + not-hidden one.
 * A private cross-owner image id — however obtained — is rejected.
 */
export function canStartFromImage(params: {
  image: { publishedAt: Date | null; isHidden: boolean };
  imageOwnerId: string;
  userId: string;
}): boolean {
  if (params.imageOwnerId === params.userId) return true;
  return params.image.publishedAt !== null && !params.image.isHidden;
}

/**
 * Decide whether `userId` may open the image page `/d/[imageId]` (#136
 * slice 1). The page served published images only; My Designs now lands on
 * it for the owner's private work too, so the rule gains an owner grant.
 *
 * Admin-hidden stays hidden from everyone, owner included — moderation
 * semantics are unchanged, and an owner who could still reach a hidden page
 * would keep a moderated design linkable.
 *
 * `userId` is nullable here because this is a public page: a signed-out
 * visitor has no id and gets the published-only rule.
 */
export function canViewImagePage(params: {
  image: { publishedAt: Date | null; isHidden: boolean };
  imageOwnerId: string;
  userId: string | null;
}): boolean {
  if (params.image.isHidden) return false;
  if (params.image.publishedAt !== null) return true;
  return params.userId !== null && params.imageOwnerId === params.userId;
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
