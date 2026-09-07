/**
 * Home is one page for every visitor (#75, reaffirmed 2026-09-07): it reads
 * no session and never redirects. A nav-remap on 2026-09-01 sent signed-in
 * users to /studio from here; the owner reversed that, so this test pins the
 * absence — a reintroduced session read or redirect fails here. `Home` is
 * called directly (not rendered) so this stays a decision test, not a
 * MakerHero/PublishedGrid render test.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  getSession: vi.fn(async () => ({ user: { id: "u1", isAnonymous: false } })),
  redirect: vi.fn((url: string): never => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: h.getSession } },
  isAnonymousUser: () => false,
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
import { getDiscoverFeed } from "@/app/d/actions";

beforeEach(() => {
  h.getSession.mockClear();
  h.redirect.mockClear();
  vi.mocked(getDiscoverFeed).mockClear();
});

describe("Home", () => {
  it("renders the landing for a signed-in user without reading the session or redirecting", async () => {
    await expect(Home()).resolves.toBeTruthy();
    expect(h.redirect).not.toHaveBeenCalled();
    expect(h.getSession).not.toHaveBeenCalled();
    expect(getDiscoverFeed).toHaveBeenCalledTimes(1);
  });
});
