/**
 * Latest-wins guard for async UI flows (#71).
 *
 * /preview fires async resolutions (placement render, Printful mockup) for
 * whatever product/color/placement is selected. A tap mid-flight must always
 * register: the new selection supersedes the old one, and the stale
 * resolution — whenever it lands — must not write its result over the newer
 * selection's state.
 *
 * Monotonic token: `begin()` marks a new request as the latest; `invalidate()`
 * supersedes everything in flight without starting one (a selection tap);
 * `isCurrent(token)` is the apply-gate a resolution checks before touching
 * state. Field-comparison guards (the old three-ref approach) miss
 * A→B→A sequences — the stale A resolution compares equal to the re-selected
 * A and applies early; a token can't be re-equal.
 */
export type LatestWins = {
  /** Start a new request. Returns its token; all earlier tokens go stale. */
  begin: () => number;
  /** Supersede all in-flight requests without starting a new one. */
  invalidate: () => void;
  /** Whether `token` still identifies the latest request. */
  isCurrent: (token: number) => boolean;
};

export function createLatestWins(): LatestWins {
  let current = 0;
  return {
    begin: () => ++current,
    invalidate: () => {
      current++;
    },
    isCurrent: (token: number) => token === current,
  };
}
