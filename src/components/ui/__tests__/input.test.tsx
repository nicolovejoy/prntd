import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Input } from "../input";

describe("Input", () => {
  it("renders an input element", () => {
    render(<Input placeholder="Type here" />);
    expect(screen.getByPlaceholderText("Type here")).toBeInTheDocument();
  });

  it("passes disabled state", () => {
    render(<Input disabled placeholder="Disabled" />);
    expect(screen.getByPlaceholderText("Disabled")).toBeDisabled();
  });

  it("accepts custom className", () => {
    render(<Input className="w-full" placeholder="Wide" />);
    expect(screen.getByPlaceholderText("Wide")).toHaveClass("w-full");
  });

  it("accepts type prop", () => {
    render(<Input type="email" placeholder="Email" />);
    expect(screen.getByPlaceholderText("Email")).toHaveAttribute("type", "email");
  });
});
