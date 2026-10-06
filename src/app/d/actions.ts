"use server";

import { headers } from "next/headers";
import { auth, isAnonymousUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  design as designTable,
  image as imageTable,
  product as productTable,
  user as userTable,
} from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import {
  isPublishedShopMirror,
  mirrorFrontImageId,
  mirrorIsHidden,
  mirrorPublishedAt,
} from "@/lib/composition-reads";
import {
  getDesignSourceImages,
  resolveImagesByIds,
} from "@/lib/design-images";
import { resolveBuyPageFront } from "@/lib/placement-pins";
import { buyPageHref } from "@/lib/buy-page-picks";
import { computePrice } from "@/lib/pricing";
import {
  DEFAULT_BLANK_ID,
  getBlank,
  multiPlacementEnabled,
  productSupportsPlacement,
} from "@/lib/blanks";
import { createStripeCheckoutForOrder } from "@/lib/order-checkout";
import { embeddedCheckoutConfig, resolveReturnOrigin } from "@/lib/embedded-checkout";
import { embeddedCheckoutFlag } from "@/lib/flags";
import { renderAndCacheMockup } from "@/lib/mockup-render";
import { getPublishedFeed } from "@/lib/discover-feed";
import { requireMirrorProduct } from "@/lib/model-b-writes";
import {
  assertUsablePlacementImage,
  getBuyPageBackSourceGroups,
  type BackSourceGroup,
} from "@/lib/back-sources";
import { resolveBuyableImage } from "@/lib/buyable-image";
import {
  canViewImagePage,
  buildForkChain,
  type ForkChainEntry,
  type ForkChainRow,
} from "@/lib/design-publish";

export type PublishedImage = {
  imageId: string;
  imageUrl: string;
  title: string | null;
  description: string | null;
  /** Pinned storefront backdrop (a BACKGROUND_PALETTE color name); legacy null displays as White (#73). */
  backgroundColor: string | null;
  /**
   * The garment a composition fixes; absent or null means the buyer picks one
   * (every Shop mirror row today). Optional because ImagePage derives from
   * this type and getImagePage does not supply it. Nothing renders it yet —
   * it is NOT a price input (no price is shown before size + garment are
   * picked; see src/lib/pricing.ts).
   */
  blankId?: string | null;
  designerName: string;
  designerId: string;
  /** True when the feed viewer is this design's owner — render "by you". */
  isOwn: boolean;
  publishedAt: Date;
  /**
   * Walks the lineage from this image's parent up toward the root,
   * stopping at the first hop that isn't published + visible. Empty
   * for original work or when the immediate parent has been hidden.
   * Entries are immediate-parent-first.
   */
  forkChain: ForkChainEntry[];
};

/**
 * What `/d/[imageId]` renders. Same shape as a feed card plus the two things
 * only the page needs: nullable `publishedAt` (the page now also serves the
 * owner's unpublished images, #136 slice 1) and the conversation that
 * produced the image, for the owner's "View conversation" link.
 */
export type ImagePage = Omit<PublishedImage, "publishedAt"> & {
  publishedAt: Date | null;
  sourceDesignId: string | null;
  /**
   * The source conversation still exists AND is reachable. False for a legacy
   * image with no sourceDesignId and for one whose conversation has since been
   * deleted (the image survives a delete when an order, seed or cart pins it),
   * where offering "Open conversation" would lead nowhere.
   */
  hasSourceConversation: boolean;
  /**
   * The source conversation has left the Studio — `closed_at` (the sweep or an
   * explicit Close) or `status = 'archived'` (deleteDesign's fallback for an
   * ordered design). The owner's "Open conversation" undoes both on the way
   * through (slice 5).
   */
  sourceConversationArchived: boolean;
  /**
   * The viewer may order this image from the page: true for a published,
   * visible image (the Shop sells it; `buyPublishedDesign` re-checks), and for
   * an unpublished one only when it is the viewer's own with a live
   * conversation of theirs (`resolveBuyableImage`, the gate every buy action
   * uses). An anonymous owner counts: the panel then asks them to sign in.
   * False means the page shows no Order.
   */
  canOrder: boolean;
};

/**
 * Public discover feed. Returns published, non-hidden images — admin-ranked
 * first, then newest first (see src/lib/discover-feed.ts). No auth required.
 */
