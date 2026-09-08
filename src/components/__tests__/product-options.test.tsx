import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SizePicker, ColorPicker } from "../product-options";

const COLORS = [
  { name: "White", value: "#ffffff" },
  { name: "Black", value: "#000000" },
];

describe("SizePicker", () => {
  it("renders with no size selected when value is null", () => {
    render(<SizePicker sizes={["S", "M", "L"]} value={null} onChange={() => {}} />);
    for (const s of ["S", "M", "L"]) {
      expect(screen.getByRole("button", { name: s })).toHaveAttribute(
        "aria-pressed",
        "false"
      );
    }
  });

  it("marks only the selected size pressed", () => {
    render(<SizePicker sizes={["S", "M", "L"]} value="M" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "M" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: "S" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });

  it("reports picks via onChange", () => {
    const onChange = vi.fn();
    render(<SizePicker sizes={["S", "M"]} value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "M" }));
    expect(onChange).toHaveBeenCalledWith("M");
  });

  it("sets the section label in the Paper mono label type", () => {
    render(<SizePicker sizes={["S", "M"]} value={null} onChange={() => {}} />);
    const label = screen.getByText("Size");
    expect(label.className).toContain("font-mono");
    expect(label.className).toContain("text-[11px]");
    expect(label.className).toContain("tracking-[0.08em]");
    expect(label.className).toContain("uppercase");
    expect(label.className).toContain("text-text-muted");
    expect(label.className).not.toContain("text-sm");
    expect(label.className).not.toContain("font-medium");
  });

  it("keeps a caller-supplied label as given, letting CSS do the casing", () => {
    render(
      <SizePicker sizes={["S"]} value={null} onChange={() => {}} label="Size (US)" />
    );
    expect(screen.getByText("Size (US)").className).toContain("uppercase");
  });
});

describe("ColorPicker", () => {
  it("shows the note when provided", () => {
    render(
      <ColorPicker
        colors={COLORS}
        value="Black"
        onChange={() => {}}
        note="Shown in Black — designer's pick"
      />
    );
    expect(
      screen.getByText("Shown in Black — designer's pick")
    ).toBeInTheDocument();
  });

  it("renders no note by default", () => {
    render(<ColorPicker colors={COLORS} value="White" onChange={() => {}} />);
    expect(screen.queryByText(/designer's pick/)).not.toBeInTheDocument();
  });

  it("sets the section label in the Paper mono label type and keeps the value suffix", () => {
    render(<ColorPicker colors={COLORS} value="White" onChange={() => {}} />);
    const label = screen.getByText("Color — White");
    expect(label.className).toContain("font-mono");
    expect(label.className).toContain("text-[11px]");
    expect(label.className).toContain("tracking-[0.08em]");
    expect(label.className).toContain("uppercase");
    expect(label.className).toContain("text-text-muted");
    expect(label.className).not.toContain("font-medium");
  });
});
