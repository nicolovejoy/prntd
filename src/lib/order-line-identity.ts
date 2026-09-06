/**
 * Per-line identity for a multi-item order.
 *
 * An order's `order_item` rows can each carry a *different* design (a cart
 * checkout fans out to N lines, and nothing requires them to share a thread).
 * Every read site used to show only line 1's artwork, so lines 2..N appeared
 * as bare "product — color / size" text and two lines with the same blank /
 * color / size were indistinguishable. This resolves, per line:
 *
 *   - the thumbnail: the pinned front placement image when the line has one
 *     (that's what actually gets printed), else the design's display image;
 *   - a name: the published title of the pinned front image — since
 *     composition slice 2 that comes off the image's mirror `product` row —
 *     when it
 *     has one. A design has no title of its own, so unpublished lines get
 *     null and the thumbnail carries the identity;
 *   - the contributor set: the distinct owners of the line's placement
 *     images, front-first, so attribution names who actually drew what is
 *     printed rather than whoever owns the conversation the purchase
 *     happened in (composition plan §3).
 *
 * The DB reader takes `db` as a parameter rather than importing the singleton:
 * the email loader is already db-injected, and it keeps the real-DB tests
 * honest (no mocking of the image module).
 */
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import type { db as appDb } from "@/lib/db";
import {
  design as designTable,
  user as userTable,
  image as imageTable,
  conversationImage as conversationImageTable,
  placementRender as placementRenderTable,
  product as productTable,
} from "@/lib/db/schema";
import {
  isPublishedShopMirror,
  mirrorFrontImageId,
} from "@/lib/composition-reads";
import {
  placementImageIds,
  resolveContributors,
  type Contributor,
} from "@/lib/order-attribution";

/** The subset of an OrderLine this needs. */
export type IdentifiableLine = {
  designId: string;
  placements: Record<string, string> | null;
};

export type OrderLineIdentity = {
  /** Absolute image URL (R2 public URLs already are), or null if unresolvable. */
  imageUrl: string | null;
  /** Published title (mirror product) of the pinned front image, else null. */
  title: string | null;
  /** Distinct owners of the line's placement images, front-first. */
  contributors: Contributor[];
};

export type LineIdentityContext = {
  /** image id → url, covering both artifacts and placement renders. */
  urlByImageId: Map<string, string>;
  /** image id → published title (only published images appear). */
  titleByImageId: Map<string, string | null>;
  /** design id → display image url (primary, else latest output). */
  displayUrlByDesignId: Map<string, string>;
  /** design id → owner. Only the legacy fallback for a line whose
   * placements resolve to no image owner at all. */
  designerByDesignId: Map<string, Contributor>;
  /** placement image id → its owner. */
  ownerByImageId: Map<string, Contributor>;
};

/**
 * Pure mapper — the resolution rules, independent of how the maps were filled.
 */
export function buildLineIdentities(
  lines: IdentifiableLine[],
  ctx: LineIdentityContext
): OrderLineIdentity[] {
  return lines.map((line) => {
    const front = line.placements?.front ?? null;
    const pinnedUrl = front ? ctx.urlByImageId.get(front) ?? null : null;
    return {
      imageUrl: pinnedUrl ?? ctx.displayUrlByDesignId.get(line.designId) ?? null,
      title: front ? ctx.titleByImageId.get(front) ?? null : null,
      contributors: resolveContributors({
        placements: line.placements,
        ownerByImageId: ctx.ownerByImageId,
        fallback: ctx.designerByDesignId.get(line.designId) ?? null,
      }),
    };
  });
}

/**
 * Owners of a set of placement image ids, in one query. `/orders` builds its
 * line data separately (it resolves thumbnails through `design-images`) and
 * shares this so the contributor derivation has one definition.
 *
 * A placement id that names a placement render rather than an artifact simply
 * doesn't come back — those carry no owner of their own.
 */
export async function loadImageOwners(
  db: typeof appDb,
  imageIds: string[]
): Promise<Map<string, Contributor>> {
  const owners = new Map<string, Contributor>();
  const unique = [...new Set(imageIds)];
  if (unique.length === 0) return owners;

  const rows = await db
    .select({
      id: imageTable.id,
      ownerId: imageTable.ownerId,
      ownerName: userTable.name,
    })
    .from(imageTable)
    .leftJoin(userTable, eq(userTable.id, imageTable.ownerId))
    .where(inArray(imageTable.id, unique));
  for (const r of rows) {
    owners.set(r.id, { userId: r.ownerId, name: r.ownerName ?? null });
  }
  return owners;
}

/**
 * Batched reader for the maps `buildLineIdentities` needs. Six small queries
 * regardless of line count — never N+1.
 */
