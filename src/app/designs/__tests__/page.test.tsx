/**
 * My Designs' own page (nav model A, 2026-09-27): masthead copy and the
 * empty-state's route back to the Studio bench. The gate and guest line are
 * covered in src/app/studio/__tests__/guest-keep-line.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/require-user", () => ({
  requireStudioUser: vi.fn(async () => ({
    session: { user: { id: "u1", isAnonymous: false } },
    isGuest: false,
  })),
}));
vi.mock("@/lib/user-designs", () => ({
  getUserImageLibrary: vi.fn(async () => []),
}));
vi.mock("../library-grid", () => ({
  LibraryGrid: () => <div data-testid="library-grid-stub" />,
}));

const { default: DesignsPage } = await import("../page");
const { getUserImageLibrary } = await import("@/lib/user-designs");

beforeEach(() => {
  vi.mocked(getUserImageLibrary).mockReset();
  vi.mocked(getUserImageLibrary).mockResolvedValue([]);
});

describe("/designs", () => {
  it("shows the My Designs masthead", async () => {
    render(await DesignsPage());
    expect(screen.getByRole("heading", { name: "My Designs" })).toBeInTheDocument();
  });

  it("empty state links back to the Studio", async () => {
    render(await DesignsPage());
    expect(screen.getByText("No designs yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Studio" })).toHaveAttribute(
      "href",
      "/studio"
    );
  });

  it("offers the zip download when there are images", async () => {
    vi.mocked(getUserImageLibrary).mockResolvedValue([
      { imageId: "i1" },
    ] as never);
    render(await DesignsPage());
    const link = screen.getByRole("link", { name: "Download all my designs" });
    expect(link).toHaveAttribute("href", "/designs/export");
    expect(link).toHaveAttribute("download");
  });

  it("has no download link in the empty state", async () => {
    render(await DesignsPage());
    expect(
      screen.queryByRole("link", { name: "Download all my designs" })
    ).not.toBeInTheDocument();
  });
});
