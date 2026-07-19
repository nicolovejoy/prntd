import { describe, it, expect } from "vitest";
import { createLatestWins } from "../latest-wins";

describe("createLatestWins", () => {
  it("a fresh request is current", () => {
    const g = createLatestWins();
    const t = g.begin();
    expect(g.isCurrent(t)).toBe(true);
  });

  it("a later begin supersedes an in-flight request", () => {
    const g = createLatestWins();
    const stale = g.begin();
    const fresh = g.begin();
    expect(g.isCurrent(stale)).toBe(false);
    expect(g.isCurrent(fresh)).toBe(true);
  });

  it("invalidate supersedes without starting a request", () => {
    const g = createLatestWins();
    const t = g.begin();
    g.invalidate();
    expect(g.isCurrent(t)).toBe(false);
  });

  it("A→B→A: the original A request stays stale after re-selecting A", () => {
    // The field-comparison approach this replaces passed here: the stale
    // request's fields matched the re-selected ones, so it applied early.
    const g = createLatestWins();
    const requestA1 = g.begin(); // fetch for color A
    g.invalidate(); // tap color B
    const requestB = g.begin(); // fetch for color B
    g.invalidate(); // tap color A again
    const requestA2 = g.begin(); // new fetch for color A
    expect(g.isCurrent(requestA1)).toBe(false);
    expect(g.isCurrent(requestB)).toBe(false);
    expect(g.isCurrent(requestA2)).toBe(true);
  });

  it("independent guards don't interfere", () => {
    const a = createLatestWins();
    const b = createLatestWins();
    const ta = a.begin();
    b.begin();
    b.invalidate();
    expect(a.isCurrent(ta)).toBe(true);
  });
});
