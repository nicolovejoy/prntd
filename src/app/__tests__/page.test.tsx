/**
 * Home redirect (nav-remap, 2026-09-01): a signed-in, non-anonymous visitor
 * to `/` is sent to `/studio` before the feed/promo fetches run. Anonymous
 * guest-funnel sessions keep the MakerHero landing — redirecting them would
 * just bounce off requireRealUser into /sign-in. `Home` is called directly
 * (not rendered) so this stays a decision test, not a MakerHero/PublishedGrid
 * render test.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  session: null as { user: { id: string; isAnonymous?: boolean } } | null,
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
vi.mock("@/app/d/actions", () => ({
  getDiscoverFeed: vi.fn(async () => []),
}));
vi.mock("@/lib/promotion", () => ({
  getActivePromo: vi.fn(async () => null),
}));

import Home from "../page";

beforeEach(() => {
  h.session = null;
  h.redirect.mockClear();
});

describe("Home", () => {
  it("redirects a signed-in real user to /studio", async () => {
    h.session = { user: { id: "u1", isAnonymous: false } };
    await expect(Home()).rejects.toThrow("NEXT_REDIRECT:/studio");
    expect(h.redirect).toHaveBeenCalledWith("/studio");
  });

  it("renders the hero for an anonymous guest, without redirecting", async () => {
    h.session = { user: { id: "guest", isAnonymous: true } };
    await expect(Home()).resolves.toBeTruthy();
    expect(h.redirect).not.toHaveBeenCalled();
  });

  it("renders the hero for a signed-out visitor, without redirecting", async () => {
    h.session = null;
    await expect(Home()).resolves.toBeTruthy();
    expect(h.redirect).not.toHaveBeenCalled();
  });
});
