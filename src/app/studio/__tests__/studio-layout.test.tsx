import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import StudioLayout from "../layout";

describe("StudioLayout", () => {
  it("titles the Studio with the mono masthead (#188 slice 8)", () => {
    render(
      <StudioLayout>
        <p>bench</p>
      </StudioLayout>,
    );

    const h1 = screen.getByRole("heading", { level: 1, name: "Studio" });
    expect(h1).toHaveClass(
      "font-mono",
      "text-[11px]",
      "uppercase",
      "text-text-muted",
    );
    expect(h1).not.toHaveClass("font-bold");
    // Hidden on the focused stage, whose back row carries the same label.
    expect(h1).toHaveClass("group-has-[[data-studio-stage]]/studio:sr-only");
    expect(screen.getByText("bench")).toBeInTheDocument();
  });
});
