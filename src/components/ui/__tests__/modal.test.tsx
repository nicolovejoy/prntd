import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Modal } from "../modal";

describe("Modal", () => {
  it("renders nothing when closed", () => {
    render(
      <Modal open={false} onClose={() => {}}>
        <p>Modal content</p>
      </Modal>
    );
    expect(screen.queryByText("Modal content")).not.toBeInTheDocument();
  });

  it("renders children when open", () => {
    render(
      <Modal open={true} onClose={() => {}}>
        <p>Modal content</p>
      </Modal>
    );
    expect(screen.getByText("Modal content")).toBeInTheDocument();
  });

  it("calls onClose when backdrop is clicked", async () => {
    const onClose = vi.fn();
    render(
      <Modal open={true} onClose={onClose}>
        <p>Content</p>
      </Modal>
    );
    // Click the backdrop (outer div)
    const backdrop = screen.getByText("Content").parentElement!.parentElement!;
    backdrop.click();
    expect(onClose).toHaveBeenCalled();
  });

  it("does not call onClose when content is clicked", () => {
    const onClose = vi.fn();
    render(
      <Modal open={true} onClose={onClose}>
        <p>Content</p>
      </Modal>
    );
    screen.getByText("Content").click();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("accepts custom className", () => {
    render(
      <Modal open={true} onClose={() => {}} className="max-w-lg">
        <p>Styled</p>
      </Modal>
    );
    expect(screen.getByText("Styled").parentElement).toHaveClass("max-w-lg");
  });
});