export async function getDiscoverFeed(limit = 60): Promise<PublishedImage[]> {
  // Identify the viewer so we can tag their own designs "by you". Best-effort:
  // a signed-out visitor just sees every card attributed by maker name.
  let viewerId: string | null = null;
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    viewerId = session?.user.id ?? null;
  } catch {
    viewerId = null;
  }

  const rows = await getPublishedFeed(limit);

  return rows.map((r) => ({
    imageId: r.imageId,
    imageUrl: r.imageUrl,
    title: r.title,
    description: r.description,
    backgroundColor: r.backgroundColor,
    blankId: r.blankId,
    designerName: r.designerName,
    designerId: r.designerId,
    isOwn: viewerId !== null && r.designerId === viewerId,
    publishedAt: r.publishedAt,
    forkChain: [],
  }));
}

/**
 * Fetcher backing buildForkChain — one row per imageId, joining design
 * and user so we can render the chain without further round-trips.
 */
async function fetchForkChainRow(imageId: string): Promise<ForkChainRow | null> {
  // Lineage now lives on the image graph (image.seed_image_id), not on the
  // conversation. Publish state comes from the image's mirror product
  // (composition slice 2) — a left join, so an unpublished hop still returns
  // a row and buildForkChain stops on it.
  const rows = await db
    .select({
      imageId: imageTable.id,
      title: productTable.title,
      status: productTable.status,
      listedAt: productTable.listedAt,
      productCreatedAt: productTable.createdAt,
      designerName: userTable.name,
      forkedFromImageId: imageTable.seedImageId,
    })
    .from(imageTable)
    .innerJoin(userTable, eq(userTable.id, imageTable.ownerId))
    .leftJoin(
      productTable,
      and(isPublishedShopMirror(), eq(mirrorFrontImageId, imageTable.id))
    )
    .where(eq(imageTable.id, imageId))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    imageId: r.imageId,
    title: r.title,
    designerName: r.designerName,
    forkedFromImageId: r.forkedFromImageId,
    publishedAt: mirrorPublishedAt(r.status, r.listedAt, r.productCreatedAt),
    isHidden: mirrorIsHidden(r.status),
  };
}

/**
 * Single-image page data. Serves published images to everyone and the
 * owner's own unpublished images to the owner (#136 slice 1) — the mirror
 * product is a left join, so an image with no mirror row still returns.
 * Returns null when the viewer may not see it (canViewImagePage) and the
 * route 404s.
 *
 * Composition slice 2: the sellable fields (title / description / backdrop /
 * listedAt) and the hidden flag come off the image's mirror `product` row.
 */
export async function getImagePage(
  imageId: string
): Promise<ImagePage | null> {
  const rows = await db
    .select({
      imageId: imageTable.id,
      imageUrl: imageTable.imageUrl,
      title: productTable.title,
      description: productTable.description,
      backgroundColor: productTable.backdropColor,
      status: productTable.status,
      listedAt: productTable.listedAt,
      productCreatedAt: productTable.createdAt,
      designerName: userTable.name,
      designerId: userTable.id,
      forkedFromImageId: imageTable.seedImageId,
      sourceDesignId: imageTable.sourceDesignId,
      sourceDesignRowId: designTable.id,
      sourceClosedAt: designTable.closedAt,
      sourceStatus: designTable.status,
    })
    .from(imageTable)
    .innerJoin(userTable, eq(userTable.id, imageTable.ownerId))
    .leftJoin(
      productTable,
      and(isPublishedShopMirror(), eq(mirrorFrontImageId, imageTable.id))
    )
    // Left, not inner: legacy images carry no sourceDesignId, and the page
    // must still render them.
    .leftJoin(designTable, eq(designTable.id, imageTable.sourceDesignId))
    .where(eq(imageTable.id, imageId))
    .limit(1);

  const r = rows[0];
  if (!r) return null;

  const publishedAt = mirrorPublishedAt(r.status, r.listedAt, r.productCreatedAt);
  const isHidden = mirrorIsHidden(r.status);

  let viewerId: string | null = null;
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    viewerId = session?.user.id ?? null;
  } catch {
    viewerId = null;
  }

  const isOwn = viewerId !== null && r.designerId === viewerId;
  if (
    !canViewImagePage({
      image: { publishedAt, isHidden },
      imageOwnerId: r.designerId,
      userId: viewerId,
    })
  ) {
    return null;
  }

  // Walk forkedFromImageId upward, stopping at the first invisible
  // parent so admin moderation also breaks the public chain.
  const forkChain = await buildForkChain(r.forkedFromImageId, fetchForkChainRow);

  // Published: the Shop sells it, no further lookup on this public page.
  // Unpublished: only the owner gets here (canViewImagePage), and they can
  // order it only through a live conversation of theirs.
  const canOrder =
    publishedAt !== null ||
    (await resolveBuyableImage(imageId, viewerId)).ok;

  return {
    imageId: r.imageId,
    imageUrl: r.imageUrl,
    title: r.title,
    description: r.description,
    backgroundColor: r.backgroundColor,
    designerName: r.designerName,
    designerId: r.designerId,
    isOwn,
    publishedAt,
    sourceDesignId: r.sourceDesignId,
    hasSourceConversation: r.sourceDesignRowId !== null,
    sourceConversationArchived:
      r.sourceClosedAt !== null || r.sourceStatus === "archived",
    canOrder,
    forkChain,
  };
}

