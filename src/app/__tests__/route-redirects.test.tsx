/**
 * Nav model A retires two top-level routes. Both keep serving as permanent
 * redirects so bookmarks, shared links and stale `?from=` markers survive.
 *
 * The third test is the one worth having: `/shop` (static) now sits beside
 * the mothballed organizer `/shop/[slug]` (dynamic). A dynamic segment
 * requires a non-empty path segment, so `/shop` can only match the static
 * page — this asserts the two files both exist, which is what would break
 * if someone "helpfully" folded the feed into the slug route. It checks
 * existence only (`existsSync`), not that `shop/page.tsx` exports a real
 * page component — importing it pulls in `getDiscoverFeed` and its DB
 * dependency, which this file deliberately doesn't mock.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const h = vi.hoisted(() => ({
  permanentRedirect: vi.fn((url: string): never => {
    // next/navigation's permanentRedirect throws; mirror that.
    throw new Error(`NEXT_PERMANENT_REDIRECT:${url}`);
  }),
}));

vi.mock("next/navigation", () => ({
  get permanentRedirect() {
    return h.permanentRedirect;
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("retired routes", () => {
  it("/designs permanently redirects to /studio/library", async () => {
    const { default: DesignsPage } = await import("../designs/page");
    expect(() => DesignsPage()).toThrow("NEXT_PERMANENT_REDIRECT:/studio/library");
    expect(h.permanentRedirect).toHaveBeenCalledWith("/studio/library");
  });

  it("/prints permanently redirects to /shop", async () => {
    const { default: PrintsPage } = await import("../prints/page");
    expect(() => PrintsPage()).toThrow("NEXT_PERMANENT_REDIRECT:/shop");
    expect(h.permanentRedirect).toHaveBeenCalledWith("/shop");
  });
});

describe("/shop does not collide with the organizer /shop/[slug]", () => {
  const app = resolve(__dirname, "..");

  it("has a static page for /shop", () => {
    expect(existsSync(resolve(app, "shop/page.tsx"))).toBe(true);
  });

  it("leaves the organizer slug route in place", () => {
    expect(existsSync(resolve(app, "shop/[slug]/page.tsx"))).toBe(true);
  });
});
