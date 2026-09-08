/**
 * The Shop masthead is a mono label, not a centred display heading, and it no
 * longer carries the sub-line "Designs published by other makers." — the Shop
 * sells shirts, not art (docs/object-model-composition.md).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/app/d/actions", () => ({ getDiscoverFeed: vi.fn(async () => []) }));

const { getDiscoverFeed } = await import("@/app/d/actions");
const { default: ShopPage } = await import("../page");

describe("/shop", () => {
  it("says nothing about makers publishing designs", async () => {
    render(await ShopPage());
    expect(screen.queryByText(/published by other makers/i)).toBeNull();
  });

  it("heads the page with a mono label, not a display heading", async () => {
    render(await ShopPage());
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe("Shop");
    expect(h1.className).toContain("font-mono");
    expect(h1.className).toContain("uppercase");
    expect(h1.className).not.toContain("text-3xl");
    expect(h1.className).not.toContain("text-center");
  });

  it("shows the shared empty state when nothing is published", async () => {
    render(await ShopPage());
    expect(screen.getByTestId("empty-state").textContent).toContain(
      "No published designs yet."
    );
  });

  it("renders the grid when the feed has rows", async () => {
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
    render(await ShopPage());
    expect(screen.getByTestId("published-grid")).toBeTruthy();
    expect(screen.getByText("Whale")).toBeTruthy();
    expect(screen.queryByText(/\$\d/)).toBeNull();
  });
});
