import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { InlineNotice } from "../inline-notice";

describe("InlineNotice", () => {
  it("renders the message on the negative token by default", () => {
    render(<InlineNotice message="Couldn't open this conversation." />);
    const el = screen.getByTestId("inline-notice");
    expect(el).toHaveTextContent("Couldn't open this conversation.");
    expect(el.className).toContain("text-negative");
  });

  it("renders a neutral tone on the muted token", () => {
    render(<InlineNotice tone="neutral" message="Refund issued." />);
    const el = screen.getByTestId("inline-notice");
    expect(el.className).toContain("text-text-muted");
    expect(el.className).not.toContain("text-negative");
  });

  it("renders an optional hint beneath the message", () => {
    render(<InlineNotice message="Recover failed." hint="Order not found" />);
    expect(screen.getByText("Order not found")).toBeInTheDocument();
  });

  it("omits the hint element when no hint is given", () => {
    render(<InlineNotice message="Recover failed." />);
    expect(screen.getByTestId("inline-notice").querySelector("span")).toBeNull();
  });

  it("honors a custom testId", () => {
    render(<InlineNotice message="x" testId="admin-action-result" />);
    expect(screen.getByTestId("admin-action-result")).toBeInTheDocument();
  });
});
