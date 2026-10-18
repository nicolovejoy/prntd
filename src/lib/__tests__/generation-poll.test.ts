import { describe, it, expect } from "vitest";
import {
  nextPollDelayMs,
  isPollHalted,
  MAX_CONSECUTIVE_POLL_ERRORS,
  isAtGenerationCap,
  GENERATION_CAP,
  STALE_OPTIMISTIC_MS,
  DEFAULT_POLL_SCHEDULE,
} from "../generation-poll";
import { GENERATION_CONCURRENCY_CAP, STALE_JOB_MS } from "../generation-job";

describe("nextPollDelayMs", () => {
  it("polls fast for the first 30 seconds", () => {
    expect(nextPollDelayMs(0)).toBe(2_000);
    expect(nextPollDelayMs(10_000)).toBe(2_000);
    expect(nextPollDelayMs(29_999)).toBe(2_000);
  });

  it("steps to the slow cadence at the window boundary", () => {
    expect(nextPollDelayMs(30_000)).toBe(5_000);
    expect(nextPollDelayMs(60_000)).toBe(5_000);
  });

  it("caps: an arbitrarily long run never backs off past the slow delay", () => {
    expect(nextPollDelayMs(60 * 60 * 1000)).toBe(DEFAULT_POLL_SCHEDULE.slowMs);
  });

  it("honours an injected schedule", () => {
    const schedule = { fastMs: 100, slowMs: 400, fastWindowMs: 1_000 };
    expect(nextPollDelayMs(999, schedule)).toBe(100);
    expect(nextPollDelayMs(1_000, schedule)).toBe(400);
  });
});

describe("isAtGenerationCap", () => {
  it("allows generating while under the cap, however many are running", () => {
    expect(isAtGenerationCap(0, 0)).toBe(false);
    expect(isAtGenerationCap(1, 0)).toBe(false);
    expect(isAtGenerationCap(2, 0)).toBe(false);
  });

  it("refuses at the cap", () => {
    expect(isAtGenerationCap(3, 0)).toBe(true);
    expect(isAtGenerationCap(4, 0)).toBe(true);
  });

  it("counts client-pending starts, which have no job row yet", () => {
    expect(isAtGenerationCap(2, 1)).toBe(true);
    expect(isAtGenerationCap(0, 3)).toBe(true);
  });

  it("matches the server-side cap", () => {
    expect(GENERATION_CAP).toBe(GENERATION_CONCURRENCY_CAP);
  });

  it("ages out an optimistic cell only after the server would have swept it", () => {
    // Dropping a client cell before the server's own stale cutoff would take
    // away a generation that is still legitimately running (#187).
    expect(STALE_OPTIMISTIC_MS).toBeGreaterThan(STALE_JOB_MS);
  });
});

describe("isPollHalted", () => {
  it("is false below the threshold and true at or above it", () => {
    expect(isPollHalted(0)).toBe(false);
    expect(isPollHalted(MAX_CONSECUTIVE_POLL_ERRORS - 1)).toBe(false);
    expect(isPollHalted(MAX_CONSECUTIVE_POLL_ERRORS)).toBe(true);
    expect(isPollHalted(MAX_CONSECUTIVE_POLL_ERRORS + 10)).toBe(true);
  });

  it("honours an injected threshold", () => {
    expect(isPollHalted(2, 3)).toBe(false);
    expect(isPollHalted(3, 3)).toBe(true);
  });
});
