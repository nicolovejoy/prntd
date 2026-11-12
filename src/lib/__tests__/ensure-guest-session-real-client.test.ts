/**
 * Pins the better-auth client contract ensureGuestSession relies on, with the
 * real `createAuthClient` (src/lib/auth-client.ts) and only fetch stubbed: a
 * 429 on get-session surfaces as `error.status` 429, and the `X-Retry-After`
 * header is visible to fetchOptions.onError. If a library upgrade changes
 * either, this fails before a rate-limited visitor meets it.
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const calls: string[] = [];

beforeEach(() => {
  calls.length = 0;
  vi.resetModules();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof Request
            ? input.url
            : String(input);
      calls.push(url);
      return new Response(
        JSON.stringify({ message: "Too many requests. Please try again later." }),
        {
          status: 429,
          headers: { "Content-Type": "application/json", "X-Retry-After": "6" },
        }
      );
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ensureGuestSession against the real auth client", () => {
  it("rejects a 429 lookup with status, Retry-After and stage, and sends no sign-in", async () => {
    const { ensureGuestSession } = await import("../ensure-guest-session");

    const err = await ensureGuestSession().catch((e: unknown) => e);

    expect(err).toMatchObject({
      name: "GuestSessionError",
      status: 429,
      retryAfterSeconds: 6,
      stage: "lookup",
    });
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((u) => u.includes("get-session"))).toBe(true);
    expect(calls.some((u) => u.includes("sign-in"))).toBe(false);
  });
});
