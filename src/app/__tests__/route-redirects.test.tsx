/**
 * Nav model A retires two top-level routes, and the 2026-09-09 archive-tab
 * drop retires a third. All three keep serving as permanent redirects so
 * bookmarks, shared links and stale `?from=` markers survive. The
 * 2026-09-27 batch flips /designs from a redirect to My Designs' own
 * canonical address, and turns /studio/library and /studio/archive into
 * redirects to it, carrying the query string.
 *
 * The existsSync checks below pin the Shop's route shape: `/shop` is the
 * static community-feed page, and the organizer storefront that sat beside it
 * at `/shop/[slug]` (dynamic) was deleted with composition slice 5 (#201,
 * #191 step 2). Nothing under `/shop` is dynamic any more, so a stray slug
 * route coming back would be a regression, not a neighbour. It checks
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
  it("/prints permanently redirects to /shop", async () => {
    const { default: PrintsPage } = await import("../prints/page");
    expect(() => PrintsPage()).toThrow("NEXT_PERMANENT_REDIRECT:/shop");
    expect(h.permanentRedirect).toHaveBeenCalledWith("/shop");
  });

  it("/studio/library permanently redirects to /designs, carrying the query string", async () => {
    const { default: StudioLibraryPage } = await import(
      "../studio/library/page"
    );
    await expect(
      StudioLibraryPage({
        searchParams: Promise.resolve({ x: "1", tag: ["a", "b"] }),
      })
    ).rejects.toThrow("NEXT_PERMANENT_REDIRECT:/designs?x=1&tag=a&tag=b");
    expect(h.permanentRedirect).toHaveBeenCalledWith("/designs?x=1&tag=a&tag=b");
  });

  it("/studio/archive permanently redirects to /designs, carrying the query string", async () => {
    const { default: StudioArchivePage } = await import(
      "../studio/archive/page"
    );
    await expect(
      StudioArchivePage({ searchParams: Promise.resolve({ x: "1" }) })
    ).rejects.toThrow("NEXT_PERMANENT_REDIRECT:/designs?x=1");
    expect(h.permanentRedirect).toHaveBeenCalledWith("/designs?x=1");
  });
});

describe("/shop is the feed; the organizer /shop/[slug] is gone", () => {
  const app = resolve(__dirname, "..");

  it("has a static page for /shop", () => {
    expect(existsSync(resolve(app, "shop/page.tsx"))).toBe(true);
  });

  it("has no organizer slug route beside it", () => {
    expect(existsSync(resolve(app, "shop/[slug]"))).toBe(false);
  });
});
