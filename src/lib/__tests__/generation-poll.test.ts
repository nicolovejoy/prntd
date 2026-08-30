import { describe, it, expect } from "vitest";
import {
  nextPollDelayMs,
  shouldPoll,
  isAtGenerationCap,
  GENERATION_CAP,
  DEFAULT_POLL_SCHEDULE,
} from "../generation-poll";
import { GENERATION_CONCURRENCY_CAP } from "../generation-job";

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

describe("shouldPoll", () => {
  it("stops entirely when nothing runs and nothing is tracked", () => {
    expect(shouldPoll(0, 0)).toBe(false);
  });

  it("runs while a job is running", () => {
    expect(shouldPoll(1, 0)).toBe(true);
  });

  it("keeps running for a tracked job that already left the running list", () => {
    // This is the poll that reports the settled outcome — the assistant turn
    // and the image would never arrive without it.
    expect(shouldPoll(0, 1)).toBe(true);
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
});
