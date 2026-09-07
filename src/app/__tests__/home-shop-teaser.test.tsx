/**
 * The homepage Shop teaser (Paper slice 6, #188): a mono masthead row +
 * underlined "See all" link, matching /shop's own masthead.
 *
 * This lives in its own file, separate from page.test.tsx, on purpose.
 * page.test.tsx calls `Home()` without rendering it — its docblock says
 * that's deliberate, pinning "no session read, no redirect" as a decision
 * test. Rendering `Home()` pulls in `MakerHero`, a client component that
 * calls `useRouter()` from next/navigation; page.test.tsx's mock of
 * next/navigation only supplies `redirect`, so a real render there throws
 * with no app-router context mounted. Widening that mock would turn a
 * decision test into a render test, which is not this task's call to make.
 * So: stub MakerHero here instead, and leave page.test.tsx untouched.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/maker-hero", () => ({
  MakerHero: () => <div data-testid="maker-hero-stub" />,
}));
vi.mock("@/app/d/actions", () => ({ getDiscoverFeed: vi.fn(async () => []) }));
vi.mock("@/lib/promotion", () => ({
  getActivePromo: vi.fn(async () => null),
}));

const { getDiscoverFeed } = await import("@/app/d/actions");
const { default: Home } = await import("../page");

describe("Home Shop teaser", () => {
  it("heads the Shop teaser with the same mono label and an underlined See all", async () => {
    vi.mocked(getDiscoverFeed).mockResolvedValueOnce([
      {
        imageId: "i1",
        imageUrl: "https://example.com/a.png",
        title: "Whale",
        description: null,
        backgroundColor: null,
        blankId: null,
        designerName: "Nico",
        designerId: "u1",
        isOwn: false,
        publishedAt: new Date(),
        forkChain: [],
      },
    ]);
    render(await Home());
    const h2 = screen.getByRole("heading", { level: 2, name: "Shop" });
    expect(h2.className).toContain("font-mono");
    expect(h2.className).not.toContain("text-2xl");
    const seeAll = screen.getByRole("link", { name: /See all/ });
    expect(seeAll.getAttribute("href")).toBe("/shop");
    expect(seeAll.className).toContain("underline");
  });
});
