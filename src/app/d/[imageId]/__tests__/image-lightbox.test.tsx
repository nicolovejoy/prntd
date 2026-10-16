import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { ImageLightbox, type LightboxImage } from "../image-lightbox";

// `number` values deliberately differ from index + 1 so the "#N of M" label
// can only pass by reading the field, not the position.
const images: LightboxImage[] = [
  { id: "img-a", number: 3, url: "https://img.example/a.png" },
  { id: "img-b", number: 7, url: "https://img.example/b.png" },
  { id: "img-c", number: 12, url: "https://img.example/c.png" },
];

type Props = ComponentProps<typeof ImageLightbox>;

function renderLightbox(overrides: Partial<Props> = {}) {
  const props = {
    images,
    currentIndex: 1,
    onClose: vi.fn(),
    onNavigate: vi.fn(),
    ...overrides,
  };
  const { unmount } = render(<ImageLightbox {...props} />);
  return { ...props, unmount };
}

const prev = () => screen.getByRole("button", { name: "Previous image" });
const next = () => screen.getByRole("button", { name: "Next image" });

describe("ImageLightbox position + navigation", () => {
  it("renders #N of M from the image's number, not its index", () => {
    renderLightbox({ currentIndex: 1 });
    expect(screen.getByText("#7 of 3")).toBeInTheDocument();
  });

  it("Prev/Next buttons navigate by one", () => {
    const { onNavigate } = renderLightbox({ currentIndex: 1 });
    fireEvent.click(prev());
    expect(onNavigate).toHaveBeenLastCalledWith(0);
    fireEvent.click(next());
    expect(onNavigate).toHaveBeenLastCalledWith(2);
  });

  it("Prev is disabled at the first image, Next at the last", () => {
    const first = renderLightbox({ currentIndex: 0 });
    expect(prev()).toBeDisabled();
    expect(next()).toBeEnabled();
    fireEvent.click(prev());
    expect(first.onNavigate).not.toHaveBeenCalled();
    // Re-render at the far end.
    first.unmount();
    const last = renderLightbox({ currentIndex: 2 });
    expect(next()).toBeDisabled();
    expect(prev()).toBeEnabled();
    fireEvent.click(next());
    expect(last.onNavigate).not.toHaveBeenCalled();
  });

  it("ArrowLeft / ArrowRight on window navigate", () => {
    const { onNavigate } = renderLightbox({ currentIndex: 1 });
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(onNavigate).toHaveBeenLastCalledWith(0);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(onNavigate).toHaveBeenLastCalledWith(2);
  });

  it("arrow keys do nothing past either end", () => {
    const first = renderLightbox({ currentIndex: 0 });
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(first.onNavigate).not.toHaveBeenCalled();
    first.unmount();
    const last = renderLightbox({ currentIndex: 2 });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(last.onNavigate).not.toHaveBeenCalled();
  });

  it("the overlay is a modal dialog with 44px controls", () => {
    renderLightbox();
    const overlay = screen.getByTestId("image-lightbox");
    expect(overlay).toHaveAttribute("role", "dialog");
    expect(overlay).toHaveAttribute("aria-modal", "true");
    for (const btn of [
      prev(),
      next(),
      screen.getByRole("button", { name: "Close" }),
    ]) {
      expect(btn.className).toContain("min-w-11");
      expect(btn.className).toContain("min-h-11");
    }
  });
});

describe("ImageLightbox closing", () => {
  it("Escape on window closes and marks the event handled", () => {
    const { onClose } = renderLightbox();
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      cancelable: true,
      bubbles: true,
    });
    // dispatchEvent returns false when a listener called preventDefault —
    // that is what lets Breadcrumbs' Escape-to-go-up skip the keystroke.
    const notCancelled = window.dispatchEvent(event);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(notCancelled).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  });

  it("Escape from inside the page is stopped before bubble-phase window listeners", () => {
    const { onClose } = renderLightbox();
    // The lightbox listens on window in the CAPTURE phase and stops
    // propagation, so a keystroke that starts deeper in the tree never
    // reaches a bubble-phase window listener (Breadcrumbs' Escape-to-go-up).
    const bubbleListener = vi.fn();
    window.addEventListener("keydown", bubbleListener);
    try {
      const event = new KeyboardEvent("keydown", {
        key: "Escape",
        cancelable: true,
        bubbles: true,
      });
      document.body.dispatchEvent(event);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
      expect(bubbleListener).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", bubbleListener);
    }
  });

  it("the Close button closes", () => {
    const { onClose } = renderLightbox();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("backdrop click closes; a click inside the content does not", () => {
    const { onClose } = renderLightbox();
    fireEvent.click(screen.getByText("#7 of 3"));
    fireEvent.click(screen.getByRole("img", { name: "Design #7" }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("image-lightbox"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("focuses the Close button on mount", () => {
    renderLightbox();
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
  });

  it("restores focus to whatever opened it on unmount (#236 follow-up)", () => {
    const opener = document.createElement("button");
    opener.textContent = "Opener cell";
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const { unmount } = renderLightbox();
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();

    // Restoring focus is a passive-effect cleanup, which React 18 flushes
    // asynchronously unless the unmount itself is wrapped in act().
    act(() => {
      unmount();
    });
    expect(document.activeElement).toBe(opener);

    opener.remove();
  });

  it("does not throw if the opener is gone from the document by the time it closes", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();

    const { unmount } = renderLightbox();
    opener.remove(); // e.g. the lane it belonged to was deleted while open
    expect(() => unmount()).not.toThrow();
  });
});

describe("ImageLightbox single view", () => {
  it("renders exactly one img for the current image", () => {
    renderLightbox();
    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(screen.getByRole("img")).toHaveAttribute(
      "alt",
      "Design #7"
    );
  });

  it("has no side-by-side toggle", () => {
    renderLightbox();
    expect(screen.queryByText("Side by side")).toBeNull();
    expect(screen.queryByText("Single view")).toBeNull();
  });
});

describe("ImageLightbox actions row", () => {
  it("renders no actions row when no actions are given", () => {
    renderLightbox();
    expect(screen.queryByTestId("lightbox-actions")).toBeNull();
  });

  it("renders the caller's actions in the row", () => {
    renderLightbox({ actions: <button>Use this one</button> });
    const row = screen.getByTestId("lightbox-actions");
    expect(within(row).getByRole("button", { name: "Use this one" })).toBeInTheDocument();
  });

  it("renders no row for empty actions (false or null)", () => {
    const first = renderLightbox({ actions: false });
    expect(screen.queryByTestId("lightbox-actions")).toBeNull();
    first.unmount();
    renderLightbox({ actions: null });
    expect(screen.queryByTestId("lightbox-actions")).toBeNull();
  });

  it("has no built-in Order, Publish, Delete or New design buttons: those belonged to the /design thread", () => {
    renderLightbox({ actions: <button>Use this one</button> });
    for (const name of ["Order", "Publish", "Delete", "Remove", "New design from this"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(screen.queryByTestId("guest-publish-prompt")).toBeNull();
    expect(screen.queryByText(/Published/)).toBeNull();
  });
});
