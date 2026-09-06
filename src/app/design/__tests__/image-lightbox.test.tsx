import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { ImageLightbox, type LightboxImage } from "../image-lightbox";

// `number` values deliberately differ from index + 1 so the "#N of M" label
// can only pass by reading the field, not the position.
const images: LightboxImage[] = [
  { id: "img-a", number: 3, url: "https://img.example/a.png", publishedAt: null },
  { id: "img-b", number: 7, url: "https://img.example/b.png", publishedAt: null },
  { id: "img-c", number: 12, url: "https://img.example/c.png", publishedAt: null },
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

/** The full callback set the /design thread passes. */
function fullCallbacks() {
  return {
    onDelete: vi.fn(),
    onMakeProducts: vi.fn(),
    onPublish: vi.fn(async () => {}),
    onStartFrom: vi.fn(async () => {}),
  };
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
    fireEvent.click(screen.getByRole("img", { name: "Design #7 on dark" }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("image-lightbox"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("ImageLightbox actions row", () => {
  it("renders no actions row when nothing is given", () => {
    renderLightbox();
    expect(screen.queryByTestId("lightbox-actions")).toBeNull();
    for (const name of [
      "Make Products",
      "Publish",
      "Delete",
      "Remove",
      "New design from this",
    ]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(screen.queryByText(/Published/)).toBeNull();
  });

  it("renders consumer `actions` alone", () => {
    renderLightbox({ actions: <button>Use this one</button> });
    expect(screen.getByTestId("lightbox-actions")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Use this one" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("with the /design callback set, every button renders", () => {
    renderLightbox(fullCallbacks());
    for (const name of [
      "Make Products",
      "New design from this",
      "Publish",
      "Delete",
    ]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("only onDelete given: only Delete renders", () => {
    renderLightbox({ onDelete: vi.fn() });
    const row = screen.getByTestId("lightbox-actions");
    expect(
      within(row)
        .getAllByRole("button")
        .map((b) => b.textContent)
    ).toEqual(["Delete"]);
    for (const name of ["Make Products", "New design from this", "Publish"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });

  it("published output without onPublish: no Publish button, no Published · view, Delete still gated", () => {
    const published: LightboxImage[] = [
      { ...images[1], publishedAt: new Date("2026-09-01T00:00:00Z") },
    ];
    renderLightbox({ onDelete: vi.fn(), images: published, currentIndex: 0 });
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
    expect(screen.queryByText(/Published/)).toBeNull();
    expect(screen.queryByRole("link", { name: "view" })).toBeNull();
    const del = screen.getByRole("button", { name: "Delete" });
    expect(del).toBeInTheDocument();
    expect(del).toBeDisabled();
  });

  it("renders `actions` first, then the built-in buttons in /design order", () => {
    renderLightbox({ ...fullCallbacks(), actions: <button>Use this one</button> });
    const row = screen.getByTestId("lightbox-actions");
    expect(
      within(row)
        .getAllByRole("button")
        .map((b) => b.textContent)
    ).toEqual([
      "Use this one",
      "Make Products",
      "New design from this",
      "Publish",
      "Delete",
    ]);
  });

  it("Make Products passes the image url; Delete passes the id", () => {
    const cbs = fullCallbacks();
    renderLightbox(cbs);
    fireEvent.click(screen.getByRole("button", { name: "Make Products" }));
    expect(cbs.onMakeProducts).toHaveBeenCalledWith("https://img.example/b.png");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(cbs.onDelete).toHaveBeenCalledWith("img-b");
  });

  it("New design from this calls onStartFrom with the image id", async () => {
    const cbs = fullCallbacks();
    renderLightbox(cbs);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "New design from this" }));
    });
    expect(cbs.onStartFrom).toHaveBeenCalledWith("img-b");
  });

  it("Publish calls onPublish with the image id", async () => {
    const cbs = fullCallbacks();
    renderLightbox(cbs);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    });
    expect(cbs.onPublish).toHaveBeenCalledWith("img-b");
  });

  it("a published output image: Delete disabled, Published · view instead of Publish", () => {
    const published: LightboxImage[] = [
      { ...images[1], publishedAt: new Date("2026-09-01T00:00:00Z") },
    ];
    renderLightbox({ ...fullCallbacks(), images: published, currentIndex: 0 });
    const del = screen.getByRole("button", { name: "Delete" });
    expect(del).toBeDisabled();
    expect(del).toHaveAttribute("title", "Published images cannot be deleted.");
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
    expect(screen.getByText(/Published ·/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "view" })).toHaveAttribute(
      "href",
      "/d/img-b"
    );
  });

  it("a seed image: labelled Remove, stays enabled, no Publish", () => {
    const seed: LightboxImage[] = [
      { ...images[1], role: "seed", publishedAt: new Date() },
    ];
    const cbs = fullCallbacks();
    renderLightbox({ ...cbs, images: seed, currentIndex: 0 });
    const remove = screen.getByRole("button", { name: "Remove" });
    expect(remove).toBeEnabled();
    expect(remove).toHaveAttribute(
      "title",
      "Removes the starting image from this design only."
    );
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
    expect(screen.queryByText(/Published/)).toBeNull();
    fireEvent.click(remove);
    expect(cbs.onDelete).toHaveBeenCalledWith("img-b");
  });
});
