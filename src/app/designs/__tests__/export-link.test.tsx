import { describe, it, expect, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { ExportControl, type ExportPartLink } from "../export-link";

afterEach(() => {
  vi.useRealTimers();
});

// jsdom has no real navigation, so an anchor click it doesn't prevent logs
// "Error: Not implemented: navigation". A bubbling document listener runs
// after the component's React handler and records whether it already called
// preventDefault, then calls preventDefault itself so jsdom never attempts
// the navigation.
function trackDefaultPrevented() {
  const seen: boolean[] = [];
  const listener = (e: Event) => {
    seen.push(e.defaultPrevented);
    e.preventDefault();
  };
  document.addEventListener("click", listener);
  return { seen, cleanup: () => document.removeEventListener("click", listener) };
}

const ONE: ExportPartLink[] = [
  {
    part: 1,
    partCount: 1,
    count: 12,
    firstCreatedAt: "2026-01-04T20:00:00.000Z",
    lastCreatedAt: "2026-03-02T20:00:00.000Z",
  },
];

const THREE: ExportPartLink[] = [
  {
    part: 1,
    partCount: 3,
    count: 100,
    // 2026-01-05 03:00 UTC is still Jan 4 in Pacific time.
    firstCreatedAt: "2026-01-05T03:00:00.000Z",
    lastCreatedAt: "2026-03-02T20:00:00.000Z",
  },
  {
    part: 2,
    partCount: 3,
    count: 100,
    firstCreatedAt: "2026-03-03T20:00:00.000Z",
    lastCreatedAt: "2026-06-30T20:00:00.000Z",
  },
  {
    part: 3,
    partCount: 3,
    count: 1,
    firstCreatedAt: "2026-07-01T18:00:00.000Z",
    lastCreatedAt: "2026-07-01T18:00:00.000Z",
  },
];

describe("ExportControl, one part", () => {
  it("is the download link itself, with no button", () => {
    render(<ExportControl parts={ONE} maxImages={100} />);
    const link = screen.getByRole("link", { name: "Download all my designs" });
    expect(link).toHaveAttribute("href", "/designs/export");
    expect(link).toHaveAttribute("download");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("reads as preparing after a click, ignores a second click, and resets after 8 s", () => {
    vi.useFakeTimers();
    const { seen, cleanup } = trackDefaultPrevented();
    render(<ExportControl parts={ONE} maxImages={100} />);
    const link = screen.getByRole("link", { name: "Download all my designs" });
    expect(link).not.toHaveAttribute("aria-disabled");
    expect(screen.getByRole("status")).toHaveTextContent("");

    // First click proceeds (not default-prevented).
    fireEvent.click(link);
    expect(link).toHaveTextContent("Preparing download…");
    expect(link).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Preparing download…");

    // A second click in the window is default-prevented.
    fireEvent.click(link);

    expect(seen).toEqual([false, true]);
    cleanup();

    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(link).toHaveTextContent("Download all my designs");
    expect(link).not.toHaveAttribute("aria-disabled");
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("clears its timer on unmount", () => {
    vi.useFakeTimers();
    const { cleanup } = trackDefaultPrevented();
    const { unmount } = render(<ExportControl parts={ONE} maxImages={100} />);
    fireEvent.click(screen.getByRole("link"));
    cleanup();
    const clear = vi.spyOn(globalThis, "clearTimeout");
    unmount();
    expect(clear).toHaveBeenCalledTimes(1);
    clear.mockRestore();
  });
});

describe("ExportControl, several parts", () => {
  it("is a closed button until tapped, then lists one link per part", () => {
    render(<ExportControl parts={THREE} maxImages={100} />);
    const button = screen.getByRole("button", { name: "Download all my designs" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryAllByRole("link")).toHaveLength(0);

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const panel = document.getElementById(button.getAttribute("aria-controls")!)!;
    expect(panel).toBeVisible();
    expect(panel.className).toContain("absolute");
    expect(panel.className).not.toMatch(/shadow/);
    expect(within(panel).getByText("201 designs in 3 files of up to 100, oldest first.")).toBeInTheDocument();

    const links = within(panel).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/designs/export?part=1",
      "/designs/export?part=2",
      "/designs/export?part=3",
    ]);
    links.forEach((l) => expect(l).toHaveAttribute("download"));
    expect(links[0]).toHaveTextContent("Part 1 of 3 · 100 designs");
    expect(links[0]).toHaveTextContent("Jan 4, 2026 – Mar 2, 2026");
    expect(links[1]).toHaveTextContent("Part 2 of 3 · 100 designs");
    expect(links[1]).toHaveTextContent("Mar 3, 2026 – Jun 30, 2026");
    expect(links[2]).toHaveTextContent("Part 3 of 3 · 1 design");
    // A single-day part shows one date.
    expect(links[2].textContent).toContain("Jul 1, 2026");
    expect(links[2].textContent).not.toContain("–");
  });

  it("closes on a second tap and on Escape", () => {
    render(<ExportControl parts={THREE} maxImages={100} />);
    const button = screen.getByRole("button", { name: "Download all my designs" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryAllByRole("link")).toHaveLength(0);

    fireEvent.click(button);
    const first = screen.getAllByRole("link")[0];
    first.focus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(button).toHaveFocus();
  });

  it("gives each part link its own busy state", () => {
    vi.useFakeTimers();
    render(<ExportControl parts={THREE} maxImages={100} />);
    fireEvent.click(screen.getByRole("button", { name: "Download all my designs" }));
    const { seen, cleanup } = trackDefaultPrevented();
    const [one, two] = screen.getAllByRole("link");

    fireEvent.click(two);
    expect(two).toHaveTextContent("Preparing download…");
    expect(two).toHaveAttribute("aria-disabled", "true");
    expect(one).toHaveTextContent("Part 1 of 3 · 100 designs");
    expect(one).not.toHaveAttribute("aria-disabled");
    const statuses = screen.getAllByRole("status");
    expect(statuses.map((s) => s.textContent)).toEqual(["", "Preparing download…", ""]);

    fireEvent.click(two);
    fireEvent.click(one);
    expect(seen).toEqual([false, true, false]);
    cleanup();

    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(two).toHaveTextContent("Part 2 of 3 · 100 designs");
    expect(two).not.toHaveAttribute("aria-disabled");
    expect(one).not.toHaveAttribute("aria-disabled");
  });
});
