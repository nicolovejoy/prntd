import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Card } from "../card";

describe("Card", () => {
  it("renders children", () => {
    render(<Card>Card content</Card>);
    expect(screen.getByText("Card content")).toBeInTheDocument();
  });

  it("applies border and bg classes", () => {
    render(<Card data-testid="card">Content</Card>);
    const card = screen.getByTestId("card");
    expect(card).toHaveClass("border", "rounded-lg");
  });

  it("accepts custom className", () => {
    render(<Card className="p-6" data-testid="card">Content</Card>);
    expect(screen.getByTestId("card")).toHaveClass("p-6");
  });
});
