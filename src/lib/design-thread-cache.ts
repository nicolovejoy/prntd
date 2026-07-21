/**
 * Warm-path cache for design threads (#87).
 *
 * /designs cards link to /design?id=<id>, whose page fetches its thread
 * (getDesign + getDesignChat) in a mount effect — so tapping a card renders an
 * empty composer, then the thread pops in. Warming that fetch when a card is
 * visible/touched lets the page hydrate from a synchronous snapshot on mount
 * and skip the flash.
 *
 * Snapshots are initial state only: the page still revalidates fresh in the
 * background, so a stale or absent entry never breaks correctness — worst case
 * is the flash it exists to remove. Loader-injected to keep this lib free of
 * server-action imports; the TTL/dedupe live in the pure ttl-cache.
 */
import type { ChatMessage } from "@/lib/db/schema";
import { createTtlCache } from "@/lib/ttl-cache";

/** The subset of getDesign the /design page reads on mount. */
export interface DesignThreadSnapshot {
  design: { displayImageUrl: string | null } | null;
  chat: ChatMessage[];
}

// A few minutes: long enough to cover the scroll-then-tap window, short enough
// that a warmed thread can't shadow a design the user edited elsewhere for long
// (the page revalidates on mount regardless).
const TTL_MS = 3 * 60 * 1000;

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
export function readWarmedThread(
  designId: string
): DesignThreadSnapshot | undefined {
  return cache.get(designId);
}
