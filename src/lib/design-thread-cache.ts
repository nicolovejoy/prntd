/**
 * Client-side cache for design threads.
 *
 * Two producers feed it:
 * - Warm path (#87): a /designs card prefetches its thread when visible or
 *   touched, so tapping through hydrates instantly instead of flashing an
 *   empty composer.
 * - Revisit path (#127): the /design page mirrors its rendered state back
 *   here, so /designs → thread → back → same thread re-renders from memory.
 *
 * Snapshots are initial state only: the page still revalidates from the
 * server-streamed thread payload, so a stale or absent entry never breaks
 * correctness — worst case is the flash it exists to remove. The snapshot
 * carries chat AND gallery together so a thread with images can never
 * hydrate into the gallery's "no images yet" state. Loader-injected to keep
 * this lib free of server-action imports; TTL/dedupe live in the pure
 * ttl-cache.
 */
import type { ChatMessage } from "@/lib/db/schema";
import type { DesignImage, ProductVersionGroup } from "@/lib/design-images";
import type { DesignThreadData } from "@/lib/design-thread";
import { sourcesToGalleryImages } from "@/lib/design-view";
import { createTtlCache } from "@/lib/ttl-cache";

/** The /design page's mount state, in the shape its useState hooks consume. */
export interface DesignThreadSnapshot {
  chat: ChatMessage[];
  images: DesignImage[];
  productGroups: ProductVersionGroup[];
  displayImageUrl: string | null;
  closed: boolean;
}

/** Map the server thread payload to the page-state snapshot shape. */
export function threadToSnapshot(t: DesignThreadData): DesignThreadSnapshot {
  return {
    chat: t.chat,
    images: sourcesToGalleryImages(t.sources),
    productGroups: t.productGroups,
    displayImageUrl: t.design.displayImageUrl,
    closed: t.design.closedAt !== null,
  };
}

// Long enough that leaving a thread and coming back within a session hits the
// cache; safe to be generous because the page always revalidates against the
// fresh server payload in the background.
const TTL_MS = 10 * 60 * 1000;

const cache = createTtlCache<DesignThreadSnapshot>({ ttlMs: TTL_MS });

/** Synchronous read for the /design page mount. undefined when absent/expired. */
export function readThreadSnapshot(
  designId: string
): DesignThreadSnapshot | undefined {
  return cache.get(designId);
}

/**
 * Mirror the page's rendered thread state (revisit path).
 *
 * Callers must not write while a generation job is running for the design:
 * the thread is mid-change, and a snapshot taken then would replay "no image
 * yet" on the next visit even though the image has since landed — the worst
 * outcome the leave-and-return journey can produce. The /design page gates
 * this effect on its running-job count and calls dropThreadSnapshot the
 * moment a job settles.
 */
export function writeThreadSnapshot(
  designId: string,
  snapshot: DesignThreadSnapshot
): void {
  cache.set(designId, snapshot);
}

/**
 * Whether the /design page may mirror its current state into the cache.
 *
 * Pure so the gate is testable — it is the only thing standing between a
 * returning user and a snapshot of the thread mid-generation, which would
 * replay "no image yet" after the image had already landed.
 *
 * Refuses while anything is in flight: `jobsActive` covers a running job AND a
 * settled one whose outcome has not been applied yet (the page keeps a settled
 * job tracked until its thread refresh lands, precisely so this stays true
 * across the whole settle); `generating` covers the window where the client has
 * called generateDesign but no job row exists yet.
 */
export function canWriteThreadSnapshot(state: {
  /** Null for a brand-new thread, which has no id to cache under. */
  resumeId: string | null;
  /** False until the design row exists server-side. */
  designExists: boolean;
  jobsActive: boolean;
  generating: boolean;
}): boolean {
  return (
    state.resumeId !== null &&
    state.designExists &&
    !state.jobsActive &&
    !state.generating
  );
}

/**
 * Forget a design's snapshot. Called when a generation job settles: whatever
 * is cached predates the new image, and a miss (re-read from the server) is
 * always safe where a stale hit is not.
 */
export function dropThreadSnapshot(designId: string): void {
  cache.delete(designId);
}
