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

  it("running lands", () => {
    expect(
      judgeLostSubmit({ status: "running", calledAtMs: 0, deadlineMs })
    ).toBe("landed");
  });

  it("succeeded lands", () => {
    expect(
      judgeLostSubmit({ status: "succeeded", calledAtMs: 0, deadlineMs })
    ).toBe("landed");
  });

  it("failed fails, before or after the deadline", () => {
    expect(
      judgeLostSubmit({ status: "failed", calledAtMs: 0, deadlineMs })
    ).toBe("failed");
    expect(
      judgeLostSubmit({ status: "failed", calledAtMs: deadlineMs + 1, deadlineMs })
    ).toBe("failed");
  });

  it("cancelled cancels, before or after the deadline", () => {
    expect(
      judgeLostSubmit({ status: "cancelled", calledAtMs: 0, deadlineMs })
    ).toBe("cancelled");
    expect(
      judgeLostSubmit({ status: "cancelled", calledAtMs: deadlineMs + 1, deadlineMs })
    ).toBe("cancelled");
  });

  it("none waits before the deadline, fails at or after it", () => {
    expect(
      judgeLostSubmit({ status: "none", calledAtMs: deadlineMs - 1, deadlineMs })
    ).toBe("wait");
    expect(
      judgeLostSubmit({ status: "none", calledAtMs: deadlineMs, deadlineMs })
    ).toBe("failed");
    expect(
      judgeLostSubmit({ status: "none", calledAtMs: deadlineMs + 1, deadlineMs })
    ).toBe("failed");
  });

  it("error is treated exactly like none", () => {
    expect(
      judgeLostSubmit({ status: "error", calledAtMs: deadlineMs - 1, deadlineMs })
    ).toBe("wait");
    expect(
      judgeLostSubmit({ status: "error", calledAtMs: deadlineMs, deadlineMs })
    ).toBe("failed");
  });

  it("a call made before the deadline can never fail, however late it is answered", () => {
    // calledAtMs is when the lookup went OUT, not when this judgement runs.
    expect(
      judgeLostSubmit({ status: "none", calledAtMs: deadlineMs - 1, deadlineMs })
    ).not.toBe("failed");
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