export async function loadLineIdentityContext(
  db: typeof appDb,
  lines: IdentifiableLine[]
): Promise<LineIdentityContext> {
  const urlByImageId = new Map<string, string>();
  const titleByImageId = new Map<string, string | null>();
  const displayUrlByDesignId = new Map<string, string>();
  const designerByDesignId = new Map<string, Contributor>();
  const ownerByImageId = new Map<string, Contributor>();

  const pinnedIds = [
    ...new Set(
      lines
        .map((l) => l.placements?.front)
        .filter((v): v is string => Boolean(v))
    ),
  ];
  // Every placement image on the order, not just the pinned front: the back
  // can belong to a different person, and that person is a contributor.
  const placementIds = [
    ...new Set(lines.flatMap((l) => placementImageIds(l.placements))),
  ];
  const designIds = [...new Set(lines.map((l) => l.designId).filter(Boolean))];

  const [designRows, titleRows] = await Promise.all([
    designIds.length
      ? db
          .select({
            id: designTable.id,
            primaryImageId: designTable.primaryImageId,
            ownerId: designTable.userId,
            ownerName: userTable.name,
          })
          .from(designTable)
          .leftJoin(userTable, eq(userTable.id, designTable.userId))
          .where(inArray(designTable.id, designIds))
      : Promise.resolve([]),
    pinnedIds.length
      ? db
          .select({ imageId: mirrorFrontImageId, title: productTable.title })
          .from(productTable)
          .where(
            and(
              isPublishedShopMirror(),
              inArray(mirrorFrontImageId, pinnedIds)
            )
          )
      : Promise.resolve([]),
  ]);

  for (const d of designRows) {
    designerByDesignId.set(d.id, { userId: d.ownerId, name: d.ownerName ?? null });
  }
  for (const l of titleRows) {
    // front_image_id is a nullable generated column; the inArray filter above
    // already excludes null, this only narrows the type.
    if (l.imageId) titleByImageId.set(l.imageId, l.title ?? null);
  }

  // Ids we need URLs for: every pinned front plus every design's primary.
  const primaryIds = designRows
    .map((d) => d.primaryImageId)
    .filter((v): v is string => Boolean(v));
  const wanted = [...new Set([...placementIds, ...primaryIds])];

  if (wanted.length) {
    // Id reuse (Model B §2): an id may be an artifact or a placement render.
    const [artifacts, renders] = await Promise.all([
      // One query serves both jobs: the URL of every id we might render and
      // the owner of every placement image (the contributor derivation).
      db
        .select({
          id: imageTable.id,
          imageUrl: imageTable.imageUrl,
          ownerId: imageTable.ownerId,
          ownerName: userTable.name,
        })
        .from(imageTable)
        .leftJoin(userTable, eq(userTable.id, imageTable.ownerId))
        .where(inArray(imageTable.id, wanted)),
      db
        .select({
          id: placementRenderTable.id,
          imageUrl: placementRenderTable.imageUrl,
        })
        .from(placementRenderTable)
        .where(inArray(placementRenderTable.id, wanted)),
    ]);
    for (const r of artifacts) {
      urlByImageId.set(r.id, r.imageUrl);
      ownerByImageId.set(r.id, { userId: r.ownerId, name: r.ownerName ?? null });
    }
    for (const r of renders) {
      if (!urlByImageId.has(r.id)) urlByImageId.set(r.id, r.imageUrl);
    }
  }

  // Design display image: primary pointer first, then latest output artifact.
  const needFallback: string[] = [];
  for (const d of designRows) {
    const url = d.primaryImageId ? urlByImageId.get(d.primaryImageId) : undefined;
    if (url) displayUrlByDesignId.set(d.id, url);
    else needFallback.push(d.id);
  }
  if (needFallback.length) {
    const fallbackRows = await db
      .select({
        designId: conversationImageTable.designId,
        imageUrl: imageTable.imageUrl,
      })
      .from(conversationImageTable)
      .innerJoin(imageTable, eq(imageTable.id, conversationImageTable.imageId))
      .where(
        and(
          inArray(conversationImageTable.designId, needFallback),
          eq(conversationImageTable.role, "output")
        )
      )
      .orderBy(desc(imageTable.createdAt), sql`image.rowid desc`);
    for (const r of fallbackRows) {
      if (!displayUrlByDesignId.has(r.designId)) {
        displayUrlByDesignId.set(r.designId, r.imageUrl);
      }
    }
  }

  return {
    urlByImageId,
    titleByImageId,
    displayUrlByDesignId,
    designerByDesignId,
    ownerByImageId,
  };
}

/**
 * Convenience: context + mapper in one call. Never throws on a partially
 * resolvable order — unresolved lines simply carry nulls, which every caller
 * degrades to text-only.
 */
export async function resolveOrderLineIdentities(
  db: typeof appDb,
  lines: IdentifiableLine[]
): Promise<OrderLineIdentity[]> {
  if (lines.length === 0) return [];
  const ctx = await loadLineIdentityContext(db, lines);
  return buildLineIdentities(lines, ctx);
}
