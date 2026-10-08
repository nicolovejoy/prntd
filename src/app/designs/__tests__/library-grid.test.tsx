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
import type { BulkImageDeleteResult } from "@/app/designs/actions";

vi.mock("@/app/designs/actions", () => ({
  deleteImages: vi.fn(async (ids: string[]) => ({
    deleted: ids,
    skipped: [],
  })),
}));

import { deleteImages } from "@/app/designs/actions";

function img(overrides: Partial<LibraryImage> = {}): LibraryImage {
  return {
    imageId: "img-1",
    imageUrl: "https://example.com/img-1.png",
    createdAt: new Date("2026-09-01T00:00:00Z"),
    isPublished: false,
    backgroundColor: null,
    sourceDesignId: "design-1",
    isArchived: false,
    isHidden: false,
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
    expect(
      screen.getByText(
        "Images used in an order, another design, or a cart are kept. A conversation left with no images goes too. Conversations with an order are kept instead."
      )
    ).toBeTruthy();
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

  it("keeps the selection intact after a failed delete, so Try again works", async () => {
    // Regression for the reconciliation effect wiping `selected` during the
    // optimistic remove-then-restore cycle of a failed bulk delete — the
    // failure notice used to point at an empty selection, forcing the user
    // to re-select everything by hand.
    vi.mocked(deleteImages).mockRejectedValueOnce(new Error("boom"));
    render(<LibraryGrid images={three()} />);
    fireEvent.click(screen.getByTestId("library-select"));
    fireEvent.click(screen.getByTestId("library-select-all"));
    expect(screen.getByTestId("library-selected-count").textContent).toBe("3 selected");

    fireEvent.click(screen.getByTestId("library-delete"));
    await screen.findByTestId("confirm-sheet");
    fireEvent.click(screen.getByTestId("confirm-sheet-confirm"));

    await waitFor(() => expect(tiles()).toHaveLength(3));
    expect(screen.getByTestId("library-notice").textContent).toBe(
      "Couldn't delete those images. Try again."
    );
    expect(screen.getByTestId("library-selected-count").textContent).toBe("3 selected");
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

describe("All/Active filter", () => {
  it("defaults to All — an archived image is visible on first render", () => {
    render(
      <LibraryGrid
        images={[img({ imageId: "img-1", isArchived: true })]}
      />
    );
    expect(screen.getByTestId("library-tile")).toBeTruthy();
  });

  it("Active hides archived images; All brings them back", () => {
    render(
      <LibraryGrid
        images={[
          img({ imageId: "img-1", isArchived: false }),
          img({ imageId: "img-2", isArchived: true }),
        ]}
      />
    );
    expect(screen.getAllByTestId("library-tile")).toHaveLength(2);

    fireEvent.click(screen.getByTestId("library-filter-active"));
    expect(screen.getAllByTestId("library-tile")).toHaveLength(1);

    fireEvent.click(screen.getByTestId("library-filter-all"));
    expect(screen.getAllByTestId("library-tile")).toHaveLength(2);
  });

  it("Active with nothing active shows a lighter empty state than the true-empty one", () => {
    render(<LibraryGrid images={[img({ imageId: "img-1", isArchived: true })]} />);
    fireEvent.click(screen.getByTestId("library-filter-active"));
    expect(screen.getByText("Nothing active — switch to All to see everything.")).toBeTruthy();
  });

  it("no longer prints an Archived marker on the tile", () => {
    render(<LibraryGrid images={[img({ imageId: "img-1", isArchived: true })]} />);
    expect(screen.queryByText("Archived")).toBeNull();
    expect(screen.queryByText(/Archived/)).toBeNull();
  });

  it("reconciles selection when the filter hides a selected image", () => {
    render(
      <LibraryGrid
        images={[
          img({ imageId: "i1", isArchived: false }),
          img({ imageId: "i2", isArchived: true }),
        ]}
      />
    );
    fireEvent.click(screen.getByTestId("library-select"));

    // Select one active and one archived image (count should show "2 selected").
    fireEvent.click(tiles()[0]);
    fireEvent.click(tiles()[1]);
    expect(screen.getByTestId("library-selected-count").textContent).toBe("2 selected");

    // Switch to Active filter — the archived image disappears from the grid.
    fireEvent.click(screen.getByTestId("library-filter-active"));

    // Selection should be reconciled; count should drop to "1 selected".
    expect(screen.getByTestId("library-selected-count").textContent).toBe("1 selected");
    expect(tiles()).toHaveLength(1);
  });
});

describe("an admin-hidden image in My Designs (#288)", () => {
  const withHidden = () => [
    img({ imageId: "i1" }),
    img({ imageId: "h1", isHidden: true, isPublished: true }),
    img({ imageId: "i3" }),
  ];

  it("shows a HIDDEN placeholder with no artwork that opens the image detail page", () => {
    render(<LibraryGrid images={withHidden()} />);
    const tile = screen.getByTestId("library-tile-hidden");
    expect(tile).toHaveTextContent("HIDDEN");
    expect(within(tile).queryByRole("img")).toBeNull();
    expect(tile.closest("a")?.getAttribute("href")).toBe("/d/h1?from=/designs");
    // Two normal tiles with artwork, one placeholder.
    expect(tiles()).toHaveLength(2);
    expect(screen.getAllByRole("img")).toHaveLength(2);
    // The Published marker belongs to a visible published image.
    expect(screen.queryByText("Published")).toBeNull();
  });

  it("is not selectable: no toggle, not part of Select all, never sent to delete", async () => {
    render(<LibraryGrid images={withHidden()} />);
    fireEvent.click(screen.getByTestId("library-select"));

    const tile = screen.getByTestId("library-tile-hidden");
    expect(tile.closest("button")).toBeNull();
    expect(tile.closest("a")).toBeNull();
    fireEvent.click(tile);
    expect(screen.queryAllByTestId("library-tile-checked")).toHaveLength(0);

    fireEvent.click(screen.getByTestId("library-select-all"));
    expect(screen.getAllByTestId("library-tile-checked")).toHaveLength(2);
    expect(screen.getByTestId("library-selected-count")).toHaveTextContent("2 selected");
    expect(
      (screen.getByTestId("library-select-all") as HTMLButtonElement).disabled
    ).toBe(true);

    fireEvent.click(screen.getByTestId("library-delete"));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteImages).toHaveBeenCalledTimes(1));
    expect(vi.mocked(deleteImages).mock.calls[0][0].sort()).toEqual(["i1", "i3"]);
    // The placeholder stays.
    expect(screen.getByTestId("library-tile-hidden")).toBeInTheDocument();
  });

  it("a grid of only hidden images has nothing to select all of", () => {
    render(<LibraryGrid images={[img({ imageId: "h1", isHidden: true })]} />);
    fireEvent.click(screen.getByTestId("library-select"));
    expect(
      (screen.getByTestId("library-select-all") as HTMLButtonElement).disabled
    ).toBe(true);
  });
});
