import { describe, it, expect, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ExportLink } from "../export-link";

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

describe("ExportLink", () => {
  it("reads as preparing after a click, ignores a second click, and resets after 8 s", () => {
    vi.useFakeTimers();
    const { seen, cleanup } = trackDefaultPrevented();
    render(<ExportLink />);
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
    const { unmount } = render(<ExportLink />);
    fireEvent.click(screen.getByRole("link"));
    cleanup();
    const clear = vi.spyOn(globalThis, "clearTimeout");
    unmount();
    expect(clear).toHaveBeenCalledTimes(1);
    clear.mockRestore();
  });
});