export type SiblingImage = {
  imageId: string;
  imageUrl: string;
  isPrimary: boolean;
};

/**
 * The other images from the conversation that produced `imageId` (#136
 * slice 3): the variant history, so a non-primary generation is one tap away
 * from the image page instead of buried in the chat thread.
 *
 * Owner-only — a conversation's unpublished variants aren't public, and the
 * caller renders a "Use this one" action alongside. Returns the current image
 * too (flagged `isPrimary` when it's the design's primary) so the caller can
 * decide whether that action applies; callers filter it out of the strip.
 */
export async function getConversationImages(
  designId: string
): Promise<{ images: SiblingImage[]; primaryImageId: string | null }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { images: [], primaryImageId: null };

  const found = await db.query.design.findFirst({
    where: eq(designTable.id, designId),
    columns: { userId: true, primaryImageId: true },
  });
  if (!found || found.userId !== session.user.id) {
    return { images: [], primaryImageId: null };
  }

  // Seeds included: a fresh-start thread's anchor is part of its history and
  // is a legitimate primary (startConversationFromImage already sets it).
  const sources = await getDesignSourceImages(designId, { includeSeeds: true });
  return {
    images: sources.map((s) => ({
      imageId: s.id,
      imageUrl: s.imageUrl,
      isPrimary: s.id === found.primaryImageId,
    })),
    primaryImageId: found.primaryImageId,
  };
}

/**
 * Source groups for the image detail page's back-design picker, scoped for a
 * buyer who usually doesn't own the image's source design: My Designs + Shop, with This design only for the
 * owner (getBuyPageBackSourceGroups). Empty when the flag is off, when the
 * viewer isn't a signed-in, non-anonymous user, or when they may not order
 * this image (`resolveBuyableImage`, the gate `buyPublishedDesign` uses, so
 * the owner's own unpublished image gets groups and nobody else's does) — the
 * buy page hides the back affordance for the first two, this is the server
 * backstop.
 */
export async function getBuyPageBackSources(
  imageId: string
): Promise<{ groups: BackSourceGroup[] }> {
  if (!multiPlacementEnabled()) return { groups: [] };

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || isAnonymousUser(session.user)) return { groups: [] };

  const buyable = await resolveBuyableImage(imageId, session.user.id);
  if (!buyable.ok) return { groups: [] };

  const groups = await getBuyPageBackSourceGroups({
    designId: buyable.designId,
    viewerId: session.user.id,
  });
  return { groups };
}

/**
 * The back design a link carries (`?back=<imageId>`, #278), resolved for the
 * viewer: `{ id, imageUrl }` when they could have picked it themselves, or
 * `null`. Same gates, same order, as `getBuyPageBackSources` (including
 * `resolveBuyableImage` on the page image, so a link to someone else's
 * unpublished image resolves nothing) plus the check `buyPublishedDesign` runs
 * on the back (`assertUsablePlacementImage`), so a link can never put an image
 * on the panel that checkout would refuse. Never throws for an unusable id: a
 * stale or forged link just opens the panel without a back.
 */
export async function resolveInitialBack(
  pageImageId: string,
  backImageId: string
): Promise<{ id: string; imageUrl: string } | null> {
  if (!multiPlacementEnabled()) return null;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || isAnonymousUser(session.user)) return null;

  const buyable = await resolveBuyableImage(pageImageId, session.user.id);
  if (!buyable.ok) return null;

  try {
    await assertUsablePlacementImage(
      backImageId,
      buyable.designId,
      session.user.id
    );
  } catch {
    return null;
  }

  const resolved = (await resolveImagesByIds([backImageId])).get(backImageId);
  return resolved ? { id: backImageId, imageUrl: resolved.imageUrl } : null;
}

