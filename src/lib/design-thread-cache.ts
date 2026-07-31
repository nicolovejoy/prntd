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

/**
 * Prefetch a design thread unless one is already fresh or in-flight (deduped).
 * Failures are swallowed — warming is best-effort and never user-visible.
 */
export function warmDesignThread(
  designId: string,
  loader: () => Promise<DesignThreadSnapshot>
): void {
  void cache.warm(designId, loader).catch(() => {});
}

/** Synchronous read for the /design page mount. undefined when absent/expired. */
export function readThreadSnapshot(
  designId: string
): DesignThreadSnapshot | undefined {
  return cache.get(designId);
}

/**
 * Mirror the page's rendered thread state (revisit path). Callers only write
 * state that already passed the turn-tracker guards, so a cancelled or stale
 * generation can never plant a snapshot newer state didn't render.
 */
export function writeThreadSnapshot(
  designId: string,
  snapshot: DesignThreadSnapshot
): void {
  cache.set(designId, snapshot);
}
