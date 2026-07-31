/**
 * requireRealUser is the auth boundary for the server-rendered /designs and
 * /orders pages. It ports the guard the old client-fetch actions enforced
 * with an Unauthorized throw: no session and anonymous-guest sessions (#26)
 * both leave the page — now via redirect("/sign-in") instead of an error
 * state.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

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

import { requireRealUser } from "@/lib/require-user";

beforeEach(() => {
  h.session = null;
  h.redirect.mockClear();
});

describe("requireRealUser", () => {
  it("redirects signed-out visitors to /sign-in", async () => {
    await expect(requireRealUser()).rejects.toThrow("NEXT_REDIRECT:/sign-in");
    expect(h.redirect).toHaveBeenCalledWith("/sign-in");
  });

  it("redirects anonymous guests to /sign-in", async () => {
    h.session = { user: { id: "guest", isAnonymous: true } };
    await expect(requireRealUser()).rejects.toThrow("NEXT_REDIRECT:/sign-in");
  });

  it("returns the session for a real user", async () => {
    h.session = { user: { id: "u1", isAnonymous: false } };
    await expect(requireRealUser()).resolves.toBe(h.session);
    expect(h.redirect).not.toHaveBeenCalled();
  });
});
