import { db } from "@/lib/db";
import { design as designTable } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  getDesignDisplayImageUrl,
  getDesignMessages,
  getDesignSourceImages,
  getDesignPlacementRenders,
  type SourceImage,
  type ProductVersionGroup,
} from "@/lib/design-images";
import { dedupeById } from "@/lib/design-view";
import type { ChatMessage } from "@/lib/db/schema";

/**
 * Everything the /design thread view needs on mount, fetched together so
 * chat and gallery can never hydrate out of step (the "Generations — no
 * images yet" flash was chat arriving before the gallery payload).
 */
export interface DesignThreadData {
  design: { displayImageUrl: string | null; closedAt: Date | null };
  chat: ChatMessage[];
  sources: SourceImage[];
  productGroups: ProductVersionGroup[];
}

/**
 * Load a design thread for its owner. Returns null for a missing design or
 * one owned by someone else — callers render the empty-thread view either
 * way, matching the old per-piece action behavior (getDesign's null /
 * Unauthorized both left the page empty).
 */
export async function getDesignThreadData(
  designId: string,
  userId: string
): Promise<DesignThreadData | null> {
  const found = await db.query.design.findFirst({
    where: eq(designTable.id, designId),
    columns: { id: true, userId: true, closedAt: true },
  });
  if (!found || found.userId !== userId) return null;

  const [displayImageUrl, chat, sources, productGroups] = await Promise.all([
    getDesignDisplayImageUrl(designId),
    getDesignMessages(designId),
    // Seeds included (slice 3): a fresh-start thread opens showing its
    // starting image in the gallery/strip, referenceable and orderable.
    getDesignSourceImages(designId, { includeSeeds: true }),
    getDesignPlacementRenders(designId),
  ]);

  return {
    design: { displayImageUrl, closedAt: found.closedAt },
    chat,
    // Same duplicate guard the gallery refresh applies (#19).
    sources: dedupeById(sources),
    productGroups,
  };
}
