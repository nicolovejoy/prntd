import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within, act } from "@testing-library/react";
import { ConversationImages } from "../conversation-images";
import type { SiblingImage } from "../../actions";

// The real module is "use server" and pulls the DB.
vi.mock("@/app/design/actions", () => ({
  setPrimaryImage: vi.fn(async () => {}),
}));

import { setPrimaryImage } from "@/app/design/actions";

// A is primary, B is the page's own image, C is a later variant.
const images: SiblingImage[] = [
  { imageId: "img-a", imageUrl: "https://img.example/a.png", isPrimary: true },
  { imageId: "img-b", imageUrl: "https://img.example/b.png", isPrimary: false },
  { imageId: "img-c", imageUrl: "https://img.example/c.png", isPrimary: false },
];

function renderStrip(overrides: Partial<Parameters<typeof ConversationImages>[0]> = {}) {
  return render(
    <ConversationImages
      designId="d1"
      currentImageId="img-b"
      images={images}
      initialPrimaryImageId="img-a"
      from="/designs"
      {...overrides}
    />
  );
}

const thumbs = () => screen.getAllByTestId("conversation-image-thumb");
const thumb = (n: number) => screen.getByRole("button", { name: `Image #${n}` });
const lightbox = () => within(screen.getByTestId("image-lightbox"));
const prev = () => lightbox().getByRole("button", { name: "Previous image" });
const next = () => lightbox().getByRole("button", { name: "Next image" });
const CURRENT_COPY = "This is the design’s current image.";

beforeEach(() => {
  vi.mocked(setPrimaryImage).mockClear();
  vi.spyOn(window, "alert").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ConversationImages owner gate", () => {
  it("renders nothing for the non-owner payload (no images)", () => {
    const { container } = renderStrip({ images: [] });
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryAllByTestId("conversation-image-thumb")).toHaveLength(0);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByTestId("image-lightbox")).toBeNull();
  });
});

describe("ConversationImages strip", () => {
  it("shows every image but the page's own, marking the primary", () => {
    renderStrip();
    expect(thumbs()).toHaveLength(2);
    expect(thumb(1)).toHaveAttribute("aria-current", "true");
    expect(thumb(1)).toHaveAttribute("title", "Current image");
    expect(thumb(3)).not.toHaveAttribute("aria-current");
    expect(thumb(3)).not.toHaveAttribute("title");
    expect(screen.queryByRole("button", { name: "Image #2" })).toBeNull();
    // No lightbox until a tap.
    expect(screen.queryByTestId("image-lightbox")).toBeNull();
  });

  it("thumbnails are buttons, not links", () => {
    renderStrip();
    for (const t of thumbs()) {
      expect(t.tagName).toBe("BUTTON");
      expect(t).toHaveAttribute("type", "button");
    }
  });
});

describe("ConversationImages lightbox open/close", () => {
  it("tapping a thumb opens the lightbox at that image; Close removes it", () => {
    renderStrip();
    fireEvent.click(thumb(3));
    expect(lightbox().getByText("#3 of 3")).toBeInTheDocument();
    fireEvent.click(lightbox().getByRole("button", { name: "Close" }));
    expect(screen.queryByTestId("image-lightbox")).toBeNull();

    fireEvent.click(thumb(1));
    expect(lightbox().getByText("#1 of 3")).toBeInTheDocument();
  });

  it("prev/next pass through the page's own image and stop at the ends", () => {
    renderStrip();
    fireEvent.click(thumb(3));
    fireEvent.click(prev());
    expect(lightbox().getByText("#2 of 3")).toBeInTheDocument();
    fireEvent.click(prev());
    expect(lightbox().getByText("#1 of 3")).toBeInTheDocument();
    expect(prev()).toBeDisabled();
    fireEvent.click(next());
    fireEvent.click(next());
    expect(lightbox().getByText("#3 of 3")).toBeInTheDocument();
    expect(next()).toBeDisabled();
  });

  it("Escape on window closes it and marks the keystroke handled", () => {
    renderStrip();
    fireEvent.click(thumb(3));
    expect(screen.getByTestId("image-lightbox")).toBeInTheDocument();
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      cancelable: true,
      bubbles: true,
    });
    let notCancelled = true;
    act(() => {
      notCancelled = window.dispatchEvent(event);
    });
    expect(notCancelled).toBe(false);
    expect(screen.queryByTestId("image-lightbox")).toBeNull();
  });
});

