import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SideMockup } from "../side-mockup";
import type { HeroDisplay } from "@/lib/instant-preview";

const ready: HeroDisplay = {
  showError: false,
  artworkUrl: "https://r2/art.png",
  mockupUrl: null,
  mockupVisible: false,
  pendingExact: true,
};

const noop = () => {};

describe("SideMockup", () => {
  it("labels the side in the corner", () => {
    const { rerender } = render(
      <SideMockup
        side="front"
        variant="hero"
        display={ready}
        colorHex="#000000"
        alt="front mockup"
        pendingLabel="Final preview loading…"
        onMockupLoad={noop}
      />
    );
    expect(screen.getByText("Front")).toBeInTheDocument();
    rerender(
      <SideMockup
        side="back"
        variant="tile"
        display={ready}
        colorHex="#000000"
        alt="back mockup"
        pendingLabel="Final preview loading…"
        onMockupLoad={noop}
      />
    );
    expect(screen.getByText("Back")).toBeInTheDocument();
    expect(screen.queryByText("Front")).not.toBeInTheDocument();
  });

  it("hides the side label when showSideLabel is false; shows it by default", () => {
    const { rerender } = render(
      <SideMockup
        side="front"
        variant="hero"
        display={ready}
        colorHex="#000000"
        alt="front mockup"
        pendingLabel="Final preview loading…"
        onMockupLoad={noop}
        showSideLabel={false}
      />
    );
    expect(screen.queryByText("Front")).not.toBeInTheDocument();

    rerender(
      <SideMockup
        side="front"
        variant="hero"
        display={ready}
        colorHex="#000000"
        alt="front mockup"
        pendingLabel="Final preview loading…"
        onMockupLoad={noop}
      />
    );
    expect(screen.getByText("Front")).toBeInTheDocument();
  });

  it("renders the instant artwork on the shirt color", () => {
    render(
      <SideMockup
        side="front"
        variant="hero"
        display={ready}
        colorHex="#212642"
        alt="front mockup"
        pendingLabel="Final preview loading…"
        onMockupLoad={noop}
      />
    );
    const instant = screen.getByTestId("side-mockup-instant");
    expect(instant).toHaveStyle({ backgroundColor: "#212642" });
    const art = instant.querySelector("img");
    expect(art).toHaveAttribute("src", "https://r2/art.png");
    // Default artwork width; /preview overrides it with scale × 62.
    expect(art).toHaveStyle({ width: "62%" });
  });

  it("mounts the mockup hidden, reports its load, then fades it in", () => {
    const onMockupLoad = vi.fn();
    const mounted: HeroDisplay = { ...ready, mockupUrl: "https://r2/mock.png" };
    const { rerender } = render(
      <SideMockup
        side="front"
        variant="hero"
        display={mounted}
        colorHex="#ffffff"
        alt="front mockup"
        pendingLabel="Final preview loading…"
        onMockupLoad={onMockupLoad}
      />
    );
    const img = screen.getByAltText("front mockup");
    expect(img).toHaveAttribute("src", "https://r2/mock.png");
    expect(img).toHaveClass("mix-blend-multiply");
    const layer = screen.getByTestId("side-mockup-exact");
    expect(layer).toHaveClass("opacity-0");
    // Light shirt → the page-ground token under the multiply blend.
    expect(layer).toHaveStyle({ backgroundColor: "var(--background)" });

    fireEvent.load(img);
    expect(onMockupLoad).toHaveBeenCalledWith("https://r2/mock.png");

    rerender(
      <SideMockup
        side="front"
        variant="hero"
        display={{ ...mounted, mockupVisible: true, pendingExact: false }}
        colorHex="#ffffff"
        alt="front mockup"
        pendingLabel="Final preview loading…"
        onMockupLoad={onMockupLoad}
      />
    );
    expect(screen.getByTestId("side-mockup-exact")).toHaveClass("opacity-100");
  });

  it("hero shows the pending label; tile shows only the spinner", () => {
    const { rerender } = render(
      <SideMockup
        side="front"
        variant="hero"
        display={ready}
        colorHex="#000000"
        alt="front mockup"
        pendingLabel="Final preview loading…"
        onMockupLoad={noop}
      />
    );
    expect(screen.getByText("Final preview loading…")).toBeInTheDocument();

    rerender(
      <SideMockup
        side="back"
        variant="tile"
        display={ready}
        colorHex="#000000"
        alt="back mockup"
        pendingLabel="Final preview loading…"
        onMockupLoad={noop}
      />
    );
    expect(screen.queryByText("Final preview loading…")).not.toBeInTheDocument();
    expect(document.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("no pending indicator once the mockup is visible", () => {
    render(
      <SideMockup
        side="front"
        variant="hero"
        display={{
          ...ready,
          mockupUrl: "https://r2/mock.png",
          mockupVisible: true,
          pendingExact: false,
        }}
        colorHex="#000000"
        alt="front mockup"
        pendingLabel="Final preview loading…"
        onMockupLoad={noop}
      />
    );
    expect(screen.queryByText("Final preview loading…")).not.toBeInTheDocument();
    expect(document.querySelector(".animate-spin")).not.toBeInTheDocument();
  });

  it("error overlay shows the message; retry fires onRetry, not onSelect", () => {
    const onRetry = vi.fn();
    const onSelect = vi.fn();
    render(
      <SideMockup
        side="back"
        variant="tile"
        display={{ ...ready, showError: true, pendingExact: false }}
        colorHex="#000000"
        alt="back mockup"
        pendingLabel="Final preview loading…"
        onMockupLoad={noop}
        error={{
          message: "Back preview failed.",
          retryLabel: "Retry",
          onRetry,
        }}
        onSelect={onSelect}
        selectLabel="Show the back large"
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Back preview failed.");
    const retry = screen.getByRole("button", { name: "Retry" });
    // Phone-first: ≥44px tap target.
    expect(retry).toHaveClass("min-h-11", "min-w-11");
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
    // The retry button is not nested inside the select button.
    expect(retry.closest("button")).toBe(retry);
    expect(
      screen.getByRole("button", { name: "Show the back large" }).contains(retry)
    ).toBe(false);
  });

  it("showError without an error prop renders no overlay", () => {
    render(
      <SideMockup
        side="front"
        variant="hero"
        display={{ ...ready, showError: true, pendingExact: false }}
        colorHex="#000000"
        alt="front mockup"
        pendingLabel="Final preview loading…"
        onMockupLoad={noop}
      />
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("tapping the panel calls onSelect", () => {
    const onSelect = vi.fn();
    render(
      <SideMockup
        side="back"
        variant="tile"
        display={ready}
        colorHex="#000000"
        alt="back mockup"
        pendingLabel="Final preview loading…"
        onMockupLoad={noop}
        onSelect={onSelect}
        selectLabel="Show the back large"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Show the back large" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("renders no select button when onSelect is absent", () => {
    render(
      <SideMockup
        side="front"
        variant="hero"
        display={ready}
        colorHex="#000000"
        alt="front mockup"
        pendingLabel="Final preview loading…"
        onMockupLoad={noop}
        testId="hero-front"
      />
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    const root = screen.getByTestId("hero-front");
    expect(root).toHaveAttribute("data-side", "front");
    expect(root).toHaveAttribute("data-variant", "hero");
  });
});
