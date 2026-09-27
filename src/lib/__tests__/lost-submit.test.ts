import { describe, it, expect } from "vitest";
import {
  DESIGN_BRIEF_TIMEOUT_MS,
  LOST_SUBMIT_WINDOW_MS,
  isServerActionError,
  judgeLostSubmit,
} from "@/lib/lost-submit";

describe("timing constants", () => {
  it("gives the reconcile window margin over the brief bound", () => {
    expect(LOST_SUBMIT_WINDOW_MS).toBeGreaterThan(DESIGN_BRIEF_TIMEOUT_MS);
  });
});

describe("judgeLostSubmit", () => {
  const deadlineMs = 100_000;
  // Comfortably past deadlineMs, same relationship as
  // LOST_SUBMIT_WINDOW_MS < STALE_OPTIMISTIC_MS in the real constants.
  const hardDeadlineMs = 400_000;
  // Non-"error" statuses never consult errorStreakStartMs; null is the
  // "no streak in progress" value every one of them is given below.
  const noStreak = null;

  it("running lands", () => {
    expect(
      judgeLostSubmit({
        status: "running",
        calledAtMs: 0,
        deadlineMs,
        hardDeadlineMs,
        errorStreakStartMs: noStreak,
      })
    ).toBe("landed");
  });

  it("succeeded lands", () => {
    expect(
      judgeLostSubmit({
        status: "succeeded",
        calledAtMs: 0,
        deadlineMs,
        hardDeadlineMs,
        errorStreakStartMs: noStreak,
      })
    ).toBe("landed");
  });

  it("failed fails, before or after the deadline", () => {
    expect(
      judgeLostSubmit({
        status: "failed",
        calledAtMs: 0,
        deadlineMs,
        hardDeadlineMs,
        errorStreakStartMs: noStreak,
      })
    ).toBe("failed");
    expect(
      judgeLostSubmit({
        status: "failed",
        calledAtMs: deadlineMs + 1,
        deadlineMs,
        hardDeadlineMs,
        errorStreakStartMs: noStreak,
      })
    ).toBe("failed");
  });

  it("cancelled cancels, before or after the deadline", () => {
    expect(
      judgeLostSubmit({
        status: "cancelled",
        calledAtMs: 0,
        deadlineMs,
        hardDeadlineMs,
        errorStreakStartMs: noStreak,
      })
    ).toBe("cancelled");
    expect(
      judgeLostSubmit({
        status: "cancelled",
        calledAtMs: deadlineMs + 1,
        deadlineMs,
        hardDeadlineMs,
        errorStreakStartMs: noStreak,
      })
    ).toBe("cancelled");
  });

  it("none waits before the deadline, fails at or after it", () => {
    expect(
      judgeLostSubmit({
        status: "none",
        calledAtMs: deadlineMs - 1,
        deadlineMs,
        hardDeadlineMs,
        errorStreakStartMs: noStreak,
      })
    ).toBe("wait");
    expect(
      judgeLostSubmit({
        status: "none",
        calledAtMs: deadlineMs,
        deadlineMs,
        hardDeadlineMs,
        errorStreakStartMs: noStreak,
      })
    ).toBe("failed");
    expect(
      judgeLostSubmit({
        status: "none",
        calledAtMs: deadlineMs + 1,
        deadlineMs,
        hardDeadlineMs,
        errorStreakStartMs: noStreak,
      })
    ).toBe("failed");
  });

  it("a call made before the deadline can never fail on 'none', however late it is answered", () => {
    // calledAtMs is when the lookup went OUT, not when this judgement runs.
    expect(
      judgeLostSubmit({
        status: "none",
        calledAtMs: deadlineMs - 1,
        deadlineMs,
        hardDeadlineMs,
        errorStreakStartMs: noStreak,
      })
    ).not.toBe("failed");
  });

  describe("error (independent review, item 1)", () => {
    it("waits at and past the ordinary deadline — an error is not proof of absence", () => {
      expect(
        judgeLostSubmit({
          status: "error",
          calledAtMs: deadlineMs - 1,
          deadlineMs,
          hardDeadlineMs,
          errorStreakStartMs: noStreak,
        })
      ).toBe("wait");
      expect(
        judgeLostSubmit({
          status: "error",
          calledAtMs: deadlineMs,
          deadlineMs,
          hardDeadlineMs,
          errorStreakStartMs: noStreak,
        })
      ).toBe("wait");
      expect(
        judgeLostSubmit({
          status: "error",
          calledAtMs: deadlineMs + 1,
          deadlineMs,
          hardDeadlineMs,
          errorStreakStartMs: noStreak,
        })
      ).toBe("wait");
    });

    it("waits at and past the hard backstop while the error streak is still short, however long the streak's own start is unknown", () => {
      // Before this fix: a lone error at/after hardDeadlineMs failed outright.
      // Now: no known streak (null) can never fail — there is nothing to
      // measure duration against.
      expect(
        judgeLostSubmit({
          status: "error",
          calledAtMs: hardDeadlineMs,
          deadlineMs,
          hardDeadlineMs,
          errorStreakStartMs: noStreak,
        })
      ).toBe("wait");
      expect(
        judgeLostSubmit({
          status: "error",
          calledAtMs: hardDeadlineMs + 1,
          deadlineMs,
          hardDeadlineMs,
          errorStreakStartMs: noStreak,
        })
      ).toBe("wait");
    });

    it("second independent review, item 1 — past the hard deadline, a streak that JUST started waits", () => {
      // The streak began at this very call: duration is 0, far short of
      // LOST_SUBMIT_WINDOW_MS. This is exactly the woken-from-a-long-freeze
      // case: hardDeadlineMs is already behind the device, but its first
      // post-wake error gets the same grace a fresh submit would.
      expect(
        judgeLostSubmit({
          status: "error",
          calledAtMs: hardDeadlineMs + 1,
          deadlineMs,
          hardDeadlineMs,
          errorStreakStartMs: hardDeadlineMs + 1,
        })
      ).toBe("wait");
    });

    it("second independent review, item 1 — past the hard deadline, a streak lasting the full window fails", () => {
      const streakStart = hardDeadlineMs + 1;
      expect(
        judgeLostSubmit({
          status: "error",
          calledAtMs: streakStart + LOST_SUBMIT_WINDOW_MS - 1,
          deadlineMs,
          hardDeadlineMs,
          errorStreakStartMs: streakStart,
        })
      ).toBe("wait");
      expect(
        judgeLostSubmit({
          status: "error",
          calledAtMs: streakStart + LOST_SUBMIT_WINDOW_MS,
          deadlineMs,
          hardDeadlineMs,
          errorStreakStartMs: streakStart,
        })
      ).toBe("failed");
    });

    it("a streak that started before the hard deadline but has already run the full window fails as soon as the hard deadline itself is crossed", () => {
      const streakStart = hardDeadlineMs - LOST_SUBMIT_WINDOW_MS;
      expect(
        judgeLostSubmit({
          status: "error",
          calledAtMs: hardDeadlineMs - 1,
          deadlineMs,
          hardDeadlineMs,
          errorStreakStartMs: streakStart,
        })
      ).toBe("wait"); // still short of hardDeadlineMs itself
      expect(
        judgeLostSubmit({
          status: "error",
          calledAtMs: hardDeadlineMs,
          deadlineMs,
          hardDeadlineMs,
          errorStreakStartMs: streakStart,
        })
      ).toBe("failed");
    });
  });
});

describe("isServerActionError", () => {
  it("true for an error with a string digest", () => {
    const err = Object.assign(new Error("boom"), { digest: "abc123" });
    expect(isServerActionError(err)).toBe(true);
  });

  it("false for a plain TypeError (fetch failure)", () => {
    expect(isServerActionError(new TypeError("Failed to fetch"))).toBe(false);
  });

  it("false for a plain Error with no digest", () => {
    expect(isServerActionError(new Error("boom"))).toBe(false);
  });

  it("false for a numeric digest", () => {
    const err = Object.assign(new Error("boom"), { digest: 123 });
    expect(isServerActionError(err)).toBe(false);
  });

  it("false for an undefined digest", () => {
    const err = Object.assign(new Error("boom"), { digest: undefined });
    expect(isServerActionError(err)).toBe(false);
  });

  it("false for null", () => {
    expect(isServerActionError(null)).toBe(false);
  });

  it("false for a string", () => {
    expect(isServerActionError("boom")).toBe(false);
  });
});
