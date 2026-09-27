import { describe, it, expect } from "vitest";
import {
  DESIGN_BRIEF_TIMEOUT_MS,
  LOST_SUBMIT_ERROR_ATTEMPTS,
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
  // Non-"error" statuses never consult errorStreakCount; 0 is the
  // "no streak in progress" value every one of them is given below.
  const noStreak = 0;

  it("running lands", () => {
    expect(
      judgeLostSubmit({
        status: "running",
        calledAtMs: 0,
        deadlineMs,
        hardDeadlineMs,
        errorStreakCount: noStreak,
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
        errorStreakCount: noStreak,
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
        errorStreakCount: noStreak,
      })
    ).toBe("failed");
    expect(
      judgeLostSubmit({
        status: "failed",
        calledAtMs: deadlineMs + 1,
        deadlineMs,
        hardDeadlineMs,
        errorStreakCount: noStreak,
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
        errorStreakCount: noStreak,
      })
    ).toBe("cancelled");
    expect(
      judgeLostSubmit({
        status: "cancelled",
        calledAtMs: deadlineMs + 1,
        deadlineMs,
        hardDeadlineMs,
        errorStreakCount: noStreak,
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
        errorStreakCount: noStreak,
      })
    ).toBe("wait");
    expect(
      judgeLostSubmit({
        status: "none",
        calledAtMs: deadlineMs,
        deadlineMs,
        hardDeadlineMs,
        errorStreakCount: noStreak,
      })
    ).toBe("failed");
    expect(
      judgeLostSubmit({
        status: "none",
        calledAtMs: deadlineMs + 1,
        deadlineMs,
        hardDeadlineMs,
        errorStreakCount: noStreak,
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
        errorStreakCount: noStreak,
      })
    ).not.toBe("failed");
  });

  describe("error (independent review, item 1; third review — counted in attempts, not time)", () => {
    it("waits at and past the ordinary deadline — an error is not proof of absence", () => {
      expect(
        judgeLostSubmit({
          status: "error",
          calledAtMs: deadlineMs - 1,
          deadlineMs,
          hardDeadlineMs,
          errorStreakCount: noStreak,
        })
      ).toBe("wait");
      expect(
        judgeLostSubmit({
          status: "error",
          calledAtMs: deadlineMs,
          deadlineMs,
          hardDeadlineMs,
          errorStreakCount: noStreak,
        })
      ).toBe("wait");
      expect(
        judgeLostSubmit({
          status: "error",
          calledAtMs: deadlineMs + 1,
          deadlineMs,
          hardDeadlineMs,
          errorStreakCount: noStreak,
        })
      ).toBe("wait");
    });

    it("waits before the hard deadline no matter how high the error count already is", () => {
      // calledAtMs alone gates this: a count at or even past the threshold
      // still waits until hardDeadlineMs itself is crossed.
      expect(
        judgeLostSubmit({
          status: "error",
          calledAtMs: hardDeadlineMs - 1,
          deadlineMs,
          hardDeadlineMs,
          errorStreakCount: LOST_SUBMIT_ERROR_ATTEMPTS,
        })
      ).toBe("wait");
    });

    it("third review — past the hard deadline, a count below the threshold waits", () => {
      expect(
        judgeLostSubmit({
          status: "error",
          calledAtMs: hardDeadlineMs,
          deadlineMs,
          hardDeadlineMs,
          errorStreakCount: LOST_SUBMIT_ERROR_ATTEMPTS - 1,
        })
      ).toBe("wait");
    });

    it("third review — past the hard deadline, a count AT the threshold fails", () => {
      expect(
        judgeLostSubmit({
          status: "error",
          calledAtMs: hardDeadlineMs,
          deadlineMs,
          hardDeadlineMs,
          errorStreakCount: LOST_SUBMIT_ERROR_ATTEMPTS,
        })
      ).toBe("failed");
    });

    it("third review — a woken-from-freeze device's first post-wake error (count 1, or even 0 mid-reset) waits, exactly like a fresh streak", () => {
      // This is the woken-from-a-long-freeze case the fix targets:
      // hardDeadlineMs is already behind the device by the time its very
      // first post-wake lookup ever runs, but the count has not yet had a
      // chance to climb — sleep made zero attempts, so it consumed none of
      // the budget.
      expect(
        judgeLostSubmit({
          status: "error",
          calledAtMs: hardDeadlineMs + 1,
          deadlineMs,
          hardDeadlineMs,
          errorStreakCount: 1,
        })
      ).toBe("wait");
      expect(
        judgeLostSubmit({
          status: "error",
          calledAtMs: hardDeadlineMs + 1,
          deadlineMs,
          hardDeadlineMs,
          errorStreakCount: 0,
        })
      ).toBe("wait");
    });

    it("third review — a non-error answer resets the count, so a subsequent error starting from 0 cannot fail even far past the hard deadline", () => {
      // The reset itself happens in the caller's loop (a non-error answer
      // sets its tracked count back to 0); this proves the pure function
      // honors that reset — a fresh count of 0, however far past
      // hardDeadlineMs, is indistinguishable from a brand new streak.
      expect(
        judgeLostSubmit({
          status: "error",
          calledAtMs: hardDeadlineMs + 10 * LOST_SUBMIT_WINDOW_MS,
          deadlineMs,
          hardDeadlineMs,
          errorStreakCount: 0,
        })
      ).toBe("wait");
    });

    it("a non-error status ignores errorStreakCount entirely, even at or above the threshold", () => {
      // "none" is server truth and is judged purely against deadlineMs,
      // regardless of what any in-progress error streak looks like — proof
      // that a real answer's own verdict never depends on the count (which
      // is exactly why the caller is free to reset it to 0 on any such
      // answer).
      expect(
        judgeLostSubmit({
          status: "none",
          calledAtMs: deadlineMs - 1,
          deadlineMs,
          hardDeadlineMs,
          errorStreakCount: LOST_SUBMIT_ERROR_ATTEMPTS,
        })
      ).toBe("wait");
      expect(
        judgeLostSubmit({
          status: "none",
          calledAtMs: deadlineMs,
          deadlineMs,
          hardDeadlineMs,
          errorStreakCount: LOST_SUBMIT_ERROR_ATTEMPTS,
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
