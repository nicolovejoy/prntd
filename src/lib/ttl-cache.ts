/**
 * Small in-memory TTL cache with in-flight dedupe. Pure and framework-free so
 * the expiry/dedupe logic is unit-testable with an injected clock; callers hold
 * a module-level instance.
 *
 * `warm` is the write path: it runs the loader at most once per key while a
 * fresh value or an in-flight load already exists, so repeated warm requests
 * (e.g. a card re-entering the viewport, then hovered, then touched) collapse
 * to a single load. A rejected load is not cached — the next warm retries.
 */
export interface TtlCache<V> {
  /** Fresh value for the key, or undefined if absent or expired. */
  get(key: string): V | undefined;
  set(key: string, value: V): void;
  /** True when a fresh (non-expired) value exists. */
  has(key: string): boolean;
  delete(key: string): void;
  /**
   * Ensure a value for the key. Returns the fresh cached value, the existing
   * in-flight load, or a new load from `loader` (stored on success).
   */
  warm(key: string, loader: () => Promise<V>): Promise<V>;
}

export function createTtlCache<V>(opts: {
  ttlMs: number;
  now?: () => number;
}): TtlCache<V> {
  const { ttlMs } = opts;
  const now = opts.now ?? Date.now;
  const values = new Map<string, { value: V; expiresAt: number }>();
  const inFlight = new Map<string, Promise<V>>();

  function get(key: string): V | undefined {
    const entry = values.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now()) {
      values.delete(key);
      return undefined;
    }
    return entry.value;
  }

  function set(key: string, value: V): void {
    values.set(key, { value, expiresAt: now() + ttlMs });
  }

  return {
    get,
    set,
    has(key) {
      return get(key) !== undefined;
    },
    delete(key) {
      values.delete(key);
      inFlight.delete(key);
    },
    warm(key, loader) {
      const fresh = get(key);
      if (fresh !== undefined) return Promise.resolve(fresh);
      const pending = inFlight.get(key);
      if (pending) return pending;
      const load = loader()
        .then((value) => {
          set(key, value);
          return value;
        })
        .finally(() => {
          inFlight.delete(key);
        });
      inFlight.set(key, load);
      return load;
    },
  };
}
