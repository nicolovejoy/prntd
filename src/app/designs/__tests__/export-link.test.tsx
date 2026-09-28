import { describe, it, expect, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ExportLink } from "../export-link";

afterEach(() => {
  vi.useRealTimers();
});

describe("ExportLink", () => {
  it("reads as preparing after a click, ignores a second click, and resets after 8 s", () => {
    vi.useFakeTimers();
    render(<ExportLink />);
    const link = screen.getByRole("link", { name: "Download all my designs" });
    expect(link).not.toHaveAttribute("aria-disabled");

    // First click proceeds (not default-prevented).
    expect(fireEvent.click(link)).toBe(true);
    expect(link).toHaveTextContent("Preparing download…");
    expect(link).toHaveAttribute("aria-disabled", "true");

    // A second click in the window is default-prevented.
    expect(fireEvent.click(link)).toBe(false);

    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(link).toHaveTextContent("Download all my designs");
    expect(link).not.toHaveAttribute("aria-disabled");
  });

  it("clears its timer on unmount", () => {
    vi.useFakeTimers();
    const { unmount } = render(<ExportLink />);
    fireEvent.click(screen.getByRole("link"));
    const clear = vi.spyOn(globalThis, "clearTimeout");
    unmount();
    expect(clear).toHaveBeenCalledTimes(1);
    clear.mockRestore();
  });
});
