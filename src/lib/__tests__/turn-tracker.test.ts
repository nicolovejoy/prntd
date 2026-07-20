import { describe, it, expect } from "vitest";
import { createTurnTracker } from "../turn-tracker";

describe("createTurnTracker", () => {
  it("issues increasing tokens", () => {
    const t = createTurnTracker();
    const a = t.start();
    const b = t.start();
    expect(b).toBeGreaterThan(a);
  });

  it("only the latest turn is current", () => {
    const t = createTurnTracker();
    const a = t.start();
    expect(t.isCurrent(a)).toBe(true);
    const b = t.start();
    expect(t.isCurrent(a)).toBe(false);
    expect(t.isCurrent(b)).toBe(true);
  });

  it("a cancelled turn is never current, even while latest", () => {
    const t = createTurnTracker();
    const a = t.start();
    t.cancel(a);
    expect(t.isCancelled(a)).toBe(true);
    expect(t.isCurrent(a)).toBe(false);
  });

  it("cancelling an old turn does not affect a newer one", () => {
    const t = createTurnTracker();
    const a = t.start();
    const b = t.start();
    t.cancel(a);
    expect(t.isCancelled(a)).toBe(true);
    expect(t.isCancelled(b)).toBe(false);
    expect(t.isCurrent(b)).toBe(true);
  });

  it("a completion after cancel-then-new-turn is both cancelled and stale", () => {
    // The #59 scenario: user cancels a generation, keeps chatting, then the
    // abandoned server action settles — it must see itself as non-current.
    const t = createTurnTracker();
    const gen = t.start();
    t.cancel(gen);
    const chat = t.start();
    expect(t.isCurrent(gen)).toBe(false);
    expect(t.isCancelled(gen)).toBe(true);
    expect(t.isCurrent(chat)).toBe(true);
  });
});
