import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BACKGROUND_PALETTE } from "@/lib/blanks";
import { BackgroundPicker } from "../background-picker";

/**
 * #140: the publish modal needs the full palette + forced pick; the /d
 * owner backdrop control (published-image-view.tsx) keeps the pre-existing
 * collapsed 5 + "+N more" behavior (#130) unchanged. Both share this
 * component via the `mode` prop — this locks each mode's contract so a
 * future change to one can't silently regress the other.
 */
describe("BackgroundPicker collapsed mode (default, /d page)", () => {
  it("shows only the first 5 swatches plus a +N more button", () => {
    render(
      <BackgroundPicker value="White" onChange={vi.fn()} />
    );
    const swatches = screen
      .getAllByRole("button")
      .filter((b) => b.hasAttribute("title"));
    expect(swatches).toHaveLength(5);
    expect(screen.getByTestId("background-picker-expand")).toHaveTextContent(
      `+${BACKGROUND_PALETTE.length - 5} more`
    );
  });

  it("expanding reveals the full palette and removes the more button", () => {
    render(<BackgroundPicker value="White" onChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId("background-picker-expand"));
    const swatches = screen
      .getAllByRole("button")
      .filter((b) => b.hasAttribute("title"));
    expect(swatches).toHaveLength(BACKGROUND_PALETTE.length);
    expect(
      screen.queryByTestId("background-picker-expand")
    ).not.toBeInTheDocument();
  });

  it("substitutes an out-of-view selection into the collapsed row", () => {
    // Navy is well past the first 5 swatches.
    render(<BackgroundPicker value="Navy" onChange={vi.fn()} />);
    expect(screen.getByTitle("Navy")).toBeInTheDocument();
  });
});

describe("BackgroundPicker full mode (publish modal)", () => {
  it("shows every swatch with no collapse and no +N more button", () => {
    render(
      <BackgroundPicker value={null} onChange={vi.fn()} mode="full" />
    );
    const swatches = screen
      .getAllByRole("button")
      .filter((b) => b.hasAttribute("title"));
    expect(swatches).toHaveLength(BACKGROUND_PALETTE.length);
    expect(
      screen.queryByTestId("background-picker-expand")
    ).not.toBeInTheDocument();
  });

  it("marks no swatch as selected when value is null", () => {
    render(
      <BackgroundPicker value={null} onChange={vi.fn()} mode="full" />
    );
    for (const b of screen
      .getAllByRole("button")
      .filter((btn) => btn.hasAttribute("title"))) {
      expect(b).toHaveAttribute("aria-pressed", "false");
    }
  });

  it("calls onChange with the clicked swatch's color name", () => {
    const onChange = vi.fn();
    render(
      <BackgroundPicker value={null} onChange={onChange} mode="full" />
    );
    fireEvent.click(screen.getByTitle("Kelly"));
    expect(onChange).toHaveBeenCalledWith("Kelly");
  });
});
