/**
 * Client-side turn tracker for the /design page (#59).
 *
 * Chat sends and generations both register as "turns". A settling server
 * action applies its full UI effects (options, readiness, selection) only
 * when it is still the latest turn and wasn't cancelled — a stale or
 * cancelled completion may still append its content (chat message, gallery
 * image) but must never reset composer-adjacent state a newer turn owns.
 *
 * Pure and framework-free so the guard is unit-testable; the page holds one
 * instance in a ref.
 */
export interface TurnTracker {
  /** Register a new turn; returns its token. Later tokens supersede earlier ones. */
  start(): number;
  /** Mark a turn cancelled (client-side abandon — the server action still runs). */
  cancel(token: number): void;
  isCancelled(token: number): boolean;
  /** True when this token is the latest started turn and not cancelled. */
  isCurrent(token: number): boolean;
}

export function createTurnTracker(): TurnTracker {
  let latest = 0;
  const cancelled = new Set<number>();
  return {
    start() {
      return ++latest;
    },
    cancel(token) {
      cancelled.add(token);
    },
    isCancelled(token) {
      return cancelled.has(token);
    },
    isCurrent(token) {
      return token === latest && !cancelled.has(token);
    },
  };
}
