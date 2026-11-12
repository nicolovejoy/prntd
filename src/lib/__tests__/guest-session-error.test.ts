import { describe, it, expect } from "vitest";
import { GUEST_SESSION_RATE_LIMITED } from "@/lib/action-copy";
import {
  GuestSessionError,
  RATE_LIMIT_DEFAULT_WAIT_MS,
  RATE_LIMIT_MAX_WAIT_MS,
  guestSessionFailureMessage,
  isLookupRateLimited,
  parseRetryAfterSeconds,
  rateLimitRetryDelayMs,
} from "@/lib/guest-session-error";

describe("parseRetryAfterSeconds", () => {
  it("reads whole and fractional seconds, rounding up", () => {
    expect(parseRetryAfterSeconds("8")).toBe(8);
    expect(parseRetryAfterSeconds("7.2")).toBe(8);
  });
  it("is null for a missing, zero, negative or non-numeric value", () => {
    expect(parseRetryAfterSeconds(null)).toBeNull();
    expect(parseRetryAfterSeconds(undefined)).toBeNull();
    expect(parseRetryAfterSeconds("")).toBeNull();
    expect(parseRetryAfterSeconds("0")).toBeNull();
    expect(parseRetryAfterSeconds("-3")).toBeNull();
    expect(parseRetryAfterSeconds("soon")).toBeNull();
  });
});

describe("GuestSessionError", () => {
  it("carries the status and the Retry-After", () => {
    const err = new GuestSessionError("Too many requests", 429, 7);
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(429);
    expect(err.retryAfterSeconds).toBe(7);
    expect(new GuestSessionError("x", 500).retryAfterSeconds).toBeNull();
  });
});

describe("rateLimitRetryDelayMs", () => {
  it("is the limiter's window for a 429 that names no Retry-After", () => {
    expect(rateLimitRetryDelayMs(new GuestSessionError("x", 429))).toBe(
      RATE_LIMIT_DEFAULT_WAIT_MS
    );
    expect(RATE_LIMIT_DEFAULT_WAIT_MS).toBe(10_000);
  });
  it("uses a stated Retry-After, plus a little slack", () => {
    expect(rateLimitRetryDelayMs(new GuestSessionError("x", 429, 4))).toBe(4_500);
  });
  it("never waits more than 15 s", () => {
    expect(rateLimitRetryDelayMs(new GuestSessionError("x", 429, 60))).toBe(
      RATE_LIMIT_MAX_WAIT_MS
    );
    expect(RATE_LIMIT_MAX_WAIT_MS).toBe(15_000);
  });
  it("is null for any other status or a non-error", () => {
    expect(rateLimitRetryDelayMs(new GuestSessionError("x", 500))).toBeNull();
    expect(rateLimitRetryDelayMs(new GuestSessionError("x", null))).toBeNull();
    expect(rateLimitRetryDelayMs(new Error("network down"))).toBeNull();
    expect(rateLimitRetryDelayMs(null)).toBeNull();
    expect(rateLimitRetryDelayMs("429")).toBeNull();
  });
  it("reads a plain object with a status, so a mocked mint still gets the rule", () => {
    expect(rateLimitRetryDelayMs({ status: 429, retryAfterSeconds: 3 })).toBe(3_500);
  });
});

describe("guestSessionFailureMessage", () => {
  const fallback = "Couldn't do it.";

  it("is the rate-limited line for a 429, whatever carries the status", () => {
    expect(guestSessionFailureMessage(new GuestSessionError("x", 429, 7), fallback)).toBe(
      GUEST_SESSION_RATE_LIMITED
    );
    expect(guestSessionFailureMessage({ status: 429 }, fallback)).toBe(GUEST_SESSION_RATE_LIMITED);
  });

  it("is the rate-limited line when the lookup was limited earlier in the attempt, whatever failed after", () => {
    expect(guestSessionFailureMessage(new Error("digest"), fallback, true)).toBe(
      GUEST_SESSION_RATE_LIMITED
    );
    expect(guestSessionFailureMessage(new Error("digest"), fallback, false)).toBe(fallback);
  });

  it("is the caller's fallback for any other failure", () => {
    expect(guestSessionFailureMessage(new GuestSessionError("x", 500), fallback)).toBe(fallback);
    expect(guestSessionFailureMessage(new GuestSessionError("x", null), fallback)).toBe(fallback);
    expect(guestSessionFailureMessage(new Error("network"), fallback)).toBe(fallback);
    expect(guestSessionFailureMessage({ status: "429" }, fallback)).toBe(fallback);
    expect(guestSessionFailureMessage(null, fallback)).toBe(fallback);
    expect(guestSessionFailureMessage(undefined, fallback)).toBe(fallback);
  });
});

describe("isLookupRateLimited", () => {
  it("is true only for a 429 at the lookup stage", () => {
    expect(isLookupRateLimited(new GuestSessionError("x", 429, null, "lookup"))).toBe(true);
    expect(isLookupRateLimited(new GuestSessionError("x", 429, null, "mint"))).toBe(false);
    expect(isLookupRateLimited(new GuestSessionError("x", 429))).toBe(false);
    expect(isLookupRateLimited(new GuestSessionError("x", 500, null, "lookup"))).toBe(false);
    expect(isLookupRateLimited(new Error("network"))).toBe(false);
    expect(isLookupRateLimited(null)).toBe(false);
  });
});

describe("GuestSessionError stage", () => {
  it("defaults to mint", () => {
    expect(new GuestSessionError("x", 429).stage).toBe("mint");
    expect(new GuestSessionError("x", 429, 3, "lookup").stage).toBe("lookup");
  });
});

describe("GUEST_SESSION_RATE_LIMITED", () => {
  it("is Nico's wording, exactly (2026-11-11)", () => {
    expect(GUEST_SESSION_RATE_LIMITED).toBe("patience makes the hearth grow fondue");
  });
});
