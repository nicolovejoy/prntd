/**
 * Select mode on My Designs (#195): the grid owns the selection, a tile
 * toggles instead of navigating while selecting, and Delete is optimistic —
 * the chosen tiles leave at once, the ones the server kept come back with one
 * plain notice line.
 *
 * The server action is mocked; the image-level rules it enforces have their
 * own real-DB tests (delete-images.integration.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { LibraryGrid } from "../library-grid";
import type { LibraryImage } from "@/lib/user-designs";
import type { BulkImageDeleteResult } from "../actions";

vi.mock("../actions", () => ({
  deleteImages: vi.fn(async (ids: string[]) => ({
    deleted: ids,
    skipped: [],
  })),
}));

import { deleteImages } from "../actions";

function img(overrides: Partial<LibraryImage> = {}): LibraryImage {
  return {
    imageId: "img-1",
    imageUrl: "https://example.com/img-1.png",
    createdAt: new Date("2026-09-01T00:00:00Z"),
    isPublished: false,
    backgroundColor: null,
    sourceDesignId: "design-1",
    isArchived: false,
    ...overrides,
  };
}

const three = () => [
  img({ imageId: "i1" }),
  img({ imageId: "i2" }),
  img({ imageId: "i3" }),
];

function tiles() {
  return screen.getAllByTestId("library-tile");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("My Designs select mode", () => {
  it("offers Select only when there is something to select", () => {
    const { unmount } = render(<LibraryGrid images={[]} />);
    expect(screen.queryByTestId("library-select")).toBeNull();
    unmount();
    render(<LibraryGrid images={three()} />);
    expect(screen.getByTestId("library-select")).toBeTruthy();
  });

  it("swaps the tile links for toggles once selecting", () => {
    render(<LibraryGrid images={three()} />);
    // Out of select mode a tile is a link to the image detail page.
    expect(
      tiles()[0].closest("a")?.getAttribute("href")
    ).toBe("/d/i1?from=/designs");

    fireEvent.click(screen.getByTestId("library-select"));

    expect(tiles()[0].closest("a")).toBeNull();
    expect(screen.queryAllByTestId("library-tile-checked")).toHaveLength(0);
    expect(
      (screen.getByTestId("library-delete") as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it("toggles a tile on and off and counts the selection", () => {
    render(<LibraryGrid images={three()} />);
    fireEvent.click(screen.getByTestId("library-select"));

    fireEvent.click(tiles()[0]);
    expect(screen.getAllByTestId("library-tile-checked")).toHaveLength(1);
    expect(screen.getByTestId("library-delete").textContent).toContain("(1)");

    fireEvent.click(tiles()[1]);
    expect(screen.getAllByTestId("library-tile-checked")).toHaveLength(2);

    fireEvent.click(tiles()[0]);
    expect(screen.getAllByTestId("library-tile-checked")).toHaveLength(1);
  });

  it("Select all picks every image", () => {
    render(<LibraryGrid images={three()} />);
    fireEvent.click(screen.getByTestId("library-select"));
    fireEvent.click(screen.getByTestId("library-select-all"));
    expect(screen.getAllByTestId("library-tile-checked")).toHaveLength(3);
  });

  it("Cancel clears the selection and leaves select mode", () => {
    render(<LibraryGrid images={three()} />);
    fireEvent.click(screen.getByTestId("library-select"));
    fireEvent.click(screen.getByTestId("library-select-all"));
    fireEvent.click(screen.getByTestId("library-cancel"));

    expect(screen.queryByTestId("library-delete")).toBeNull();
    expect(tiles()[0].closest("a")).toBeTruthy();

    fireEvent.click(screen.getByTestId("library-select"));
    expect(screen.queryAllByTestId("library-tile-checked")).toHaveLength(0);
  });

  it("Escape leaves select mode", () => {
    render(<LibraryGrid images={three()} />);
    fireEvent.click(screen.getByTestId("library-select"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("library-delete")).toBeNull();
  });

  it("Delete confirms once, sends exactly the selected ids, removes the tiles", async () => {
    // Held open so the optimistic all-gone step is observable before the
    // server result lands (same reason as the Studio bench's test).
    let resolveDelete!: (result: BulkImageDeleteResult) => void;
    vi.mocked(deleteImages).mockImplementationOnce(
      () =>
        new Promise<BulkImageDeleteResult>((resolve) => {
          resolveDelete = resolve;
        })
    );
    render(<LibraryGrid images={three()} />);
    fireEvent.click(screen.getByTestId("library-select"));
    fireEvent.click(tiles()[0]);
    fireEvent.click(tiles()[2]);

    fireEvent.click(screen.getByTestId("library-delete"));
    await screen.findByTestId("confirm-sheet");
    expect(screen.getByText("Delete 2 images?")).toBeTruthy();
    expect(screen.getByText("Images used in an order, another design, or a cart are kept.")).toBeTruthy();
    fireEvent.click(screen.getByTestId("confirm-sheet-confirm"));

    await waitFor(() => expect(deleteImages).toHaveBeenCalledWith(["i1", "i3"]));
    // Optimistic: both leave before the action resolves.
    await waitFor(() => expect(tiles()).toHaveLength(1));

    resolveDelete({ deleted: ["i1", "i3"], skipped: [] });

    await waitFor(() => expect(screen.queryByTestId("library-delete")).toBeNull());
    expect(tiles()).toHaveLength(1);
    expect(screen.queryByTestId("library-notice")).toBeNull();
  });

  it("puts a kept image back and says why", async () => {
    let resolveDelete!: (result: BulkImageDeleteResult) => void;
    vi.mocked(deleteImages).mockImplementationOnce(
      () =>
        new Promise<BulkImageDeleteResult>((resolve) => {
          resolveDelete = resolve;
        })
    );
    render(<LibraryGrid images={three()} />);
    fireEvent.click(screen.getByTestId("library-select"));
    fireEvent.click(screen.getByTestId("library-select-all"));

    fireEvent.click(screen.getByTestId("library-delete"));
    await screen.findByTestId("confirm-sheet");
    fireEvent.click(screen.getByTestId("confirm-sheet-confirm"));

    await waitFor(() => expect(screen.queryAllByTestId("library-tile")).toHaveLength(0));

    resolveDelete({
      deleted: ["i1", "i3"],
      skipped: [{ imageId: "i2", reason: "order" }],
    });

    await waitFor(() => expect(tiles()).toHaveLength(1));
    expect(screen.getByTestId("library-notice").textContent).toBe(
      "1 image wasn't deleted — Used in an order."
    );
  });

  it("restores every tile when the action throws", async () => {
    vi.mocked(deleteImages).mockRejectedValueOnce(new Error("boom"));
    render(<LibraryGrid images={three()} />);
    fireEvent.click(screen.getByTestId("library-select"));
    fireEvent.click(screen.getByTestId("library-select-all"));

    fireEvent.click(screen.getByTestId("library-delete"));
    await screen.findByTestId("confirm-sheet");
    fireEvent.click(screen.getByTestId("confirm-sheet-confirm"));

    await waitFor(() => expect(tiles()).toHaveLength(3));
    expect(screen.getByTestId("library-notice").textContent).toBe(
      "Couldn't delete those images. Try again."
    );
  });

  it("does nothing when the confirm is dismissed", async () => {
    render(<LibraryGrid images={three()} />);
    fireEvent.click(screen.getByTestId("library-select"));
    fireEvent.click(screen.getByTestId("library-select-all"));

    fireEvent.click(screen.getByTestId("library-delete"));
    const sheet = await screen.findByTestId("confirm-sheet");
    fireEvent.click(within(sheet).getByText("Cancel"));

    await waitFor(() =>
      expect(screen.queryByTestId("confirm-sheet")).not.toBeInTheDocument()
    );
    expect(deleteImages).not.toHaveBeenCalled();
    expect(tiles()).toHaveLength(3);
    expect(screen.getByTestId("library-delete")).toBeTruthy();
  });

  it("shows the empty line once the last tile is deleted", async () => {
    render(<LibraryGrid images={[img({ imageId: "i1" })]} />);
    fireEvent.click(screen.getByTestId("library-select"));
    fireEvent.click(tiles()[0]);
    fireEvent.click(screen.getByTestId("library-delete"));
    await screen.findByTestId("confirm-sheet");
    fireEvent.click(screen.getByTestId("confirm-sheet-confirm"));

    await waitFor(() => expect(screen.getByText("No designs yet.")).toBeTruthy());
    expect(screen.queryByTestId("library-tile")).toBeNull();
  });
});
