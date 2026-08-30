import { describe, it, expect } from "vitest";
import {
  nextPollDelayMs,
  shouldPoll,
  isAtGenerationCap,
  reduceJobPoll,
  classifyGenerationFailure,
  GENERATION_FAILURE_COPY,
  GENERATION_CAP,
  DEFAULT_POLL_SCHEDULE,
  type JobPollResult,
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

const succeeded = (jobId: string, imageId: string) => ({
  jobId,
  status: "succeeded" as const,
  imageId,
  failure: null,
});
const failed = (jobId: string, failure: "timeout" | "failed" = "failed") => ({
  jobId,
  status: "failed" as const,
  imageId: null,
  failure,
});
const result = (over: Partial<JobPollResult> = {}): JobPollResult => ({
  running: [],
  settled: [],
  ...over,
});

describe("reduceJobPoll", () => {
  it("adopts the server's running list", () => {
    const step = reduceJobPoll({
      trackedJobIds: ["j1"],
      result: result({ running: [{ jobId: "j1", generationNumber: 1 }] }),
      chatTurnInFlight: false,
    });
    expect(step.running).toEqual([{ jobId: "j1", generationNumber: 1 }]);
    expect(step.settling).toEqual([]);
    expect(step.refreshThread).toBe(false);
  });

  it("asks for a whole-thread refresh when a generation succeeds", () => {
    // The assistant turn is written by the background continuation, so a
    // gallery-only refresh would leave the chat one turn short.
    const step = reduceJobPoll({
      trackedJobIds: ["j1"],
      result: result({ settled: [succeeded("j1", "img-1")] }),
      chatTurnInFlight: false,
    });
    expect(step.refreshThread).toBe(true);
    expect(step.settling).toEqual(["j1"]);
    expect(step.errorCopy).toBeNull();
  });

  it("surfaces authored copy for a failure, never a raw string", () => {
    const step = reduceJobPoll({
      trackedJobIds: ["j1"],
      result: result({ settled: [failed("j1")] }),
      chatTurnInFlight: false,
    });
    expect(step.errorCopy).toBe(GENERATION_FAILURE_COPY.failed);
    expect(step.refreshThread).toBe(false);
    expect(step.settling).toEqual(["j1"]);
  });

  it("distinguishes a timeout from a generic failure", () => {
    const step = reduceJobPoll({
      trackedJobIds: ["j1"],
      result: result({ settled: [failed("j1", "timeout")] }),
      chatTurnInFlight: false,
    });
    expect(step.errorCopy).toBe(GENERATION_FAILURE_COPY.timeout);
    expect(step.errorCopy).not.toBe(GENERATION_FAILURE_COPY.failed);
  });

  it("defers the whole settle while a chat turn is in flight", () => {
    // sendChatMessage persists both its rows only when it returns, so a
    // whole-thread read taken now would render the user's own words back out.
    const step = reduceJobPoll({
      trackedJobIds: ["j1"],
      result: result({ settled: [succeeded("j1", "img-1")] }),
      chatTurnInFlight: true,
    });
    expect(step.settling).toEqual([]);
    expect(step.refreshThread).toBe(false);
    expect(step.errorCopy).toBeNull();
    // Still adopts running, so the spinner rows stay honest meanwhile.
    expect(step.running).toEqual([]);
  });

  it("deferral is a delay, not a drop: the same response settles once clear", () => {
    const response = result({ settled: [succeeded("j1", "img-1")] });
    const deferred = reduceJobPoll({
      trackedJobIds: ["j1"],
      result: response,
      chatTurnInFlight: true,
    });
    // Nothing untracked while deferred, so the id is still there next tick —
    // this is what makes the deferral incapable of losing a settle.
    expect(deferred.settling).toEqual([]);

    const applied = reduceJobPoll({
      trackedJobIds: ["j1"],
      result: response,
      chatTurnInFlight: false,
    });
    expect(applied.settling).toEqual(["j1"]);
    expect(applied.refreshThread).toBe(true);
  });

  it("ignores a settled job this page is no longer tracking", () => {
    // e.g. one the user cancelled — untracked locally, so its outcome is not
    // this page's to react to.
    const step = reduceJobPoll({
      trackedJobIds: [],
      result: result({ settled: [succeeded("j9", "img-9"), failed("j8")] }),
      chatTurnInFlight: false,
    });
    expect(step.settling).toEqual([]);
    expect(step.refreshThread).toBe(false);
    expect(step.errorCopy).toBeNull();
  });

  it("reports both when a batch settles one success and one failure", () => {
    const step = reduceJobPoll({
      trackedJobIds: ["j1", "j2"],
      result: result({ settled: [succeeded("j1", "img-1"), failed("j2")] }),
      chatTurnInFlight: false,
    });
    expect(step.settling).toEqual(["j1", "j2"]);
    expect(step.refreshThread).toBe(true);
    expect(step.errorCopy).toBe(GENERATION_FAILURE_COPY.failed);
  });
});

describe("classifyGenerationFailure", () => {
  it("recognises the sweeper's timeout string", () => {
    expect(classifyGenerationFailure("Generation timed out")).toBe("timeout");
  });

  it("classifies anything else as a generic failure", () => {
    expect(classifyGenerationFailure(null)).toBe("failed");
    expect(classifyGenerationFailure("Ideogram 422: prompt rejected")).toBe("failed");
  });

  it("the authored copy never echoes provider text", () => {
    // The whole point of classifying server-side: the raw string can carry
    // prompt content or vendor moderation wording, and these pages are
    // guest-reachable.
    for (const copy of Object.values(GENERATION_FAILURE_COPY)) {
      expect(copy).not.toMatch(/Ideogram|422|prompt/i);
    }
  });
});
