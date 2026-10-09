/**
 * My Designs' own page (nav model A, 2026-09-27): masthead copy and the
 * empty-state's route back to the Studio bench. The gate and guest line are
 * covered in src/app/studio/__tests__/guest-keep-line.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

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
      { imageId: "i1", createdAt: new Date("2026-09-20T12:00:00Z") },
    ] as never);
    render(await DesignsPage());
    const link = screen.getByRole("link", { name: "Download all my designs" });
    expect(link).toHaveAttribute("href", "/designs/export");
    expect(link).toHaveAttribute("download");
    expect(screen.queryByRole("button", { name: "Download all my designs" })).toBeNull();
  });

  it("offers parts, oldest first, from the library it already loaded", async () => {
    // getUserImageLibrary is newest first: image 75 (newest) down to 1.
    const day = (n: number) => new Date(Date.UTC(2026, 0, 1, 20) + n * 86_400_000);
    vi.mocked(getUserImageLibrary).mockResolvedValue(
      Array.from({ length: 75 }, (_, i) => ({
        imageId: `i${75 - i}`,
        createdAt: day(74 - i),
      })) as never
    );
    render(await DesignsPage());
    expect(getUserImageLibrary).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Download all my designs" }));
    expect(
      screen.getByText("75 designs in 2 files of up to 50, oldest first.")
    ).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: /^Part / });
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/designs/export?part=1",
      "/designs/export?part=2",
    ]);
    // Part 1 is the oldest 50: Jan 1 – Feb 19, 2026 (Pacific).
    expect(links[0]).toHaveTextContent("Part 1 of 2 · 50 designs");
    expect(links[0]).toHaveTextContent("Jan 1, 2026 – Feb 19, 2026");
    expect(links[1]).toHaveTextContent("Part 2 of 2 · 25 designs");
    expect(links[1]).toHaveTextContent("Feb 20, 2026 – Mar 16, 2026");
  });

  it("keeps the masthead row as tall as the heading (16 px), like /orders", async () => {
    vi.mocked(getUserImageLibrary).mockResolvedValue([
      { imageId: "i1", createdAt: new Date("2026-09-20T12:00:00Z") },
    ] as never);
    render(await DesignsPage());
    const heading = screen.getByRole("heading", { name: "My Designs" });
    expect(heading.className).toBe(
      "font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted"
    );
    // The 44 px control (min-h-11) cancels 2 × 14 px with -my-3.5: 44 − 28 = 16.
    const link = screen.getByRole("link", { name: "Download all my designs" });
    expect(link.className).toContain("min-h-11");
    const wrapper = link.closest(".-my-3\\.5");
    expect(wrapper).not.toBeNull();
    expect(wrapper!.parentElement).toBe(heading.parentElement);
  });

  it("leaves hidden images out of the export parts and their count (#288)", async () => {
    const day = (n: number) => new Date(Date.UTC(2026, 0, 1, 20) + n * 86_400_000);
    // Newest first: 52 visible images plus 3 hidden ones mixed in.
    vi.mocked(getUserImageLibrary).mockResolvedValue(
      Array.from({ length: 55 }, (_, i) => ({
        imageId: `i${55 - i}`,
        createdAt: day(54 - i),
        isHidden: (55 - i) % 14 === 0,
      })) as never
    );
    render(await DesignsPage());
    fireEvent.click(screen.getByRole("button", { name: "Download all my designs" }));
    expect(
      screen.getByText("52 designs in 2 files of up to 50, oldest first.")
    ).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: /^Part / });
    expect(links[0]).toHaveTextContent("Part 1 of 2 · 50 designs");
    expect(links[1]).toHaveTextContent("Part 2 of 2 · 2 designs");
  });

  it("has no download link when every image is hidden (#288)", async () => {
    vi.mocked(getUserImageLibrary).mockResolvedValue([
      { imageId: "i1", createdAt: new Date("2026-09-20T12:00:00Z"), isHidden: true },
    ] as never);
    render(await DesignsPage());
    expect(
      screen.queryByRole("link", { name: "Download all my designs" })
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("library-grid-stub")).toBeInTheDocument();
  });

  it("has no download link in the empty state", async () => {
    render(await DesignsPage());
    expect(
      screen.queryByRole("link", { name: "Download all my designs" })
    ).not.toBeInTheDocument();
  });
});
