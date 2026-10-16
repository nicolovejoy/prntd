import { describe, it, expect } from "vitest";
import {
  GuestSessionError,
  RATE_LIMIT_DEFAULT_WAIT_MS,
  RATE_LIMIT_MAX_WAIT_MS,
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