/**
 * Front-placement Printful mockup for the image detail page's Order-expand
 * hero (#135 slice 1). Gated like the buy itself (`resolveBuyableImage`:
 * published && !hidden for anyone, or the owner's own unpublished image
 * through a live conversation of theirs) — deliberately NOT ownership-gated
 * for published images, because any visitor who can see the Shop buy page must
 * be able to see the mockup.
 *
 * `sourceImageId` is `imageId` itself: the order pins
 * `placements.front = imageId` (see `buyPublishedDesign` below), which may
 * not be the design's primary image, so the mockup has to render the LISTED
 * image, not whatever the design currently displays. Scale is fixed at 1.0 —
 * there's no scale control on this page. Cache reuse and the render body are
 * `renderAndCacheMockup`'s.
 *
 * After a swap (#138 slice 3) the front is the buyer's back pick, passed as
 * `frontImageId`. That source is held to exactly what `getListingBackMockup`
 * holds a back pick to — MULTI_PLACEMENT_ENABLED (a swap needs a back) and
 * `assertUsablePlacementImage` — so the front grants no reach the back tile
 * didn't already have. Absent, or equal to `imageId`, the call is unchanged.
 */
export async function getListingMockup(params: {
  imageId: string;
  productId: string;
  colorName: string;
  /** The swapped-in front (#138 slice 3); defaults to `imageId`. */
  frontImageId?: string;
}): Promise<{ mockupUrl: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  const viewerId = session?.user.id ?? null;

  // The same gate as the buy itself (`resolveBuyableImage`): any visitor for a
  // published, visible image; otherwise only its owner, through a live
  // conversation of theirs. A placement render is never a page image.
  const buyable = await resolveBuyableImage(params.imageId, viewerId);
  if (!buyable.ok) {
    throw new Error(
      buyable.reason === "not-found" ? "Image not found" : "Unauthorized"
    );
  }
  const designId = buyable.designId;

  const sourceImageId = params.frontImageId ?? params.imageId;
  if (sourceImageId !== params.imageId) {
    if (!multiPlacementEnabled()) {
      throw new Error("Back designs are not enabled");
    }
    // Same bar as the back pick in getListingBackMockup: the viewer's own
    // image or a published, not-hidden one. The guard gives the order's
    // design no weight (a Shop buyer's is the SELLER's); an empty userId is a
    // signed-out viewer and matches no owner.
    await assertUsablePlacementImage(
      sourceImageId,
      designId,
      viewerId ?? "",
      "front"
    );
  }

  return renderAndCacheMockup({
    designId,
    productId: params.productId,
    colorName: params.colorName,
    scale: 1.0,
    placementId: "front",
    sourceImageId,
    userId: viewerId,
  });
}

/**
 * Back-placement Printful mockup for the image detail page's expanded hero
 * (#167 decision 1): the buyer picked a back design in `BuyPanel`, and the
 * back tile shows it on the real garment instead of nothing.
 *
 * Gates, in order, never weaker than the front's (`getListingMockup`):
 *
 *  1. `MULTI_PLACEMENT_ENABLED` — the buy CTA ignores a back without it, so
 *     the mockup must too.
 *  2. The page image is an `image` row with a design (the render is cached on
 *     that design's `mockupUrls`, like every other mockup).
 *  3. `resolveBuyableImage` for the page image — the same gate the buy and the
 *     front mockup use: any visitor for a published, visible image, otherwise
 *     only its owner through a live conversation of theirs. A visitor who can
 *     see the Shop buy page must be able to see its preview.
 *  4. `canUseAsPlacementSource` for the back pick, via the checkout guard
 *     `assertUsablePlacementImage` — the same bar `buyPublishedDesign` holds
 *     the pick to, so the preview and the purchase agree on what may print.
 *     Signed-out callers reach only published, not-hidden backs.
 *  5. Render. `renderAndCacheMockup` throws on an unknown product, color or
 *     placement before any write, and nothing is written here ahead of it,
 *     so a bad request can't poison the cache.
 *
 * Like the front, the picked image prints as-is: this page never creates a
 * placement render (every active blank's front and back placements share an
 * aspect, and there is no reframe path here). `renderAndCacheMockup` still
 * uses a `placement_render` row already anchored on the picked image, if one
 * exists. Scale is fixed at 1.0 — no scale control on this page.
 */
