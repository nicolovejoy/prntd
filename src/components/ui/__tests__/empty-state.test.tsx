import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { EmptyState } from "../empty-state";

describe("EmptyState", () => {
  it("renders the message", () => {
    render(<EmptyState message="No designs yet." />);
    expect(screen.getByText("No designs yet.")).toBeInTheDocument();
  });

  it("renders no label by default", () => {
    const { container } = render(<EmptyState message="No designs yet." />);
    expect(container.querySelector(".font-mono")).not.toBeInTheDocument();
  });

  it("renders an optional mono label above the message", () => {
    render(<EmptyState label="Studio" message="No open designs." />);
    const label = screen.getByText("Studio");
    expect(label).toHaveClass("font-mono", "uppercase");
  });

  it("renders an optional action", () => {
    render(<EmptyState message="No orders yet." action={<button>Make your first design</button>} />);
    expect(screen.getByRole("button", { name: "Make your first design" })).toBeInTheDocument();
  });

  it("renders no action when none is passed", () => {
    render(<EmptyState message="Nothing archived." />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("exposes a default test id, overridable per call site", () => {
    const { unmount } = render(<EmptyState message="No designs yet." />);
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    unmount();

    render(<EmptyState message="Couldn't load your cart." testId="cart-load-error" />);
    expect(screen.getByTestId("cart-load-error")).toBeInTheDocument();
  });

  it("accepts a custom className alongside the base layout classes", () => {
    render(<EmptyState message="No designs yet." className="custom" />);
    expect(screen.getByTestId("empty-state")).toHaveClass("custom", "text-center", "py-16");
  });
});
