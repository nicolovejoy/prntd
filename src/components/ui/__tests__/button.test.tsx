import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Button } from "../button";

describe("Button", () => {
  it("renders with default props", () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole("button")).toHaveTextContent("Click me");
  });

  it("renders all variants without crashing", () => {
    const variants = ["primary", "secondary", "danger", "ghost", "generate"] as const;
    for (const variant of variants) {
      const { unmount } = render(
        <Button variant={variant}>{variant}</Button>
      );
      expect(screen.getByRole("button")).toBeInTheDocument();
      unmount();
    }
  });

  it("outlines primary in ink rather than filling it (Paper: not a filled button)", () => {
    render(<Button variant="primary">Order</Button>);
    const button = screen.getByRole("button");
    expect(button).toHaveClass("border", "border-foreground", "text-foreground");
    expect(button.className).not.toMatch(/bg-accent\b/);
  });

  it("fills generate with the rose accent", () => {
    render(<Button variant="generate">Generate</Button>);
    expect(screen.getByRole("button")).toHaveClass("bg-accent-rose");
  });

  it("shows a dotted border and muted text when disabled, not a faded one", () => {
    render(<Button disabled>Disabled</Button>);
    const button = screen.getByRole("button");
    expect(button).toHaveClass("disabled:border-dotted", "disabled:text-text-muted");
    expect(button.className).not.toMatch(/opacity-30/);
  });

  it("renders all sizes", () => {
    const sizes = ["sm", "md", "lg"] as const;
    for (const size of sizes) {
      const { unmount } = render(<Button size={size}>{size}</Button>);
      expect(screen.getByRole("button")).toBeInTheDocument();
      unmount();
    }
  });

  it("passes disabled state", () => {
    render(<Button disabled>Disabled</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("accepts custom className", () => {
    render(<Button className="custom-class">Styled</Button>);
    expect(screen.getByRole("button")).toHaveClass("custom-class");
  });
});
