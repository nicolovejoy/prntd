/**
 * Studio sub-nav (nav model A): one strip across the bench, the library and
 * the archive. Asserts label AND destination — a tab pointing at the wrong
 * route must fail, not just a wrong word — plus which tab is marked current
 * for each of the three pathnames.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { StudioTabs } from "../studio-tabs";

const h = vi.hoisted(() => ({ pathname: "/studio" }));
vi.mock("next/navigation", () => ({ usePathname: () => h.pathname }));

function tabs() {
  return screen
    .getAllByRole("link")
    .map((a) => [a.textContent, a.getAttribute("href")]);
}

beforeEach(() => {
  h.pathname = "/studio";
});

describe("StudioTabs", () => {
  it("is exactly Bench, Library, Archive in order", () => {
    render(<StudioTabs />);
    expect(tabs()).toEqual([
      ["Bench", "/studio"],
      ["Library", "/studio/library"],
      ["Archive", "/studio/archive"],
    ]);
  });

  it.each([
    ["/studio", "Bench"],
    ["/studio/library", "Library"],
    ["/studio/archive", "Archive"],
  ])("marks the %s tab current on %s", (pathname, label) => {
    h.pathname = pathname;
    render(<StudioTabs />);
    const current = screen.getByRole("link", { current: "page" });
    expect(current.textContent).toBe(label);
  });

  it("marks no tab current on an unrelated pathname", () => {
    h.pathname = "/orders";
    render(<StudioTabs />);
    expect(screen.queryByRole("link", { current: "page" })).toBeNull();
  });
});
