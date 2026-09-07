import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Badge } from "../badge";

describe("Badge", () => {
  it("renders with default variant", () => {
    render(<Badge>Status</Badge>);
    expect(screen.getByText("Status")).toBeInTheDocument();
  });

  it("renders all variants without crashing", () => {
    const variants = [
      "default",
      "pending",
      "paid",
      "submitted",
      "shipped",
      "delivered",
      "draft",
      "approved",
      "ordered",
    ] as const;
    for (const variant of variants) {
      const { unmount } = render(<Badge variant={variant}>{variant}</Badge>);
      expect(screen.getByText(variant)).toBeInTheDocument();
      unmount();
    }
  });

  it("accepts custom className", () => {
    render(<Badge className="ml-2">Custom</Badge>);
    expect(screen.getByText("Custom")).toHaveClass("ml-2");
  });

  it("is a mono uppercase label, not a pill (Paper: no rounded-full/border/bg)", () => {
    render(<Badge>plain</Badge>);
    const badge = screen.getByText("plain");
    expect(badge).toHaveClass("font-mono", "uppercase");
    expect(badge.className).not.toMatch(/rounded-full|border|bg-/);
  });

  it("colors only shipped/delivered positive and canceled negative", () => {
    const shipped = render(<Badge variant="shipped">shipped</Badge>);
    expect(screen.getByText("shipped")).toHaveClass("text-positive");
    shipped.unmount();

    const canceled = render(<Badge variant="canceled">canceled</Badge>);
    expect(screen.getByText("canceled")).toHaveClass("text-negative");
    canceled.unmount();

    const pending = render(<Badge variant="pending">pending</Badge>);
    expect(screen.getByText("pending")).toHaveClass("text-text-muted");
    pending.unmount();
  });
});
