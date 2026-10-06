import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { CheckoutLine } from "../checkout-line";

const base = {
  productName: "Classic Tee",
  color: "Black",
  size: "M",
  quantity: 1,
  frontImageUrl: "https://img.example/front.png",
  backImageUrl: null,
  colorHex: "#0c0c0c",
  mockupUrl: null,
};

describe("CheckoutLine lightbox (#285)", () => {
  it("opens the cached mockup when there is one", () => {
    render(<CheckoutLine line={{ ...base, mockupUrl: "https://img.example/m.jpg" }} />);
    fireEvent.click(screen.getByRole("button", { name: "View larger" }));
    const face = screen.getByTestId("checkout-viewer-face");
    expect(face).toHaveAttribute("data-side", "front");
    expect(within(face).getByRole("img")).toHaveAttribute("src", "https://img.example/m.jpg");
    expect(within(face).getByRole("img")).toHaveAttribute("alt", "Classic Tee in Black");
  });

  it("opens the artwork on the shirt colour when no mockup is cached", () => {
    render(<CheckoutLine line={base} />);
    fireEvent.click(screen.getByRole("button", { name: "View larger" }));
    const face = screen.getByTestId("checkout-viewer-face");
    expect(within(face).getByRole("img")).toHaveAttribute("src", base.frontImageUrl);
    expect(face).toHaveStyle({ backgroundColor: "#0c0c0c" });
  });

  it("has nothing to open when there is no mockup and no artwork", () => {
    render(<CheckoutLine line={{ ...base, frontImageUrl: null }} />);
    expect(screen.queryByRole("button", { name: "View larger" })).toBeNull();
    expect(screen.getByTestId("checkout-preview")).toBeInTheDocument();
  });

  it("the back thumbnail opens on the back; the switch moves to the front", () => {
    render(<CheckoutLine line={{ ...base, backImageUrl: "https://img.example/back.png" }} />);
    fireEvent.click(screen.getByRole("button", { name: "View back design larger" }));
    expect(screen.getByTestId("checkout-viewer-face")).toHaveAttribute("data-side", "back");
    fireEvent.click(screen.getByTestId("fullscreen-viewer-option-front"));
    expect(screen.getByTestId("checkout-viewer-face")).toHaveAttribute("data-side", "front");
  });

  it("a line with a back but no front opens on the back and offers no switch", () => {
    render(
      <CheckoutLine
        line={{ ...base, frontImageUrl: null, backImageUrl: "https://img.example/back.png" }}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "View back design larger" }));
    expect(screen.getByTestId("checkout-viewer-face")).toHaveAttribute("data-side", "back");
    expect(screen.queryByTestId("fullscreen-viewer-option-front")).toBeNull();
  });

  it("keeps the text and testids the page relied on", () => {
    render(<CheckoutLine line={{ ...base, quantity: 2 }} />);
    expect(screen.getByText("Classic Tee ×2")).toBeInTheDocument();
    expect(screen.getByText("Black / M")).toBeInTheDocument();
    expect(screen.getByTestId("checkout-preview").className).toContain("md:aspect-square");
  });

  it("Escape closes it", () => {
    render(<CheckoutLine line={base} />);
    fireEvent.click(screen.getByRole("button", { name: "View larger" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
