/**
 * Whether deleting conversations would take a card out of the Shop feed. The
 * delete confirms read it (Studio lane Delete and bulk delete through
 * `shopListingsLeaveOnDelete`, the image detail page's conversation Delete at
 * render) and add one line when it would, because nothing else tells the
 * owner (#321).
 *
 * Two conditions. The conversation has a listing, by the feed's own rule
 * (`getPublishedFeed`, discover-feed.ts): a composition whose front image has
 * a publication row that is not hidden, attributed to the conversation
 * `feedConversationId` names. And the delete would remove the design row: a
 * conversation with any order reference is archived by `deleteDesign` and
 * skipped by the bulk delete, its row stays and so does its card, so the
 * delete's own plan (`planDesignDeletion`) decides. The plan runs only for
 * listed conversations, which are few.
 *
 * No `db` import at module load, so tests can inject a database.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { db as appDb } from "./db";
import {
  conversationImage as conversationImageTable,
  image as imageTable,
  imagePublication as imagePublicationTable,
  product as productTable,
} from "./db/schema";
import { mirrorFrontImageId } from "./composition-reads";
import { isDeletionBlocked, planDesignDeletion } from "./delete-design";

type AppDb = typeof appDb;

/**
 * An image's conversation id: `image.source_design_id`, else the design of
 * its `output` link. The Shop feed joins on it and dedupes by it.
 */
export const feedConversationId = sql<string>`coalesce(${imageTable.sourceDesignId}, (select ${conversationImageTable.designId} from ${conversationImageTable} where ${conversationImageTable.imageId} = ${imageTable.id} and ${conversationImageTable.role} = 'output' limit 1))`;

/** The ids among `designIds` that have at least one Shop listing. */
export async function shopListedConversationIds(
  designIds: string[],
  opts: { db?: AppDb } = {}
): Promise<Set<string>> {
  if (designIds.length === 0) return new Set();
  const db = opts.db ?? (await import("./db")).db;
  const rows = await db
    .selectDistinct({ designId: feedConversationId })
    .from(productTable)
    .innerJoin(imageTable, eq(mirrorFrontImageId, imageTable.id))
    .innerJoin(
      imagePublicationTable,
      eq(imagePublicationTable.imageId, imageTable.id)
    )
    .where(
      and(
        eq(imagePublicationTable.isHidden, false),
        inArray(feedConversationId, designIds)
      )
    );
  return new Set(rows.map((r) => r.designId));
}

/**
 * The ids among `designIds` whose delete would take a card out of the Shop:
 * listed, and not blocked by an order (see the header). Ownership is the
 * caller's to check.
 */
export async function shopListingsRemovedByDelete(
  designIds: string[],
  opts: { db?: AppDb } = {}
): Promise<Set<string>> {
  const db = opts.db ?? (await import("./db")).db;
  const listed = await shopListedConversationIds(designIds, { db });
  const plans = await Promise.all(
    [...listed].map((id) => planDesignDeletion(db, id))
  );
  return new Set(
    plans.filter((p) => !isDeletionBlocked(p)).map((p) => p.designId)
  );
}