export async function getListingBackMockup(params: {
  /** The page image (goes on the front). */
  imageId: string;
  /** The buyer's back pick. */
  backImageId: string;
  productId: string;
  colorName: string;
}): Promise<{ mockupUrl: string }> {
  if (!multiPlacementEnabled()) {
    throw new Error("Back designs are not enabled");
  }

  const session = await auth.api.getSession({ headers: await headers() });
  const viewerId = session?.user.id ?? null;

  const buyable = await resolveBuyableImage(params.imageId, viewerId);
  if (!buyable.ok) {
    throw new Error(
      buyable.reason === "not-found" ? "Image not found" : "Unauthorized"
    );
  }
  const designId = buyable.designId;

  // The guard gives the order's design no weight (see canUseAsPlacementSource;
  // a Shop buyer's is the SELLER's) — the back must be the viewer's own or
  // published. An empty userId is a signed-out viewer: it matches no owner.
  await assertUsablePlacementImage(params.backImageId, designId, viewerId ?? "");

  return renderAndCacheMockup({
    designId,
    productId: params.productId,
    colorName: params.colorName,
    scale: 1.0,
    placementId: "back",
    sourceImageId: params.backImageId,
    userId: viewerId,
  });
}

/**
 * The image detail page's Order: a logged-in user buys the image on the page.
 * Two kinds of image reach it, decided once by `resolveBuyableImage`:
 *
 *  - Published and not hidden (the Shop path): any signed-in real user, its
 *    owner included. The order's designId is the image's source design, the
 *    SELLER's conversation, NOT a new design, because the buyer isn't creating
 *    one. The order records the image's mirror composition
 *    (`storeProductId`, `requireMirrorProduct`), so a Shop sale is attributed.
 *  - Unpublished: only its owner, and only when the image's conversation still
 *    exists and is theirs. The order's designId is
 *    that conversation and no composition is recorded, as for every
 *    design-your-own order.
 *
 * Anything else throws before a row or a Stripe call is made. Account-gated by
 * decision (orders must tie to an account so they're trackable in /orders): a
 * guest, an anonymous owner included, gets `needsAuth`, and signs in first.
 * The auth check and userId resolution are isolated here so a future guest
 * swap is a few lines.
 *
 * The order is pinned to the exact image bought (`placements.front =
 * imageId`, or `placements.back` after a swap, below) so the webhook prints
 * that image regardless of later regenerations of its source design. Price is
 * `computePrice(0, …)`: the buyer didn't incur generation cost, and the
 * designer's is internal-only and never billed anyway.
 *
 * Swap (#138 slice 3): with a back picked, the buyer may exchange the two
 * sides, which sends `frontImageId` = the picked image and `backImageId` =
 * this page's image. That is the ONLY front change this page allows
 * (`resolveBuyPageFront`): the page image stays printed, because the order's
 * designId (and, on a Shop sale, storeProductId) name it. The override clears
 * the same guard as the back, and the price is unchanged: a back exists either
 * way.
 */
