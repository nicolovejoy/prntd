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
import { sweepStaleJobs } from "@/lib/generation-job";
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
 * way, matching the per-piece actions it replaced (a missing or foreign design
 * left the page empty).
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
    // The owner's thread leaves admin-hidden artwork out: a hidden primary
    // falls back the way a missing one does, and the sources and the
    // placement renders drop hidden images on their own. Renders are judged
    // one level deep. A primary that is a render id, a render with no
    // recorded source and a render whose source is another render are kept
    // (getDesignPlacementRenders and DisplayImageOptions say why).
    getDesignDisplayImageUrl(designId, { excludeHidden: true }),
    getDesignMessages(designId),
    // Seeds included (slice 3): a fresh-start thread opens showing its
    // starting image in the gallery/strip, referenceable and orderable.
    getDesignSourceImages(designId, { includeSeeds: true }),
    getDesignPlacementRenders(designId),
    // Lazy sweep riding on this read (durable-generation-job plan): a stale
    // job for this design clears the next time its thread is opened, with no
    // new traffic. Narrowest scope for this call site — only the cron sweeps
    // scope: "all". Result discarded; getDesignJobs is the read surface for
    // job state.
    sweepStaleJobs({ scope: "design", designId }),
  ]);

  return {
    design: { displayImageUrl, closedAt: found.closedAt },
    chat,
    // Same duplicate guard the gallery refresh applies (#19).
    sources: dedupeById(sources),
    productGroups,
  };
}
