import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { QuickReply } from "../quick-reply";

describe("QuickReply", () => {
  const options = [
    { label: "Watercolor", value: "Make it watercolor" },
    { label: "Bold vector", value: "Go with a bold vector look" },
  ];

  it("renders nothing when there are no options", () => {
    const { container } = render(
      <QuickReply options={[]} onSelect={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders a chip per option with the label text", () => {
    render(<QuickReply options={options} onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: "Watercolor" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bold vector" })).toBeInTheDocument();
  });

  it("fires onSelect with the value (not the label) on tap", () => {
    const onSelect = vi.fn();
    render(<QuickReply options={options} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "Watercolor" }));
    expect(onSelect).toHaveBeenCalledWith("Make it watercolor");
  });

  it("meets the 44px touch target", () => {
    render(<QuickReply options={options} onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: "Watercolor" })).toHaveClass(
      "min-h-[44px]"
    );
  });

  it("disables chips when disabled", () => {
    const onSelect = vi.fn();
    render(<QuickReply options={options} onSelect={onSelect} disabled />);
    const chip = screen.getByRole("button", { name: "Watercolor" });
    expect(chip).toBeDisabled();
    fireEvent.click(chip);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
