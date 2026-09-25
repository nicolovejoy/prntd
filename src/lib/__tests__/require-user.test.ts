/**
 * The page and action gates in src/lib/require-user.ts.
 *
 * requireRealUser is the boundary for /orders: no session and anonymous-guest
 * sessions (#26) both leave the page via redirect("/sign-in").
 *
 * The Studio gates (#241) admit an anonymous guest too, but only while
 * GUEST_FUNNEL_ENABLED is on — with the flag off, Studio is real-account-only
 * exactly as before. The page gate and the action gate share one predicate,
 * canUseStudio, and these tests pin both against it across the flag.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  session: null as unknown,
  redirect: vi.fn((url: string): never => {
    // next/navigation redirect throws; mirror that so control flow matches.
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => h.session } },
  isAnonymousUser: (u: { isAnonymous?: boolean } | undefined) =>
    Boolean(u?.isAnonymous),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  get redirect() {
    return h.redirect;
  },
}));

import {
  canUseStudio,
  requireRealUser,
  requireStudioActionSession,
  requireStudioUser,
} from "@/lib/require-user";

const GUEST = { user: { id: "guest", isAnonymous: true } };
const REAL = { user: { id: "u1", isAnonymous: false } };

let savedFlag: string | undefined;

beforeEach(() => {
  h.session = null;
  h.redirect.mockClear();
  savedFlag = process.env.GUEST_FUNNEL_ENABLED;
  delete process.env.GUEST_FUNNEL_ENABLED;
});

afterEach(() => {
  if (savedFlag === undefined) delete process.env.GUEST_FUNNEL_ENABLED;
  else process.env.GUEST_FUNNEL_ENABLED = savedFlag;
});

describe("requireRealUser", () => {
  it("redirects signed-out visitors to /sign-in", async () => {
    await expect(requireRealUser()).rejects.toThrow("NEXT_REDIRECT:/sign-in");
    expect(h.redirect).toHaveBeenCalledWith("/sign-in");
  });

  it("redirects anonymous guests to /sign-in, even with the guest funnel on", async () => {
    process.env.GUEST_FUNNEL_ENABLED = "true";
    h.session = GUEST;
    await expect(requireRealUser()).rejects.toThrow("NEXT_REDIRECT:/sign-in");
  });

  it("returns the session for a real user", async () => {
    h.session = REAL;
    await expect(requireRealUser()).resolves.toBe(h.session);
    expect(h.redirect).not.toHaveBeenCalled();
  });
});

describe("canUseStudio", () => {
  it("refuses no user, whatever the flag", () => {
    expect(canUseStudio(null, true)).toBe(false);
    expect(canUseStudio(undefined, false)).toBe(false);
  });

  it("admits a real user, whatever the flag", () => {
    expect(canUseStudio({ isAnonymous: false }, false)).toBe(true);
    expect(canUseStudio({ isAnonymous: false }, true)).toBe(true);
    expect(canUseStudio({ isAnonymous: null }, false)).toBe(true);
    expect(canUseStudio({}, false)).toBe(true);
  });

  it("admits an anonymous guest only while the guest funnel is on", () => {
    expect(canUseStudio({ isAnonymous: true }, true)).toBe(true);
    expect(canUseStudio({ isAnonymous: true }, false)).toBe(false);
  });
});

describe("requireStudioUser (page gate)", () => {
  it("redirects signed-out visitors to /sign-in", async () => {
    process.env.GUEST_FUNNEL_ENABLED = "true";
    await expect(requireStudioUser()).rejects.toThrow("NEXT_REDIRECT:/sign-in");
  });

  it("admits a guest with the guest funnel on, flagged as a guest", async () => {
    process.env.GUEST_FUNNEL_ENABLED = "true";
    h.session = GUEST;
    await expect(requireStudioUser()).resolves.toEqual({
      session: GUEST,
      isGuest: true,
    });
    expect(h.redirect).not.toHaveBeenCalled();
  });

  it("redirects a guest to /sign-in with the guest funnel off", async () => {
    process.env.GUEST_FUNNEL_ENABLED = "false";
    h.session = GUEST;
    await expect(requireStudioUser()).rejects.toThrow("NEXT_REDIRECT:/sign-in");
  });

  it("admits a real user with the flag off, not flagged as a guest", async () => {
    h.session = REAL;
    await expect(requireStudioUser()).resolves.toEqual({
      session: REAL,
      isGuest: false,
    });
  });
});

describe("requireStudioActionSession (action gate)", () => {
  it("throws Unauthorized for a signed-out caller, without redirecting", async () => {
    process.env.GUEST_FUNNEL_ENABLED = "true";
    await expect(requireStudioActionSession()).rejects.toThrow("Unauthorized");
    expect(h.redirect).not.toHaveBeenCalled();
  });

  it("returns the session for a guest with the guest funnel on", async () => {
    process.env.GUEST_FUNNEL_ENABLED = "true";
    h.session = GUEST;
    await expect(requireStudioActionSession()).resolves.toBe(GUEST);
  });

  it("throws Unauthorized for a guest with the guest funnel off", async () => {
    h.session = GUEST;
    await expect(requireStudioActionSession()).rejects.toThrow("Unauthorized");
  });

  it("returns the session for a real user", async () => {
    h.session = REAL;
    await expect(requireStudioActionSession()).resolves.toBe(REAL);
  });
});