describe("ConversationImages lightbox actions", () => {
  it("on the primary: current-image copy, no Use this one inside", () => {
    renderStrip();
    fireEvent.click(thumb(1));
    expect(lightbox().getByText(CURRENT_COPY)).toBeInTheDocument();
    expect(
      lightbox().queryByRole("button", { name: "Use this one" })
    ).toBeNull();
    // The top-level action for the page's own image (B) is untouched.
    expect(
      screen.getAllByRole("button", { name: "Use this one" })
    ).toHaveLength(1);
  });

  it("Use this one inside sets the shown image primary and moves the ring", async () => {
    renderStrip();
    fireEvent.click(thumb(3));
    await act(async () => {
      fireEvent.click(lightbox().getByRole("button", { name: "Use this one" }));
    });
    expect(setPrimaryImage).toHaveBeenCalledTimes(1);
    expect(setPrimaryImage).toHaveBeenCalledWith("d1", "img-c");
    expect(lightbox().getByText(CURRENT_COPY)).toBeInTheDocument();
    expect(
      lightbox().queryByRole("button", { name: "Use this one" })
    ).toBeNull();
    expect(thumb(3)).toHaveAttribute("aria-current", "true");
    expect(thumb(1)).not.toHaveAttribute("aria-current");
    // B is still not primary, so its top-level action stays.
    expect(
      screen.getAllByRole("button", { name: "Use this one" })
    ).toHaveLength(1);
  });

  it("Use this one on the page's own image inside the lightbox flips the top-level block too", async () => {
    // Primary state is one piece of state shared by the strip, the top-level
    // block and the lightbox — a lightbox-local copy would pass every other
    // test in this file.
    renderStrip();
    fireEvent.click(thumb(3));
    fireEvent.click(prev());
    expect(lightbox().getByText("#2 of 3")).toBeInTheDocument();
    const inside = lightbox().getByRole("button", { name: "Use this one" });
    await act(async () => {
      fireEvent.click(inside);
    });
    expect(setPrimaryImage).toHaveBeenCalledTimes(1);
    expect(setPrimaryImage).toHaveBeenCalledWith("d1", "img-b");
    // Top-level block and lightbox both now say it's current.
    expect(screen.getAllByText(CURRENT_COPY)).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Use this one" })).toBeNull();
    // B isn't in the strip, so no thumb carries the ring.
    expect(thumb(1)).not.toHaveAttribute("aria-current");
    expect(thumb(3)).not.toHaveAttribute("aria-current");
  });

  it("links to a sibling's own page, but not to the page's own image", () => {
    renderStrip();
    fireEvent.click(thumb(3));
    expect(lightbox().getByRole("link", { name: "Open" })).toHaveAttribute(
      "href",
      "/d/img-c?from=%2Fdesigns"
    );
    fireEvent.click(prev());
    expect(lightbox().getByText("#2 of 3")).toBeInTheDocument();
    expect(lightbox().queryByRole("link", { name: "Open" })).toBeNull();
  });

  it("Open carries no ?from when none was given", () => {
    renderStrip({ from: undefined });
    fireEvent.click(thumb(3));
    expect(lightbox().getByRole("link", { name: "Open" })).toHaveAttribute(
      "href",
      "/d/img-c"
    );
  });
});

describe("ConversationImages top-level Use this one", () => {
  it("sets the page's own image primary and flips the copy", async () => {
    renderStrip();
    expect(screen.queryByText(CURRENT_COPY)).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Use this one" }));
    });
    expect(setPrimaryImage).toHaveBeenCalledWith("d1", "img-b");
    expect(screen.getByText(CURRENT_COPY)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use this one" })).toBeNull();
    // A lost the ring; nothing in the strip carries it now.
    expect(thumb(1)).not.toHaveAttribute("aria-current");
    expect(thumb(3)).not.toHaveAttribute("aria-current");
  });

  it("a failed save alerts the message and re-enables the button", async () => {
    vi.mocked(setPrimaryImage).mockRejectedValueOnce(new Error("Unauthorized"));
    renderStrip();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Use this one" }));
    });
    expect(window.alert).toHaveBeenCalledWith("Unauthorized");
    const btn = screen.getByRole("button", { name: "Use this one" });
    expect(btn).toBeEnabled();
    expect(screen.queryByText(CURRENT_COPY)).toBeNull();
    expect(thumb(1)).toHaveAttribute("aria-current", "true");
  });
});