export async function buyPublishedDesign(params: {
  imageId: string;
  productId?: string;
  size: string;
  color: string;
  /** Source design_image id to print on the back (#25). Honored only when
   * MULTI_PLACEMENT_ENABLED; ignored otherwise (defense in depth). */
  backImageId?: string;
  /** Image to print on the front instead of this page's image (#138 slice
   * 3). Swap only: accepted when `backImageId` is this page's image, refused
   * otherwise. Absent (or equal to `imageId`) means the page image, as
   * before. */
  frontImageId?: string;
}): Promise<{ url: string | null; needsAuth?: boolean }> {
  const session = await auth.api.getSession({ headers: await headers() });
  // Purchase point — guests (anonymous-plugin sessions) and the sessionless
  // must sign in to buy. The buy panel's "Sign in to buy" CTA is the primary
  // path; this is the server backstop.
  if (!session || isAnonymousUser(session.user)) {
    return { url: null, needsAuth: true };
  }

  // The one gate (src/lib/buyable-image.ts): an `image` row the buyer may
  // order, and whether it is a Shop sale (published) or the owner's own
  // unpublished work. A refusal throws here, before anything is written.
  const buyable = await resolveBuyableImage(params.imageId, session.user.id);
  if (!buyable.ok) {
    throw new Error(
      buyable.reason === "not-found"
        ? "Image not found"
        : "Image is not available to buy"
    );
  }
  const { image, designId, published } = buyable;

  // On a Shop sale the order's designId is the SELLER's design, so the
  // guard's thread argument gives a cross-owner buyer no extra reach (see
  // canUseAsPlacementSource); on the owner's own unpublished image it is their
  // own conversation. Either way the back image must be the buyer's own or
  // published: the guard never grants a thread on its own.
  const backImageId = multiPlacementEnabled()
    ? params.backImageId ?? null
    : null;
  const resolvedProductId = params.productId ?? DEFAULT_BLANK_ID;
  if (backImageId) {
    // Fulfillment drops a placement the blank can't print, so a back on a
    // blank without one would charge +$8 for nothing — and after a swap the
    // dropped side is this page's image, the listing being bought. Unknown
    // products fall through to resolveOrderVariant's own refusal.
    const blank = getBlank(resolvedProductId);
    if (blank && !productSupportsPlacement(blank, "back")) {
      throw new Error("This product has no back print area");
    }
    await assertUsablePlacementImage(backImageId, designId, session.user.id);
  }

  // Front: this page's image unless the buyer swapped (#138 slice 3). The
  // shape rule runs against the back that will actually be pinned (after the
  // flag gate above), so a dropped back also refuses the override; the
  // override then clears the same guard as the back.
  const frontImageId = resolveBuyPageFront({
    pageImageId: params.imageId,
    front: params.frontImageId,
    back: backImageId,
  });
  const frontSwapped = frontImageId !== params.imageId;
  if (frontSwapped) {
    await assertUsablePlacementImage(
      frontImageId,
      designId,
      session.user.id,
      "front"
    );
  }

  const pricing = computePrice(0, resolvedProductId, params.size, {
    back: !!backImageId,
  });

  // Where a buyer who backs out lands (Stripe's cancel link, /checkout's back
  // link): this page with the panel open on the same shirt (#278). Built from
  // the values validated above, never from a client-sent path. The panel's
  // `back` is the added image, which after a swap is the pinned front, and
  // `swap=1` puts it there again. `from` is deliberately not carried: the
  // breadcrumb falls back to Shop.
  const returnPath = buyPageHref(params.imageId, {
    order: true,
    product: resolvedProductId,
    size: params.size,
    color: params.color,
    back: frontSwapped ? frontImageId : backImageId,
    swap: frontSwapped,
  });

  // Composition slice 4: a Shop purchase records the composition it bought.
  // Every published image has a mirror product (publish writes one; the
  // slice-1 backfill converted the pre-existing listings), and the sellable
  // surfaces already read it — so a missing mirror means the image shouldn't
  // have been buyable at all. Fail loudly rather than book an order with no
  // composition. `storeId` stays null: this is the PRNTD Shop, not an
  // organizer storefront (buyStoreProduct owns that path). The owner's own
  // unpublished image has no composition and books none, like every
  // design-your-own order; it is never given a mirror lookup, so
  // a stale draft mirror left by an unpublish cannot attach itself.
  const storeProductId = published
    ? await requireMirrorProduct(db, params.imageId)
    : null;

  // #135 slice 2: mount on our own /checkout instead of Stripe's hosted page
  // when a usable key pair is configured. `embeddedCheckoutFlag()` on but the
  // config disabled means a key problem, not a deliberate off-switch — log it
  // (never the key itself) and fall back to hosted rather than build a broken
  // embedded session.
  const embedded = embeddedCheckoutConfig();
  if (embeddedCheckoutFlag() && !embedded.enabled) {
    console.error(
      `embedded checkout disabled: ${embedded.reason} — using hosted checkout`
    );
  }

  return createStripeCheckoutForOrder({
    userId: session.user.id,
    designId,
    productId: resolvedProductId,
    size: params.size,
    color: params.color,
    itemPrice: pricing.total,
    placements: {
      front: frontImageId,
      ...(backImageId ? { back: backImageId } : {}),
    },
    // The Stripe line thumbnail follows the front pin, like
    // createCheckoutSession's (#138 slice 1).
    checkoutImageUrl: frontSwapped
      ? (await resolveImagesByIds([frontImageId])).get(frontImageId)
          ?.imageUrl ?? null
      : image.imageUrl,
    cancelUrl: `${process.env.NEXT_PUBLIC_APP_URL}${returnPath}`,
    storeProductId,
    ...(embedded.enabled
      ? {
          embedded: {
            backPath: returnPath,
            returnOrigin: resolveReturnOrigin(
              (await headers()).get("origin"),
              process.env.NEXT_PUBLIC_APP_URL!
            ),
          },
        }
      : {}),
  });
}

