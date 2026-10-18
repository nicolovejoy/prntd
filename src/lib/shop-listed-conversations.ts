/**
 * Which conversations have a card in the Shop feed. The delete confirms use
 * it (Studio lane Delete, bulk delete, the image detail page's conversation
 * Delete): deleting a conversation takes its listings out of the Shop,
 * whether `deleteDesign` removes the image or keeps it for an order, a cart
 * or another design (#321), so the confirm says so when there is one.
 *
 * The rule is the feed's own (`getPublishedFeed`, discover-feed.ts): a
 * composition whose front image has a publication row that is not hidden,
 * attributed to the conversation `feedConversationId` names. No `db` import
 * at module load, so studio.ts can call it with an injected test database.
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
