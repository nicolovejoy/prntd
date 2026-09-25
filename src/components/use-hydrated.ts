"use client";

import { useSyncExternalStore } from "react";

// Nothing to subscribe to: the value only ever changes once, from the server
// snapshot to the client snapshot, and React handles that switch itself.
function subscribe() {
  return () => {};
}

/**
 * `false` in the server render and for the whole hydration pass, `true` once
 * hydration has committed and on any plain client mount.
 *
 * For client-only state that must not affect the first render. The server
 * HTML and the client's hydration render have to agree, and some state (the
 * better-auth session, most visibly) can already be loaded on the client by
 * the time a hydration pass renders — in particular when React restarts
 * hydration, which re-reads every store. Gate that state on this hook and the
 * hydration render always matches the server.
 *
 * `useSyncExternalStore` rather than a `useEffect` flag: React uses the
 * server snapshot (`false`) for the entire hydration pass, restarts
 * included, then re-renders with the client snapshot (`true`) straight after
 * commit. A plain client mount skips the `false` render entirely.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );
}
