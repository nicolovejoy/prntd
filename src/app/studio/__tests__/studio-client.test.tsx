/**
 * Render + interaction coverage for the Studio screen (slices 2+3): the empty
 * state, a lane's cells with the primary marked, a pending cell with elapsed
 * time — and the anchor model: chip with dismiss, anchored submit = edit of
 * that image, unanchored submit = fresh conversation, cap visible, Close
 * clears a lane. (2026-09-09: a cell tap now opens the lightbox; anchoring
 * is the lightbox's "Edit this one" — see the `anchorCell` helper below.)
 *
 * The one test that matters most (plan, slice 3): the anchor survives a poll
 * refresh landing mid-typing. Server actions are mocked; polling arithmetic
 * lives in generation-poll's own unit tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Profiler } from "react";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import { StudioClient } from "../studio-client";
import type { StudioLane } from "@/lib/studio";
import type { BulkDeleteResult } from "@/lib/studio-view";

const h = vi.hoisted(() => ({
  polledLanes: [] as unknown[],
}));

vi.mock("../actions", () => ({
  getStudioLanes: vi.fn(async () => h.polledLanes),
  deleteConversations: vi.fn(async (ids: string[]) => ({
    deleted: ids,
    skipped: [],
  })),
}));
vi.mock("@/app/design/actions", () => ({
  generateDesign: vi.fn(async () => ({
    kind: "queued",
    jobId: "job-new",
    generationNumber: 1,
    imageId: "img-new",
  })),
  closeConversation: vi.fn(async () => {}),
  cancelGeneration: vi.fn(async () => true),
}));
vi.mock("@/app/designs/actions", () => ({
  deleteDesign: vi.fn(async () => ({})),
}));

import { deleteConversations, getStudioLanes } from "../actions";
import {
  generateDesign,
  closeConversation,
  cancelGeneration,
} from "@/app/design/actions";
import { deleteDesign } from "@/app/designs/actions";

// jsdom implements neither; the component calls both.
window.HTMLElement.prototype.scrollIntoView = vi.fn();

function lane(overrides: Partial<StudioLane> = {}): StudioLane {
  return {
    designId: "design-1",
    title: "geometric wolf head",
    lastActiveAt: new Date(Date.now() - 5 * 60 * 1000),
    cells: [],
    pending: [],
    ...overrides,
  };
}

function cell(id: string, overrides: Partial<StudioLane["cells"][number]> = {}) {
  return {
    imageId: id,
    imageUrl: `https://cdn.example/${id}.png`,
    isPrimary: false,
    createdAt: new Date(),
    ...overrides,
  };
}

function pendingJob(id: string, ageMs = 42_000) {
  return {
    jobId: id,
    generationNumber: 1,
    startedAt: new Date(Date.now() - ageMs),
  };
}

/**
 * Anchors a cell for edit. Since #236's follow-up, a plain cell tap opens
 * the lightbox rather than anchoring — anchoring now happens via the
 * lightbox's own "Edit this one" action — so every test that needs an
 * anchored image goes through both steps.
 */
function anchorCell(index = 0) {
  fireEvent.click(screen.getAllByTestId("studio-cell")[index]);
  fireEvent.click(screen.getByTestId("lightbox-edit"));
}

beforeEach(() => {
  vi.clearAllMocks();
  h.polledLanes = [];
});

describe("StudioClient rendering", () => {
  it("renders a lane's cells with the primary marked", () => {
    render(
      <StudioClient
        initialLanes={[
          lane({ cells: [cell("img-1"), cell("img-2", { isPrimary: true })] }),
        ]}
      />
    );

    expect(screen.getByText("geometric wolf head")).toBeTruthy();
    const cells = screen.getAllByTestId("studio-cell");
    expect(cells).toHaveLength(2);
    // Primary is a mono marker now, not a border weight — the 2px ink border
    // is reserved for "anchored" alone (review fix, task 4). Neither cell is
    // anchored here, so neither carries border-2; the primary cell alone
    // shows the visible "Primary" label.
    expect(cells[0].className).not.toContain("border-2");
    expect(cells[1].className).not.toContain("border-2");
    expect(within(cells[0]).queryAllByText("Primary")).toHaveLength(0);
    // getByText throws on more than one match, so this alone would catch a
    // reintroduced sr-only echo beside the visible label (the exact
    // duplicate-announcement regression fixed above); the explicit
    // not-sr-only check on top makes sure the one surviving match is the
    // visible marker, not a lone sr-only span standing in for it.
    const primaryLabel = within(cells[1]).getByText("Primary");
    expect(primaryLabel.className).not.toContain("sr-only");
  });

  it("renders a running generation as a pending cell with elapsed time", () => {
    render(<StudioClient initialLanes={[lane({ pending: [pendingJob("job-1")] })]} />);

    const pending = screen.getByTestId("studio-pending-cell");
    expect(pending.textContent).toContain("Generating…");
    expect(pending.textContent).toMatch(/0:4[0-9]/);
  });

  it("falls back to Untitled when a lane has no label", () => {
    render(<StudioClient initialLanes={[lane({ title: null })]} />);
    expect(screen.getByText("Untitled")).toBeTruthy();
  });
});

describe("cells (Paper bench)", () => {
  it("numbers cells in creation order", () => {
    render(
      <StudioClient
        initialLanes={[
          lane({ cells: [cell("a"), cell("b", { isPrimary: true })] }),
        ]}
      />
    );
    const cells = screen.getAllByTestId("studio-cell");
    // Bind each label to its own cell, not just "somewhere on the page" —
    // pins position-to-label rather than merely presence.
    expect(within(cells[0]).getByText("#1")).toBeTruthy();
    expect(within(cells[1]).getByText("#2")).toBeTruthy();
  });

  it("marks the anchored cell with an ink border, not a ring", () => {
    render(
      <StudioClient
        initialLanes={[
          lane({ cells: [cell("a"), cell("b", { isPrimary: true })] }),
        ]}
      />
    );
    const cell0 = screen.getAllByTestId("studio-cell")[0];
    anchorCell(0);
    expect(cell0.className).toContain("border-2");
    expect(cell0.className).not.toContain("ring-2");
  });

  it("keeps anchored and primary as separate, composable signals", () => {
    render(
      <StudioClient
        initialLanes={[
          lane({ cells: [cell("a"), cell("b", { isPrimary: true })] }),
        ]}
      />
    );
    const cells = screen.getAllByTestId("studio-cell");
    // Anchor the NON-primary cell — primary stays "b" (cells[1]).
    anchorCell(0);

    expect(cells[0].className).toContain("border-2");
    expect(cells[0]).not.toBe(cells[1]);

    // The primary marker is visible (not just sr-only) on the primary cell,
    // and the anchored-but-not-primary cell shows no such marker at all.
    // getByText (exactly one match) plus the not-sr-only check together
    // catch a reintroduced sr-only echo beside the visible label.
    const primaryLabel = within(cells[1]).getByText("Primary");
    expect(primaryLabel.className).not.toContain("sr-only");
    expect(within(cells[0]).queryAllByText("Primary")).toHaveLength(0);
  });

  it("draws the pending dash in ink and matches the result cells' square footprint (task 4)", () => {
    // "Generating…"/Cancel and border-dashed itself predate this branch and
    // are already pinned by the :117 rendering test above; what task 4 added
    // is the ink-colored dash (vs. a duller pre-branch color) and sizing the
    // cell to the same responsive square as a real result cell, so the row
    // doesn't reflow when a pending cell resolves into one.
    render(<StudioClient initialLanes={[lane({ pending: [pendingJob("job-1")] })]} />);
    const pending = screen.getByTestId("studio-pending-cell");
    expect(pending.className).toContain("border-foreground");
    expect(pending.className).toContain("sm:w-36");
  });

  it("a cell tap opens the lightbox, with an Open link to the detail page", () => {
    render(
      <StudioClient
        initialLanes={[
          lane({
            designId: "design-1",
            cells: [cell("img-1"), cell("img-2")],
          }),
        ]}
      />
    );

    const cells = screen.getAllByTestId("studio-cell");
    fireEvent.click(cells[1]); // open on the second cell

    const lightbox = screen.getByTestId("image-lightbox");
    expect(lightbox).toBeTruthy();

    const openLink = within(lightbox).getByRole("link", { name: "Open" });
    expect(openLink.getAttribute("href")).toBe("/d/img-2");
  });

  it("a cell tap alone does not anchor — anchoring is the lightbox's own action", () => {
    render(
      <StudioClient
        initialLanes={[lane({ designId: "design-1", cells: [cell("img-1")] })]}
      />
    );

    fireEvent.click(screen.getByTestId("studio-cell"));
    expect(screen.getByTestId("image-lightbox")).toBeTruthy();
    expect(screen.queryByTestId("anchor-chip")).toBeNull();
  });

  it("Edit this one in the lightbox anchors the shown image and closes the lightbox", () => {
    render(
      <StudioClient
        initialLanes={[lane({ designId: "design-1", cells: [cell("img-1")] })]}
      />
    );

    anchorCell(0);
    expect(screen.queryByTestId("image-lightbox")).toBeNull();
    const chip = screen.getByTestId("anchor-chip");
    expect(chip.textContent).toContain("Editing · geometric wolf head");
  });
});

describe("the empty bench", () => {
  it("offers the composer and one line, and no Shop path", () => {
    render(<StudioClient initialLanes={[]} />);
    expect(screen.getByTestId("studio-composer-panel")).toBeTruthy();
    expect(screen.getByText("No open designs.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Browse the Shop" })).toBeNull();
  });
});

describe("anchoring", () => {
  it("Edit this one anchors a cell and shows the chip; dismiss clears it", () => {
    render(<StudioClient initialLanes={[lane({ cells: [cell("img-1")] })]} />);

    anchorCell(0);
    const chip = screen.getByTestId("anchor-chip");
    expect(chip.textContent).toContain("Editing · geometric wolf head");

    fireEvent.click(screen.getByLabelText("Clear anchor"));
    expect(screen.queryByTestId("anchor-chip")).toBeNull();
  });

  it("re-opening the lightbox and choosing Edit this one on the already-anchored image keeps it anchored", () => {
    // "Edit this one" always SETS the anchor — it must never read as a
    // silent toggle-off, since un-anchoring belongs to the chip's own
    // "Clear anchor" control (#236 follow-up).
    render(<StudioClient initialLanes={[lane({ cells: [cell("img-1")] })]} />);

    anchorCell(0);
    expect(screen.getByTestId("anchor-chip")).toBeTruthy();
    anchorCell(0);
    expect(screen.getByTestId("anchor-chip")).toBeTruthy();
  });

  it("the anchor survives a poll refresh landing mid-typing", async () => {
    const l = lane({ cells: [cell("img-1")], pending: [pendingJob("job-9")] });
    h.polledLanes = [l];
    render(<StudioClient initialLanes={[l]} />);

    anchorCell(0);
    fireEvent.change(screen.getByTestId("studio-composer"), {
      target: { value: "make it bl" },
    });

    // A wake refetch replaces the lane state with server truth mid-typing.
    fireEvent(window, new Event("focus"));
    await waitFor(() => expect(getStudioLanes).toHaveBeenCalled());

    expect(screen.getByTestId("anchor-chip")).toBeTruthy();
    expect(
      (screen.getByTestId("studio-composer") as HTMLInputElement).value
    ).toBe("make it bl");
  });

  it("clears the anchor when its image leaves the surface", async () => {
    const l = lane({ cells: [cell("img-1")] });
    h.polledLanes = []; // the conversation closed elsewhere
    render(<StudioClient initialLanes={[l]} />);

    anchorCell(0);
    expect(screen.getByTestId("anchor-chip")).toBeTruthy();

    fireEvent(window, new Event("focus"));
    await waitFor(() =>
      expect(screen.queryByTestId("anchor-chip")).toBeNull()
    );
  });
});

describe("the composer", () => {
  it("anchored Generate edits exactly the tapped image", async () => {
    render(<StudioClient initialLanes={[lane({ cells: [cell("img-1")] })]} />);

    anchorCell(0);
    fireEvent.change(screen.getByTestId("studio-composer"), {
      target: { value: "make it blue" },
    });
    fireEvent.submit(screen.getByTestId("studio-composer").closest("form")!);

    await waitFor(() =>
      expect(generateDesign).toHaveBeenCalledWith("design-1", "make it blue", {
        anchorImageId: "img-1",
      })
    );
    // The anchor stays where the user put it — it never advances to a result.
    expect(screen.getByTestId("anchor-chip")).toBeTruthy();
  });

  it("unanchored Generate starts a fresh conversation", async () => {
    render(<StudioClient initialLanes={[lane()]} />);

    fireEvent.change(screen.getByTestId("studio-composer"), {
      target: { value: "a red dragon" },
    });
    fireEvent.submit(screen.getByTestId("studio-composer").closest("form")!);

    await waitFor(() => expect(generateDesign).toHaveBeenCalled());
    const [designId, message, opts] = vi.mocked(generateDesign).mock.calls[0];
    expect(designId).not.toBe("design-1"); // a freshly minted id
    expect(message).toBe("a red dragon");
    expect(opts).toEqual({});
  });

  it("shows the server's message when the turn is refused", async () => {
    vi.mocked(generateDesign).mockResolvedValueOnce({
      kind: "limit",
      message: "You've reached today's free design limit. Sign in to keep designing.",
    });
    render(<StudioClient initialLanes={[lane()]} />);

    fireEvent.change(screen.getByTestId("studio-composer"), {
      target: { value: "a red dragon" },
    });
    fireEvent.submit(screen.getByTestId("studio-composer").closest("form")!);

    await waitFor(() =>
      expect(screen.getByText(/free design limit/)).toBeTruthy()
    );
    // The words come back — the turn didn't run.
    expect(
      (screen.getByTestId("studio-composer") as HTMLInputElement).value
    ).toBe("a red dragon");
  });

  it("at the cap, Generate is disabled and says why", () => {
    render(
      <StudioClient
        initialLanes={[
          lane({
            pending: [pendingJob("j1"), pendingJob("j2"), pendingJob("j3")],
          }),
        ]}
      />
    );

    fireEvent.change(screen.getByTestId("studio-composer"), {
      target: { value: "one more" },
    });
    expect(
      (screen.getByTestId("studio-generate") as HTMLButtonElement).disabled
    ).toBe(true);
    expect(screen.getByTestId("cap-notice").textContent).toContain(
      "3 generating"
    );
  });
});

describe("the composer panel (Paper bench)", () => {
  it("renders above the lanes, not docked to the bottom", () => {
    render(<StudioClient initialLanes={[lane({ cells: [cell("a"), cell("b", { isPrimary: true })] })]} />);
    const composer = screen.getByTestId("studio-composer");
    const lanesEl = screen.getByTestId("studio-lane");
    // Node.compareDocumentPosition: DOCUMENT_POSITION_FOLLOWING (4) means
    // `lanesEl` comes after `composer` in document order.
    expect(composer.compareDocumentPosition(lanesEl) & 4).toBe(4);
    const panel = screen.getByTestId("studio-composer-panel");
    expect(panel.className).not.toContain("fixed");
  });

  it("labels the panel and states what a line does", () => {
    render(<StudioClient initialLanes={[]} />);
    expect(screen.getByText("New design")).toBeTruthy();
    expect(
      screen.getByText("Each line starts a design. Tap a result to change it.")
    ).toBeTruthy();
  });

  it("shows the anchored image as a row inside the panel", () => {
    render(<StudioClient initialLanes={[lane({ cells: [cell("a")] })]} />);
    anchorCell(0);
    const chip = screen.getByTestId("anchor-chip");
    expect(screen.getByTestId("studio-composer-panel").contains(chip)).toBe(true);
  });

  it("pays no bottom padding for a composer that is no longer docked", () => {
    render(<StudioClient initialLanes={[lane({ cells: [cell("a"), cell("b", { isPrimary: true })] })]} />);
    expect(screen.getByRole("main").className).not.toContain("pb-40");
  });

  it("shows a failed Close's explanation in the panel (Important 2, review)", async () => {
    // `notice` only renders inside the composer panel, which now sits above
    // the fold — the panel scrolls itself into view on this transition
    // (jsdom stubs scrollIntoView above, so that part isn't directly
    // asserted here; this pins that the notice text itself lands).
    vi.mocked(closeConversation).mockRejectedValueOnce(new Error("boom"));
    render(<StudioClient initialLanes={[lane()]} />);

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByTestId("studio-close-lane"));

    await waitFor(() =>
      expect(
        screen
          .getByTestId("studio-composer-panel")
          .textContent
      ).toContain("Couldn't close that design. Try again.")
    );
  });

  it("swaps main's bottom padding for the select bar, and back on Done", () => {
    render(<StudioClient initialLanes={[lane({ cells: [cell("a")] })]} />);

    // Not selecting: main pays the plain page padding, not the bar's.
    expect(screen.getByRole("main").className).toContain("pb-8");
    expect(screen.getByRole("main").className).not.toContain("pb-40");

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByTestId("select-mode"));
    expect(screen.getByRole("main").className).toContain("pb-40");
    expect(screen.getByRole("main").className).not.toContain("pb-8");

    fireEvent.click(screen.getByTestId("select-done"));
    expect(screen.getByRole("main").className).toContain("pb-8");
    expect(screen.getByRole("main").className).not.toContain("pb-40");
  });
});

describe("the lane row (Paper bench)", () => {
  it("shows a relative time and keeps the title a link to the thread", () => {
    const l = lane({
      cells: [cell("a")],
      lastActiveAt: new Date(Date.now() - 14 * 60_000),
    });
    render(<StudioClient initialLanes={[l]} />);
    expect(screen.getByText("14m ago")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: l.title! }).getAttribute("href")
    ).toBe(`/design?id=${l.designId}`);
  });

  it("marks a generating lane with a status pill", () => {
    render(<StudioClient initialLanes={[lane({ pending: [pendingJob("job-1")] })]} />);
    expect(screen.getByTestId("lane-generating")).toBeTruthy();
  });

  it("holds Close, Delete and Select behind the overflow control", () => {
    render(
      <StudioClient
        initialLanes={[
          lane({ cells: [cell("a"), cell("b", { isPrimary: true })] }),
        ]}
      />
    );
    expect(screen.queryByTestId("studio-close-lane")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByTestId("studio-close-lane")).toBeTruthy();
    expect(screen.getByTestId("studio-delete-lane")).toBeTruthy();
    expect(screen.getByTestId("select-mode")).toBeTruthy();
  });

  it("closes the overflow on Escape", () => {
    render(
      <StudioClient
        initialLanes={[
          lane({ cells: [cell("a"), cell("b", { isPrimary: true })] }),
        ]}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("studio-close-lane")).toBeNull();
  });

  it("offers no overflow at all while a generation is running", () => {
    render(<StudioClient initialLanes={[lane({ pending: [pendingJob("job-1")] })]} />);
    expect(screen.queryByRole("button", { name: "More" })).toBeNull();
  });
});

describe("closing a lane", () => {
  it("Close removes the lane and closes the conversation", async () => {
    render(<StudioClient initialLanes={[lane()]} />);

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByTestId("studio-close-lane"));

    expect(screen.queryByTestId("studio-lane")).toBeNull();
    await waitFor(() =>
      expect(closeConversation).toHaveBeenCalledWith("design-1")
    );
  });

  it("offers no Close while a generation is running", () => {
    render(<StudioClient initialLanes={[lane({ pending: [pendingJob("j1")] })]} />);
    expect(screen.queryByTestId("studio-close-lane")).toBeNull();
  });
});

describe("cancelling a pending generation (#187)", () => {
  it("Cancel on the pending cell calls cancelGeneration and drops the cell", async () => {
    render(
      <StudioClient
        initialLanes={[lane({ cells: [cell("img-1")], pending: [pendingJob("job-1")] })]}
      />
    );

    fireEvent.click(screen.getByTestId("cancel-generation"));

    // Optimistic: the cell leaves now; the lane and its finished work stay.
    expect(screen.queryByTestId("studio-pending-cell")).toBeNull();
    expect(screen.getAllByTestId("studio-cell")).toHaveLength(1);
    expect(screen.getByTestId("studio-lane")).toBeTruthy();
    await waitFor(() => expect(cancelGeneration).toHaveBeenCalledWith("job-1"));
  });

  it("refetches once when the cancel lost to the landing, so the landed cell shows", async () => {
    // The image landed before the cancel: the server reports false and the
    // image stays. Removing the pending cell stopped the poll loop, so the
    // landed cell would otherwise wait for a focus event.
    (cancelGeneration as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    const landed = lane({ cells: [cell("img-landed")], pending: [] });
    h.polledLanes = [landed];
    render(<StudioClient initialLanes={[lane({ pending: [pendingJob("job-1")] })]} />);

    fireEvent.click(screen.getByTestId("cancel-generation"));

    await waitFor(() => expect(getStudioLanes).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId("studio-cell")).toBeTruthy());
    expect(screen.queryByTestId("studio-pending-cell")).toBeNull();
  });

  it("does not refetch when the cancel took (the next poll tick is enough)", async () => {
    render(<StudioClient initialLanes={[lane({ pending: [pendingJob("job-1")] })]} />);

    fireEvent.click(screen.getByTestId("cancel-generation"));

    await waitFor(() => expect(cancelGeneration).toHaveBeenCalledWith("job-1"));
    expect(getStudioLanes).not.toHaveBeenCalled();
  });

  it("cancels only the tapped job when a lane has several pending", async () => {
    render(
      <StudioClient
        initialLanes={[lane({ pending: [pendingJob("job-1"), pendingJob("job-2")] })]}
      />
    );

    fireEvent.click(screen.getAllByTestId("cancel-generation")[1]);

    expect(screen.getAllByTestId("studio-pending-cell")).toHaveLength(1);
    await waitFor(() => expect(cancelGeneration).toHaveBeenCalledWith("job-2"));
    expect(cancelGeneration).toHaveBeenCalledTimes(1);
  });
});

describe("deleting a lane (slice 5 review, F1)", () => {
  it("Delete removes the lane and deletes the conversation", async () => {
    render(<StudioClient initialLanes={[lane()]} />);

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByTestId("studio-delete-lane"));
    await screen.findByTestId("confirm-sheet");
    fireEvent.click(screen.getByTestId("confirm-sheet-confirm"));

    await waitFor(() => expect(screen.queryByTestId("studio-lane")).toBeNull());
    await waitFor(() => expect(deleteDesign).toHaveBeenCalledWith("design-1"));
  });

  it("keeps the lane and shows the reason when the delete is refused", async () => {
    vi.mocked(deleteDesign).mockResolvedValueOnce({
      error: "This design is used by a shop product. Delete the product first.",
    });
    render(<StudioClient initialLanes={[lane()]} />);

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByTestId("studio-delete-lane"));
    await screen.findByTestId("confirm-sheet");
    fireEvent.click(screen.getByTestId("confirm-sheet-confirm"));

    await waitFor(() => expect(screen.getByTestId("studio-lane")).toBeTruthy());
    expect(screen.getByText(/used by a shop product/)).toBeTruthy();
  });

  it("does nothing when the confirm is dismissed", async () => {
    render(<StudioClient initialLanes={[lane()]} />);

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByTestId("studio-delete-lane"));
    const sheet = await screen.findByTestId("confirm-sheet");
    fireEvent.click(within(sheet).getByText("Cancel"));

    await waitFor(() => expect(screen.queryByTestId("confirm-sheet")).not.toBeInTheDocument());
    expect(screen.getByTestId("studio-lane")).toBeTruthy();
    expect(deleteDesign).not.toHaveBeenCalled();
  });

  it("offers no Delete while a generation is running", () => {
    render(<StudioClient initialLanes={[lane({ pending: [pendingJob("j1")] })]} />);
    expect(screen.queryByTestId("studio-delete-lane")).toBeNull();
  });
});

describe("select mode (#189)", () => {
  const three = () => [
    lane({ designId: "d1", title: "one", cells: [cell("img-1")] }),
    lane({ designId: "d2", title: "two", cells: [cell("img-2")] }),
    lane({ designId: "d3", title: "three" }),
  ];

  it("is offered only when there are lanes", () => {
    const { unmount } = render(<StudioClient initialLanes={[]} />);
    expect(screen.queryByRole("button", { name: "More" })).toBeNull();
    unmount();
    render(<StudioClient initialLanes={three()} />);
    fireEvent.click(screen.getAllByRole("button", { name: "More" })[0]);
    expect(screen.getByTestId("select-mode")).toBeTruthy();
  });

  it("entering select mode while the lightbox is open closes it (no focus trap, reachable by keyboard)", () => {
    render(<StudioClient initialLanes={three()} />);

    fireEvent.click(screen.getAllByTestId("studio-cell")[0]);
    expect(screen.getByTestId("image-lightbox")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "More" })[0]);
    fireEvent.click(screen.getByTestId("select-mode"));

    expect(screen.queryByTestId("image-lightbox")).toBeNull();
  });

  it("Select swaps the composer for the bar and shows a checkbox per lane", () => {
    render(<StudioClient initialLanes={three()} />);

    fireEvent.click(screen.getAllByRole("button", { name: "More" })[0]);
    fireEvent.click(screen.getByTestId("select-mode"));

    expect(screen.queryByTestId("studio-composer")).toBeNull();
    expect(screen.getByTestId("select-bar")).toBeTruthy();
    expect(screen.getAllByTestId("lane-checkbox")).toHaveLength(3);
    expect(screen.getByTestId("selected-count").textContent).toBe("0 selected");
    expect(
      (screen.getByTestId("bulk-delete") as HTMLButtonElement).disabled
    ).toBe(true);
    // The per-lane verbs step aside while selecting.
    expect(screen.queryByTestId("studio-delete-lane")).toBeNull();
    expect(screen.queryByTestId("studio-close-lane")).toBeNull();
  });

  it("checkbox, header tap and cell tap all toggle the lane; the count follows", () => {
    render(<StudioClient initialLanes={three()} />);
    fireEvent.click(screen.getAllByRole("button", { name: "More" })[0]);
    fireEvent.click(screen.getByTestId("select-mode"));

    fireEvent.click(screen.getAllByTestId("lane-checkbox")[0]);
    expect(screen.getByTestId("selected-count").textContent).toBe("1 selected");

    fireEvent.click(screen.getByText("two"));
    expect(screen.getByTestId("selected-count").textContent).toBe("2 selected");

    // A cell tap selects rather than anchors.
    fireEvent.click(screen.getAllByTestId("studio-cell")[0]);
    expect(screen.getByTestId("selected-count").textContent).toBe("1 selected");
    expect(screen.queryByTestId("anchor-chip")).toBeNull();
    expect(screen.queryByTestId("image-lightbox")).toBeNull();
  });

  it("Select all picks every selectable lane; a generating lane is left out", () => {
    render(
      <StudioClient
        initialLanes={[
          ...three(),
          lane({ designId: "d4", pending: [pendingJob("j")] }),
        ]}
      />
    );
    fireEvent.click(screen.getAllByRole("button", { name: "More" })[0]);
    fireEvent.click(screen.getByTestId("select-mode"));

    const boxes = screen.getAllByTestId("lane-checkbox") as HTMLInputElement[];
    expect(boxes[3].disabled).toBe(true);

    fireEvent.click(screen.getByTestId("select-all"));
    expect(screen.getByTestId("selected-count").textContent).toBe("3 selected");
    expect(boxes[3].checked).toBe(false);
  });

  it("Done and Escape leave select mode and clear the selection", () => {
    render(<StudioClient initialLanes={three()} />);

    fireEvent.click(screen.getAllByRole("button", { name: "More" })[0]);
    fireEvent.click(screen.getByTestId("select-mode"));
    fireEvent.click(screen.getAllByTestId("lane-checkbox")[0]);
    fireEvent.click(screen.getByTestId("select-done"));
    expect(screen.getByTestId("studio-composer")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "More" })[0]);
    fireEvent.click(screen.getByTestId("select-mode"));
    expect(screen.getByTestId("selected-count").textContent).toBe("0 selected");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("select-bar")).toBeNull();
  });

  it("Delete confirms once, calls the action with the ids, removes the lanes", async () => {
    // The refetch after the delete returns server truth: the survivor.
    h.polledLanes = [three()[1]];
    render(<StudioClient initialLanes={three()} />);
    fireEvent.click(screen.getAllByRole("button", { name: "More" })[0]);
    fireEvent.click(screen.getByTestId("select-mode"));
    fireEvent.click(screen.getAllByTestId("lane-checkbox")[0]);
    fireEvent.click(screen.getAllByTestId("lane-checkbox")[2]);

    fireEvent.click(screen.getByTestId("bulk-delete"));

    await screen.findByTestId("confirm-sheet");
    expect(screen.getByText("Delete 2 conversations?")).toBeTruthy();
    expect(
      screen.getByText(/This deletes their images too\./)
    ).toBeTruthy();
    fireEvent.click(screen.getByTestId("confirm-sheet-confirm"));

    await waitFor(() =>
      expect(deleteConversations).toHaveBeenCalledWith(["d1", "d3"])
    );
    await waitFor(() =>
      expect(screen.getAllByTestId("studio-lane")).toHaveLength(1)
    );
    expect(screen.getByText("two")).toBeTruthy();
    // Back to the composer once it's done.
    expect(screen.getByTestId("studio-composer")).toBeTruthy();
  });

  it("puts a kept lane back and says why", async () => {
    // A deferred promise the test controls: since confirm() is itself now
    // awaited, resolving deleteConversations immediately (as a plain mock
    // would) races the optimistic setLanes against the "final" state in the
    // same microtask flush and the intermediate state is never observable.
    // Holding it open lets the test assert the optimistic all-gone step
    // deterministically, then resolve and assert the corrected final state.
    let resolveDelete!: (result: BulkDeleteResult) => void;
    vi.mocked(deleteConversations).mockImplementationOnce(
      () =>
        new Promise<BulkDeleteResult>((resolve) => {
          resolveDelete = resolve;
        })
    );
    // d3 was deleted too in the mock's view; the server says d2 survives.
    h.polledLanes = [three()[1]];
    render(<StudioClient initialLanes={three()} />);
    fireEvent.click(screen.getAllByRole("button", { name: "More" })[0]);
    fireEvent.click(screen.getByTestId("select-mode"));
    fireEvent.click(screen.getByTestId("select-all"));

    fireEvent.click(screen.getByTestId("bulk-delete"));
    await screen.findByTestId("confirm-sheet");
    fireEvent.click(screen.getByTestId("confirm-sheet-confirm"));

    // Optimistically all three leave — this is the assertion that pins
    // bulkDelete's `setLanes(ls => ls.filter(...))` line, and it now holds
    // deterministically because deleteConversations hasn't resolved yet.
    await waitFor(() => expect(screen.queryByTestId("studio-lane")).toBeNull());

    resolveDelete({
      deleted: ["d1"],
      skipped: [{ id: "d2", reason: "ordered" }],
    });

    // …then the one the server kept comes back with a notice.
    await waitFor(() => expect(screen.getByText("two")).toBeTruthy());
    expect(screen.queryByText("one")).toBeNull();
    expect(screen.getByText("1 kept — it has an order.")).toBeTruthy();
  });

  it("restores everything when the action throws", async () => {
    vi.mocked(deleteConversations).mockRejectedValueOnce(new Error("boom"));
    render(<StudioClient initialLanes={three()} />);
    fireEvent.click(screen.getAllByRole("button", { name: "More" })[0]);
    fireEvent.click(screen.getByTestId("select-mode"));
    fireEvent.click(screen.getByTestId("select-all"));

    fireEvent.click(screen.getByTestId("bulk-delete"));
    await screen.findByTestId("confirm-sheet");
    fireEvent.click(screen.getByTestId("confirm-sheet-confirm"));

    await waitFor(() =>
      expect(screen.getAllByTestId("studio-lane")).toHaveLength(3)
    );
    expect(screen.getByText(/Couldn't delete those designs/)).toBeTruthy();
  });

  it("does nothing when the confirm is dismissed", async () => {
    render(<StudioClient initialLanes={three()} />);
    fireEvent.click(screen.getAllByRole("button", { name: "More" })[0]);
    fireEvent.click(screen.getByTestId("select-mode"));
    fireEvent.click(screen.getByTestId("select-all"));

    fireEvent.click(screen.getByTestId("bulk-delete"));
    const sheet = await screen.findByTestId("confirm-sheet");
    fireEvent.click(within(sheet).getByText("Cancel"));

    await waitFor(() => expect(screen.queryByTestId("confirm-sheet")).not.toBeInTheDocument());
    expect(deleteConversations).not.toHaveBeenCalled();
    expect(screen.getAllByTestId("studio-lane")).toHaveLength(3);
    expect(screen.getByTestId("select-bar")).toBeTruthy();
  });
});

/**
 * The pending cell must appear the instant Generate is pressed (#187 point
 * 2): before #187 nothing rendered until generateDesign returned and the
 * first poll landed. The overlay is applied at render time on top of server
 * lanes, so a poll's setLanes can never wipe it.
 */
describe("the optimistic pending cell (#187)", () => {
  /** Holds generateDesign open so the pre-resolution state is observable. */
  function deferGenerate() {
    let settle!: (result: unknown) => void;
    const pending = new Promise((resolve) => {
      settle = resolve;
    });
    vi.mocked(generateDesign).mockReturnValueOnce(pending as never);
    return settle;
  }

  function submitText(value: string) {
    fireEvent.change(screen.getByTestId("studio-composer"), {
      target: { value },
    });
    fireEvent.submit(screen.getByTestId("studio-composer").closest("form")!);
  }

  it("shows a pending cell before the action resolves, without Cancel", () => {
    deferGenerate();
    render(<StudioClient initialLanes={[lane({ cells: [cell("img-1")] })]} />);

    anchorCell(0);
    submitText("make it blue");

    const pending = screen.getByTestId("studio-pending-cell");
    expect(pending.textContent).toContain("Generating…");
    // No jobId yet, so nothing to cancel — same markup otherwise, so the cell
    // doesn't jump when Cancel appears.
    expect(screen.queryByTestId("cancel-generation")).toBeNull();
  });

  it("an unanchored submit shows a new lane at the top with the cell", () => {
    deferGenerate();
    render(<StudioClient initialLanes={[lane()]} />);

    submitText("a red dragon");

    const lanes = screen.getAllByTestId("studio-lane");
    expect(lanes).toHaveLength(2);
    expect(lanes[0].querySelector('[data-testid="studio-pending-cell"]')).toBeTruthy();
    expect(lanes[1].textContent).toContain("geometric wolf head");
  });

  it("titles the new lane with the prompt, not Untitled (#203)", () => {
    deferGenerate();
    render(<StudioClient initialLanes={[lane()]} />);

    submitText("big dogs don't jiggle");

    const lanes = screen.getAllByTestId("studio-lane");
    expect(within(lanes[0]).getByText("big dogs don't jiggle")).toBeTruthy();
    expect(within(lanes[0]).queryByText("Untitled")).toBeNull();
  });

  it("a poll landing while the action is in flight does not remove the cell", async () => {
    deferGenerate();
    // Server truth still knows nothing about the submit.
    h.polledLanes = [lane({ cells: [cell("img-1")] })];
    render(<StudioClient initialLanes={[lane({ cells: [cell("img-1")] })]} />);

    anchorCell(0);
    submitText("make it blue");

    fireEvent(window, new Event("focus"));
    await waitFor(() => expect(getStudioLanes).toHaveBeenCalled());

    expect(screen.getByTestId("studio-pending-cell")).toBeTruthy();
  });

  it("shows exactly one cell once the job is queued and a poll lists it", async () => {
    h.polledLanes = [
      lane({ cells: [cell("img-1")], pending: [pendingJob("job-new", 0)] }),
    ];
    render(<StudioClient initialLanes={[lane({ cells: [cell("img-1")] })]} />);

    anchorCell(0);
    submitText("make it blue");

    await waitFor(() => expect(getStudioLanes).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getAllByTestId("studio-pending-cell")).toHaveLength(1)
    );
    // The server row carries a real jobId, so Cancel is back.
    expect(screen.getByTestId("cancel-generation")).toBeTruthy();
    expect(screen.getAllByTestId("studio-lane")).toHaveLength(1);
  });

  it("removes the cell and gives the words back when the turn is refused", async () => {
    vi.mocked(generateDesign).mockResolvedValueOnce({
      kind: "limit",
      message: "You've reached today's free design limit. Sign in to keep designing.",
    });
    render(<StudioClient initialLanes={[lane()]} />);

    submitText("a red dragon");
    expect(screen.getByTestId("studio-pending-cell")).toBeTruthy();

    await waitFor(() =>
      expect(screen.queryByTestId("studio-pending-cell")).toBeNull()
    );
    expect(screen.getByText(/free design limit/)).toBeTruthy();
    expect(
      (screen.getByTestId("studio-composer") as HTMLInputElement).value
    ).toBe("a red dragon");
    // The synthetic lane goes with it.
    expect(screen.getAllByTestId("studio-lane")).toHaveLength(1);
  });

  it("removes the cell when the action throws and the reconcile window closes (#245)", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(generateDesign).mockRejectedValueOnce(new Error("boom"));
      render(<StudioClient initialLanes={[lane()]} />);

      submitText("a red dragon");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });

      expect(screen.queryByTestId("studio-pending-cell")).toBeNull();
      expect(screen.getByText(/Something went wrong/)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("counts the optimistic cell once — a queued job it can now see is not double-counted", async () => {
    // One server generation running + one submit = two of three.
    h.polledLanes = [
      lane({
        cells: [cell("img-1")],
        pending: [pendingJob("j1"), pendingJob("job-new", 0)],
      }),
    ];
    render(
      <StudioClient
        initialLanes={[lane({ cells: [cell("img-1")], pending: [pendingJob("j1")] })]}
      />
    );

    anchorCell(0);
    submitText("make it blue");

    await waitFor(() => expect(getStudioLanes).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getAllByTestId("studio-pending-cell")).toHaveLength(2)
    );
    // Were the settled entry still counted, this would read 3 and lock out.
    expect(screen.queryByTestId("cap-notice")).toBeNull();
    fireEvent.change(screen.getByTestId("studio-composer"), {
      target: { value: "one more" },
    });
    expect(
      (screen.getByTestId("studio-generate") as HTMLButtonElement).disabled
    ).toBe(false);
  });

  it("reaches the cap with two server generations and one in flight", () => {
    deferGenerate();
    render(
      <StudioClient
        initialLanes={[
          lane({
            cells: [cell("img-1")],
            pending: [pendingJob("j1"), pendingJob("j2")],
          }),
        ]}
      />
    );

    anchorCell(0);
    submitText("make it blue");

    expect(screen.getByTestId("cap-notice").textContent).toContain("3 generating");
    expect(
      (screen.getByTestId("studio-generate") as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it("a lane with only an optimistic cell is not selectable", () => {
    deferGenerate();
    // A second, idle lane is needed to reach Select at all here (Paper bench,
    // #188 slice 3): the moment the submit below lands its optimistic cell,
    // the ONLY other lane's own ⋯ overflow disappears too (generating hides
    // it), and there is no longer a page-level Select control to fall back
    // on — this is a real consequence of the redesign, not a test artifact.
    render(
      <StudioClient
        initialLanes={[
          lane({ cells: [cell("img-1")] }),
          lane({ designId: "design-2", title: "other", cells: [cell("img-2")] }),
        ]}
      />
    );

    anchorCell(0);
    submitText("make it blue");
    // The generating lane's own trigger is gone; the idle second lane's is
    // the only door left into select mode.
    fireEvent.click(screen.getAllByRole("button", { name: "More" })[0]);
    fireEvent.click(screen.getByTestId("select-mode"));

    const box = screen.getAllByTestId("lane-checkbox")[0] as HTMLInputElement;
    expect(box.disabled).toBe(true);
    fireEvent.click(screen.getByTestId("select-all"));
    // Only the idle second lane is selectable; the generating lane's own
    // checkbox stays unchecked either way — that's the invariant this test
    // pins.
    expect(screen.getByTestId("selected-count").textContent).toBe("1 selected");
    expect(box.checked).toBe(false);
  });

  it("leaves the anchor where the user put it across the submit", () => {
    deferGenerate();
    render(<StudioClient initialLanes={[lane({ cells: [cell("img-1")] })]} />);

    anchorCell(0);
    submitText("make it blue");

    expect(screen.getByTestId("anchor-chip")).toBeTruthy();
  });
});

/** Fixes from the task-2 review round. */
describe("the optimistic pending cell — review fixes (#187)", () => {
  function deferGenerate() {
    let settle!: (result: unknown) => void;
    const pending = new Promise((resolve) => {
      settle = resolve;
    });
    vi.mocked(generateDesign).mockReturnValueOnce(pending as never);
    return settle;
  }

  function submitText(value: string) {
    fireEvent.change(screen.getByTestId("studio-composer"), {
      target: { value },
    });
    fireEvent.submit(screen.getByTestId("studio-composer").closest("form")!);
  }

  it("survives a poll whose fetch began before the job row was written, and keeps polling", async () => {
    vi.useFakeTimers();
    try {
      const settleGenerate = deferGenerate();
      let settlePoll!: (lanes: unknown) => void;
      vi.mocked(getStudioLanes).mockReturnValueOnce(
        new Promise((resolve) => {
          settlePoll = resolve as never;
        }) as never
      );

      render(<StudioClient initialLanes={[lane({ cells: [cell("img-1")] })]} />);
      anchorCell(0);
      submitText("make it blue");

      // The timer poll goes out while generateDesign is still in flight.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(getStudioLanes).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      // Now the action resolves; its own pollOnce is a no-op, one is running.
      await act(async () => {
        settleGenerate({
          kind: "queued",
          jobId: "job-new",
          generationNumber: 1,
          imageId: "img-new",
        });
        await Promise.resolve();
      });

      // The in-flight fetch lands, blind to a row written after it went out.
      await act(async () => {
        settlePoll([lane({ cells: [cell("img-1")] })]);
        await Promise.resolve();
      });

      expect(screen.getByTestId("studio-pending-cell")).toBeTruthy();

      // And the loop is still armed — the cell isn't stranded until a wake.
      h.polledLanes = [lane({ cells: [cell("img-1")] })];
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(getStudioLanes).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a cell submitted during a lane close that then fails", async () => {
    let failClose!: () => void;
    vi.mocked(closeConversation).mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        failClose = () => reject(new Error("boom"));
      }) as never
    );
    deferGenerate();
    render(<StudioClient initialLanes={[lane()]} />);

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByTestId("studio-close-lane"));
    submitText("a red dragon");
    expect(screen.getByTestId("studio-pending-cell")).toBeTruthy();

    // The close fails and puts its lane back — without erasing the entry that
    // arrived while it was in flight.
    failClose();
    await waitFor(() =>
      expect(screen.getByText(/Couldn't close that design/)).toBeTruthy()
    );
    expect(screen.getByTestId("studio-pending-cell")).toBeTruthy();
  });

  it("reserves the Cancel space so the cell doesn't jump when the jobId lands", () => {
    deferGenerate();
    render(<StudioClient initialLanes={[lane({ cells: [cell("img-1")] })]} />);

    anchorCell(0);
    submitText("make it blue");

    expect(screen.queryByTestId("cancel-generation")).toBeNull();
    const placeholder = screen.getByTestId("cancel-generation-placeholder");
    expect((placeholder as HTMLButtonElement).disabled).toBe(true);
    expect(placeholder.className).toContain("invisible");
  });

  it("cancels an optimistic cell that has its real jobId (the #194 path)", async () => {
    // The submit's own poll finds no lane for this design yet, so the entry
    // survives with a real jobId — the cell is still the overlay's, and its
    // Cancel has to reach the real job.
    h.polledLanes = [];
    render(<StudioClient initialLanes={[]} />);

    submitText("a red dragon");
    await waitFor(() => expect(getStudioLanes).toHaveBeenCalledTimes(1));
    const cancel = await screen.findByTestId("cancel-generation");

    fireEvent.click(cancel);

    await waitFor(() =>
      expect(cancelGeneration).toHaveBeenCalledWith("job-new")
    );
    expect(screen.queryByTestId("studio-pending-cell")).toBeNull();
    // The synthetic lane had nothing else in it, so it goes too.
    expect(screen.queryByTestId("studio-lane")).toBeNull();
    // cancelGeneration returned true: the next poll tick is enough.
    expect(getStudioLanes).toHaveBeenCalledTimes(1);
  });

  it("scrolls the new lane into view on an unanchored submit", () => {
    deferGenerate();
    render(<StudioClient initialLanes={[lane()]} />);

    submitText("a red dragon");

    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
  });
});

/**
 * #204: the after() idle-archive sweep doesn't self-correct client-side the
 * way a pending job does (the periodic loop only runs while something is
 * pending/optimistic). A one-shot mount reconcile closes that gap for the
 * "returned after days away" case without starting the polling loop.
 */
describe("mount-time reconcile (#204)", () => {
  it("drops a lane the server closed while the tab was away, without starting the polling loop", async () => {
    vi.useFakeTimers();
    try {
      const staying = lane({ designId: "design-1", title: "staying" });
      const closing = lane({ designId: "design-2", title: "closing" });
      // Server truth minus one lane — as if the after() sweep archived
      // "closing" between this tab's last read and now.
      h.polledLanes = [staying];

      render(<StudioClient initialLanes={[staying, closing]} />);
      expect(screen.getAllByTestId("studio-lane")).toHaveLength(2);
      expect(getStudioLanes).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });

      expect(getStudioLanes).toHaveBeenCalledTimes(1);
      expect(screen.getAllByTestId("studio-lane")).toHaveLength(1);
      expect(screen.getByText("staying")).toBeTruthy();

      // Nothing is pending, so the reconcile must not have armed the
      // periodic loop — well past its fast cadence (2s), still one call.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(getStudioLanes).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips the reconcile call when the polling loop is already active", async () => {
    vi.useFakeTimers();
    try {
      // A pending cell makes the periodic loop active immediately on mount,
      // so the one-shot reconcile at 1500ms should see activeRef.current
      // true and do nothing — the periodic loop's own tick covers it.
      h.polledLanes = [lane({ pending: [pendingJob("job-1")] })];
      render(
        <StudioClient
          initialLanes={[lane({ pending: [pendingJob("job-1")] })]}
        />
      );

      // The periodic loop's first tick (fast cadence, 2s) is the only call
      // inside this window — the 1500ms mount timer fires first but is a
      // no-op while active.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(getStudioLanes).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("lane overflow menu keyboard + focus (WAI-ARIA menu button)", () => {
  function openMenu() {
    render(
      <StudioClient
        initialLanes={[lane({ cells: [cell("a"), cell("b")] })]}
      />
    );
    const trigger = screen.getByRole("button", { name: "More" });
    fireEvent.click(trigger);
    return { trigger, panel: screen.getByRole("menu") };
  }

  it("moves focus to the first item when the menu opens", () => {
    openMenu();
    expect(document.activeElement).toBe(screen.getByTestId("studio-close-lane"));
  });

  it("gives the focused item the only tabIndex of 0", () => {
    openMenu();
    expect(screen.getByTestId("studio-close-lane").getAttribute("tabindex")).toBe("0");
    expect(screen.getByTestId("studio-delete-lane").getAttribute("tabindex")).toBe("-1");
    expect(screen.getByTestId("select-mode").getAttribute("tabindex")).toBe("-1");
  });

  it("ArrowDown walks the items and wraps to the first", () => {
    const { panel } = openMenu();
    fireEvent.keyDown(panel, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByTestId("studio-delete-lane"));
    fireEvent.keyDown(panel, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByTestId("select-mode"));
    fireEvent.keyDown(panel, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByTestId("studio-close-lane"));
  });

  it("ArrowUp from the first item wraps to the last", () => {
    const { panel } = openMenu();
    fireEvent.keyDown(panel, { key: "ArrowUp" });
    expect(document.activeElement).toBe(screen.getByTestId("select-mode"));
  });

  it("Home and End jump to the first and last item", () => {
    const { panel } = openMenu();
    fireEvent.keyDown(panel, { key: "End" });
    expect(document.activeElement).toBe(screen.getByTestId("select-mode"));
    fireEvent.keyDown(panel, { key: "Home" });
    expect(document.activeElement).toBe(screen.getByTestId("studio-close-lane"));
  });

  it("Escape closes the menu and returns focus to the trigger", () => {
    const { trigger } = openMenu();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("Tab closes the menu without stealing focus back to the trigger", () => {
    const { panel, trigger } = openMenu();
    fireEvent.keyDown(panel, { key: "Tab" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).not.toBe(trigger);
  });

  it("an outside click closes the menu without pulling focus back to the trigger", () => {
    const { trigger } = openMenu();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).not.toBe(trigger);
  });

  it("still closes on Escape when a second lane's menu is the open one", () => {
    render(
      <StudioClient
        initialLanes={[
          lane({ designId: "design-1", cells: [cell("a")] }),
          lane({ designId: "design-2", title: "second", cells: [cell("c")] }),
        ]}
      />
    );
    const triggers = screen.getAllByRole("button", { name: "More" });
    fireEvent.click(triggers[1]);
    expect(document.activeElement).toBe(screen.getByTestId("studio-close-lane"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(triggers[1]);
  });
});

describe("lane overflow menu placement (flip-up near the fold)", () => {
  const realInnerHeight = window.innerHeight;
  const realRect = window.HTMLElement.prototype.getBoundingClientRect;

  function stubGeometry({ triggerBottom }: { triggerBottom: number }) {
    window.HTMLElement.prototype.getBoundingClientRect = function (
      this: HTMLElement
    ) {
      const menu = this.getAttribute("role") === "menu";
      const height = menu ? 132 : 44;
      const bottom = menu ? triggerBottom + height : triggerBottom;
      return {
        x: 0,
        y: bottom - height,
        top: bottom - height,
        left: 0,
        right: 144,
        bottom,
        width: 144,
        height,
        toJSON: () => ({}),
      } as DOMRect;
    };
  }

  afterEach(() => {
    window.HTMLElement.prototype.getBoundingClientRect = realRect;
    Object.defineProperty(window, "innerHeight", {
      value: realInnerHeight,
      configurable: true,
      writable: true,
    });
  });

  function renderAndOpen() {
    render(<StudioClient initialLanes={[lane({ cells: [cell("a")] })]} />);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    return screen.getByRole("menu");
  }

  it("opens below the trigger when there is room", () => {
    Object.defineProperty(window, "innerHeight", {
      value: 800,
      configurable: true,
      writable: true,
    });
    stubGeometry({ triggerBottom: 200 });
    const panel = renderAndOpen();
    expect(panel.className).toContain("top-full");
    expect(panel.className).not.toContain("bottom-full");
  });

  it("flips above the trigger when the panel would fall below the fold", () => {
    Object.defineProperty(window, "innerHeight", {
      value: 800,
      configurable: true,
      writable: true,
    });
    stubGeometry({ triggerBottom: 760 });
    const panel = renderAndOpen();
    expect(panel.className).toContain("bottom-full");
    expect(panel.className).not.toContain("top-full");
  });

  it("re-measures on each open rather than staying flipped", () => {
    Object.defineProperty(window, "innerHeight", {
      value: 800,
      configurable: true,
      writable: true,
    });
    stubGeometry({ triggerBottom: 760 });
    const trigger = (() => {
      render(<StudioClient initialLanes={[lane({ cells: [cell("a")] })]} />);
      return screen.getByRole("button", { name: "More" });
    })();
    fireEvent.click(trigger);
    expect(screen.getByRole("menu").className).toContain("bottom-full");
    fireEvent.click(trigger);
    stubGeometry({ triggerBottom: 100 });
    fireEvent.click(trigger);
    expect(screen.getByRole("menu").className).toContain("top-full");
  });
});

describe("StudioClient — guest line (#241)", () => {
  it("shows the sign-up/sign-in line to a guest with a lane", () => {
    render(<StudioClient initialLanes={[lane()]} isGuest />);
    expect(screen.getByTestId("guest-keep-line").textContent).toBe(
      "Sign up to keep these designs. Have an account? Sign in."
    );
  });

  it("hides it on a guest's empty bench, where there is nothing to keep", () => {
    render(<StudioClient initialLanes={[]} isGuest />);
    expect(screen.getByText("No open designs.")).toBeTruthy();
    expect(screen.queryByTestId("guest-keep-line")).toBeNull();
  });

  it("shows it as soon as a guest's first lane appears on an empty bench", async () => {
    render(<StudioClient initialLanes={[]} isGuest />);

    fireEvent.change(screen.getByTestId("studio-composer"), {
      target: { value: "a red dragon" },
    });
    fireEvent.submit(screen.getByTestId("studio-composer").closest("form")!);

    // The optimistic lane is on screen before the server has answered.
    const line = await screen.findByTestId("guest-keep-line");
    // And it appeared BELOW the composer, so the composer did not move.
    expect(
      screen.getByTestId("studio-composer-panel").compareDocumentPosition(line) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("sits between the composer and the lanes, so coming and going never moves the composer", () => {
    render(<StudioClient initialLanes={[lane()]} isGuest />);
    const panel = screen.getByTestId("studio-composer-panel");
    const line = screen.getByTestId("guest-keep-line");
    const firstLane = screen.getAllByTestId("studio-lane")[0];

    expect(
      panel.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      line.compareDocumentPosition(firstLane) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    // Not inside the composer panel either — it is not part of the control.
    expect(panel.contains(line)).toBe(false);
  });

  it("hides with the composer in select mode and returns on Done", () => {
    render(<StudioClient initialLanes={[lane({ cells: [cell("a")] })]} isGuest />);
    expect(screen.getByTestId("guest-keep-line")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByTestId("select-mode"));
    expect(screen.queryByTestId("studio-composer-panel")).toBeNull();
    expect(screen.queryByTestId("guest-keep-line")).toBeNull();

    fireEvent.click(screen.getByTestId("select-done"));
    expect(screen.getByTestId("guest-keep-line")).toBeTruthy();
  });

  it("never shows it to a real account", () => {
    render(<StudioClient initialLanes={[lane()]} />);
    expect(screen.queryByTestId("guest-keep-line")).toBeNull();
  });
});

/**
 * #245: generateDesign can throw after the server accepted the request (a lost
 * response, prod 2026-09-25 ERR_NETWORK_CHANGED). The cell stays for a
 * reconcile window while the poll loop's snapshots are judged, so a submit
 * that landed is not reported as a failure and no snapshot shows the server's
 * cell beside the overlay's. Everything here runs on fake timers: the window
 * is 20 s.
 */
describe("a lost Generate response (#245)", () => {
  const FAILED = /Something went wrong/;
  const WINDOW_MS = 20_000;
  const GRACE_MS = 5_000;

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    // Back to the module mocks' own implementations.
    vi.mocked(getStudioLanes).mockReset();
    vi.mocked(generateDesign).mockReset();
  });

  function submitText(value: string) {
    fireEvent.change(screen.getByTestId("studio-composer"), {
      target: { value },
    });
    fireEvent.submit(screen.getByTestId("studio-composer").closest("form")!);
  }

  function composerValue() {
    return (screen.getByTestId("studio-composer") as HTMLInputElement).value;
  }

  function pendingCount() {
    return screen.queryAllByTestId("studio-pending-cell").length;
  }

  async function advance(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  /** The design id the client sent to generateDesign on its nth call. */
  function sentId(n = 0) {
    return vi.mocked(generateDesign).mock.calls[n][0];
  }

  /** The next generateDesign call hangs until the returned function rejects it. */
  function holdGenerate() {
    let rejectIt!: (err: Error) => void;
    vi.mocked(generateDesign).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectIt = reject;
        }) as never
    );
    return async () => {
      await act(async () => {
        rejectIt(new Error("net::ERR_NETWORK_CHANGED"));
      });
    };
  }

  /** The next getStudioLanes call hangs until the returned function settles it. */
  function holdRead() {
    let settle!: (lanes: unknown) => void;
    vi.mocked(getStudioLanes).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }) as never
    );
    return async (lanes: unknown) => {
      await act(async () => {
        settle(lanes);
      });
    };
  }

  /** Renders with a Profiler that records the pending-cell count at every commit. */
  function renderCounting(initialLanes: StudioLane[]) {
    const counts: number[] = [];
    render(
      <Profiler id="studio" onRender={() => counts.push(pendingCount())}>
        <StudioClient initialLanes={initialLanes} />
      </Profiler>
    );
    return counts;
  }

  it("1. unanchored: a poll queued behind the call resolves with the job — one pending cell at every commit, no notice", async () => {
    const counts = renderCounting([lane()]);
    const rejectGenerate = holdGenerate();
    const finishRead = holdRead();

    submitText("a red dragon");
    // The loop's first poll goes out at 2 s and, on the real client, waits
    // behind the running generateDesign call.
    await advance(2000);
    await advance(500);
    await rejectGenerate();
    expect(pendingCount()).toBe(1);
    expect(screen.queryByText(FAILED)).toBeNull();

    // The queued poll's snapshot was fetched after the server finished.
    const id = sentId();
    await finishRead([
      lane({ designId: id, pending: [pendingJob("job-x", 0)] }),
      lane(),
    ]);

    expect(pendingCount()).toBe(1);
    expect(screen.getByTestId("cancel-generation")).toBeTruthy();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(composerValue()).toBe("");
    expect(screen.getAllByTestId("studio-lane")).toHaveLength(2);
    // Never two cells at any commit, including the one that decided.
    expect(Math.max(...counts)).toBe(1);
  });

  it("2. unanchored: a snapshot with no lane keeps the cell and says nothing; a later one with the job lands it", async () => {
    h.polledLanes = [lane()];
    vi.mocked(generateDesign).mockRejectedValueOnce(new Error("boom"));
    const counts = renderCounting([lane()]);

    submitText("a red dragon");
    await advance(0);
    expect(pendingCount()).toBe(1);
    expect(screen.queryByText(FAILED)).toBeNull();

    await advance(6000);
    expect(pendingCount()).toBe(1);
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(composerValue()).toBe("");

    h.polledLanes = [
      lane({ designId: sentId(), pending: [pendingJob("job-x", 0)] }),
      lane(),
    ];
    await advance(2000);

    expect(pendingCount()).toBe(1);
    expect(screen.getByTestId("cancel-generation")).toBeTruthy();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(composerValue()).toBe("");
    expect(Math.max(...counts)).toBe(1);
  });

  it("3. unanchored: no lane through the window fails at the deadline, and one last poll goes out", async () => {
    h.polledLanes = [lane()];
    // Reads take 300 ms, so the loop's polls never start exactly at the
    // deadline and the poll counted below is the deadline's own.
    vi.mocked(getStudioLanes).mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(h.polledLanes as never), 300);
        }) as never
    );
    vi.mocked(generateDesign).mockRejectedValueOnce(new Error("boom"));
    render(<StudioClient initialLanes={[lane()]} />);

    submitText("a red dragon");
    await advance(WINDOW_MS - 1);
    expect(pendingCount()).toBe(1);
    expect(screen.queryByText(FAILED)).toBeNull();
    const readsBefore = vi.mocked(getStudioLanes).mock.calls.length;

    await advance(1);

    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(composerValue()).toBe("a red dragon");
    expect(pendingCount()).toBe(0);
    expect(screen.getAllByTestId("studio-lane")).toHaveLength(1);
    expect(vi.mocked(getStudioLanes).mock.calls.length).toBe(readsBefore + 1);
  });

  it("4a. unanchored: an empty lane waits, then the job appears and it lands", async () => {
    vi.mocked(generateDesign).mockRejectedValueOnce(new Error("boom"));
    render(<StudioClient initialLanes={[]} />);
    // The design row is written; the job row is not, yet.
    vi.mocked(getStudioLanes).mockImplementation(async () => {
      return [lane({ designId: sentId(), title: null })] as never;
    });

    submitText("a red dragon");
    await advance(6000);
    expect(pendingCount()).toBe(1);
    expect(screen.queryByText(FAILED)).toBeNull();

    h.polledLanes = [
      lane({
        designId: sentId(),
        title: null,
        pending: [pendingJob("job-x", 0)],
      }),
    ];
    vi.mocked(getStudioLanes).mockImplementation(
      async () => h.polledLanes as never
    );
    await advance(2000);

    expect(pendingCount()).toBe(1);
    expect(screen.getByTestId("cancel-generation")).toBeTruthy();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(composerValue()).toBe("");
  });

  it("4b. unanchored: an empty lane through the whole window is a failure at the deadline", async () => {
    vi.mocked(generateDesign).mockRejectedValueOnce(new Error("boom"));
    vi.mocked(getStudioLanes).mockImplementation(
      async () => [lane({ designId: sentId(), title: null })] as never
    );
    render(<StudioClient initialLanes={[]} />);

    submitText("a red dragon");
    await advance(WINDOW_MS - 1);
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(pendingCount()).toBe(1);

    await advance(1);

    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(composerValue()).toBe("a red dragon");
    expect(pendingCount()).toBe(0);
  });

  it("5. anchored: a new job in the anchored lane lands it, keeps the anchor and empties the composer", async () => {
    h.polledLanes = [
      lane({ cells: [cell("img-1")], pending: [pendingJob("job-new", 0)] }),
    ];
    vi.mocked(generateDesign).mockRejectedValueOnce(new Error("boom"));
    render(<StudioClient initialLanes={[lane({ cells: [cell("img-1")] })]} />);

    anchorCell(0);
    submitText("make it blue");
    await advance(0);

    expect(pendingCount()).toBe(1);
    expect(screen.getByTestId("cancel-generation")).toBeTruthy();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(composerValue()).toBe("");
    expect(screen.getByTestId("anchor-chip")).toBeTruthy();
  });

  it("6. anchored: only the pre-existing job through the window is a failure at the deadline", async () => {
    const existing = () =>
      lane({ cells: [cell("img-1")], pending: [pendingJob("job-old")] });
    h.polledLanes = [existing()];
    vi.mocked(generateDesign).mockRejectedValueOnce(new Error("boom"));
    render(<StudioClient initialLanes={[existing()]} />);

    anchorCell(0);
    submitText("make it blue");
    await advance(WINDOW_MS - 1);
    // The old job's cell and this submit's, and no verdict yet.
    expect(pendingCount()).toBe(2);
    expect(screen.queryByText(FAILED)).toBeNull();

    await advance(1);

    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(composerValue()).toBe("make it blue");
    expect(pendingCount()).toBe(1);
  });

  it("7. #204: an anchored lane that is gone fails at once — notice, words back, lane gone, anchor cleared", async () => {
    h.polledLanes = []; // the sweep closed the lane
    vi.mocked(generateDesign).mockRejectedValueOnce(new Error("closed"));
    render(<StudioClient initialLanes={[lane({ cells: [cell("img-1")] })]} />);

    anchorCell(0);
    submitText("make it blue");
    // No time passes: the window does not apply to a lane that is gone.
    await advance(0);

    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(composerValue()).toBe("make it blue");
    expect(screen.queryByTestId("studio-lane")).toBeNull();
    expect(screen.queryByTestId("anchor-chip")).toBeNull();
    expect(pendingCount()).toBe(0);
  });

  it("8. every read fails: the cell stays through the window, then it is a failure", async () => {
    vi.mocked(getStudioLanes).mockRejectedValue(new Error("offline"));
    vi.mocked(generateDesign).mockRejectedValueOnce(new Error("boom"));
    render(<StudioClient initialLanes={[lane()]} />);

    submitText("a red dragon");
    await advance(WINDOW_MS - 1);
    expect(pendingCount()).toBe(1);
    expect(screen.queryByText(FAILED)).toBeNull();
    const readsBefore = vi.mocked(getStudioLanes).mock.calls.length;

    await advance(1);

    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(composerValue()).toBe("a red dragon");
    expect(pendingCount()).toBe(0);
    // The loop halted on its error budget; the deadline still asks once more.
    expect(vi.mocked(getStudioLanes).mock.calls.length).toBe(readsBefore + 1);
  });

  it("9. words typed during the window survive a failure", async () => {
    h.polledLanes = [lane()];
    vi.mocked(generateDesign).mockRejectedValueOnce(new Error("boom"));
    render(<StudioClient initialLanes={[lane()]} />);

    submitText("a red dragon");
    await advance(1000);
    fireEvent.change(screen.getByTestId("studio-composer"), {
      target: { value: "a blue whale" },
    });
    await advance(WINDOW_MS);

    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(composerValue()).toBe("a blue whale");
    expect(pendingCount()).toBe(0);
  });

  it("10. concurrent same-lane: B's queued job is not A's, so A fails at its deadline", async () => {
    const rejectA = holdGenerate();
    vi.mocked(generateDesign).mockResolvedValueOnce({
      kind: "queued",
      jobId: "job-b",
      generationNumber: 2,
      imageId: "img-b",
    } as never);
    // The server holds only B's job.
    h.polledLanes = [
      lane({ cells: [cell("img-1")], pending: [pendingJob("job-b", 0)] }),
    ];
    render(<StudioClient initialLanes={[lane({ cells: [cell("img-1")] })]} />);

    anchorCell(0);
    submitText("make it blue"); // A
    submitText("make it green"); // B, same lane: the anchor stays
    await advance(0);
    await rejectA();
    await advance(WINDOW_MS - 1);
    // A's cell and B's job.
    expect(pendingCount()).toBe(2);
    expect(screen.queryByText(FAILED)).toBeNull();

    await advance(1);

    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(composerValue()).toBe("make it blue");
    expect(pendingCount()).toBe(1);
    expect(screen.getByTestId("cancel-generation")).toBeTruthy();
  });

  it("11. both A and B lost into one lane, one new job visible: neither lands on it, both fail by their deadlines", async () => {
    const rejectA = holdGenerate();
    const rejectB = holdGenerate();
    h.polledLanes = [
      lane({ cells: [cell("img-1")], pending: [pendingJob("job-x", 0)] }),
    ];
    render(<StudioClient initialLanes={[lane({ cells: [cell("img-1")] })]} />);

    anchorCell(0);
    submitText("make it blue"); // A
    submitText("make it green"); // B
    await advance(0);
    await rejectA();
    await advance(1000);
    await rejectB();
    // Inside both windows: the one job cannot settle either, so both cells
    // and job-x are on screen.
    await advance(WINDOW_MS - 1000 - 1);
    expect(pendingCount()).toBe(3);
    expect(screen.queryByText(FAILED)).toBeNull();

    // A's deadline: A fails and disowns job-x.
    await advance(1);
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(composerValue()).toBe("make it blue");
    expect(pendingCount()).toBe(2);

    // B does not take the job A gave up on.
    await advance(999);
    expect(pendingCount()).toBe(2);
    await advance(1);
    expect(pendingCount()).toBe(1);
    expect(screen.getByTestId("cancel-generation")).toBeTruthy();
  });

  it("12. a claimed job pending at A's submit that finishes, plus A's own job finishing, is A landed", async () => {
    vi.mocked(generateDesign).mockResolvedValueOnce({
      kind: "queued",
      jobId: "job-b",
      generationNumber: 2,
      imageId: "img-b",
    } as never);
    // B's job is running when the tab reads the surface.
    h.polledLanes = [
      lane({ cells: [cell("img-1")], pending: [pendingJob("job-b", 0)] }),
    ];
    render(<StudioClient initialLanes={[lane({ cells: [cell("img-1")] })]} />);

    anchorCell(0);
    submitText("make it green"); // B, queued
    await advance(0);
    expect(screen.getByTestId("cancel-generation")).toBeTruthy();

    const rejectA = holdGenerate();
    submitText("make it blue"); // A, with job-b in its baseline
    await advance(0);
    // Both jobs finish; nothing is pending.
    h.polledLanes = [
      lane({ cells: [cell("img-1"), cell("img-b"), cell("img-a")] }),
    ];
    await rejectA();
    await advance(2000);

    expect(screen.queryByText(FAILED)).toBeNull();
    expect(composerValue()).toBe("");
    expect(pendingCount()).toBe(0);
    expect(screen.getAllByTestId("studio-cell")).toHaveLength(3);
  });

  it("13. a submit fired after a snapshot was requested is not counted against an earlier lost submit", async () => {
    const rejectA = holdGenerate();
    const finishRead = holdRead();
    render(<StudioClient initialLanes={[lane({ cells: [cell("img-1")] })]} />);

    anchorCell(0);
    submitText("make it blue"); // A
    // The poll at 2 s is the snapshot A will be judged by.
    await advance(2000);
    await advance(200);
    holdGenerate();
    submitText("make it green"); // B, fired after that snapshot was requested
    await advance(100);
    await rejectA();
    expect(pendingCount()).toBe(2);

    // The snapshot shows one new job, which is A's: B could not be in it.
    await finishRead([
      lane({ cells: [cell("img-1")], pending: [pendingJob("job-a", 0)] }),
    ]);

    expect(screen.queryByText(FAILED)).toBeNull();
    // job-a as the server's cell, and B's cell still waiting on its response.
    expect(pendingCount()).toBe(2);
    expect(screen.getAllByTestId("cancel-generation")).toHaveLength(1);
  });

  it("14. A lands on S; B, fired after S was requested, is then lost: B must not land on A's job", async () => {
    const rejectA = holdGenerate();
    const finishRead = holdRead();
    render(<StudioClient initialLanes={[lane({ cells: [cell("img-1")] })]} />);

    anchorCell(0);
    submitText("make it blue"); // A
    await advance(2000);
    await advance(200); // S is requested and hangs
    const rejectB = holdGenerate();
    submitText("make it green"); // B: fired after S, baseline lacks job-a
    await advance(100);
    await rejectA();
    // S shows job-a: A lands, and claims it.
    h.polledLanes = [
      lane({ cells: [cell("img-1")], pending: [pendingJob("job-a", 0)] }),
    ];
    await finishRead(h.polledLanes);
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(pendingCount()).toBe(2);

    await rejectB();
    // The next snapshots still show only job-a: B has no work of its own.
    await advance(WINDOW_MS - 1000);
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(pendingCount()).toBe(2);
    await advance(1000);

    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(composerValue()).toBe("make it green");
    expect(pendingCount()).toBe(1);
  });

  it("15. a poll started before the deadline that resolves after it with the job lands, and no failure is ever shown", async () => {
    const finishRead = holdRead();
    vi.mocked(generateDesign).mockRejectedValueOnce(new Error("boom"));
    render(<StudioClient initialLanes={[lane()]} />);

    submitText("a red dragon");
    // The catch's own poll is the one in flight and stays there.
    await advance(WINDOW_MS + 2000);
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(pendingCount()).toBe(1);

    await finishRead([
      lane({ designId: sentId(), pending: [pendingJob("job-x", 0)] }),
      lane(),
    ]);
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(pendingCount()).toBe(1);
    expect(screen.getByTestId("cancel-generation")).toBeTruthy();

    await advance(GRACE_MS + 5000);
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(composerValue()).toBe("");
  });

  it("16. a poll in flight at the deadline that never settles fails at the deadline plus the grace", async () => {
    holdRead();
    vi.mocked(generateDesign).mockRejectedValueOnce(new Error("boom"));
    render(<StudioClient initialLanes={[lane()]} />);

    submitText("a red dragon");
    await advance(WINDOW_MS + GRACE_MS - 1);
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(pendingCount()).toBe(1);

    await advance(1);

    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(composerValue()).toBe("a red dragon");
    expect(pendingCount()).toBe(0);
  });

  it("17. a poll in flight at the deadline that then fails decides the entry as failed", async () => {
    let failRead!: (err: Error) => void;
    vi.mocked(getStudioLanes).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          failRead = reject;
        }) as never
    );
    vi.mocked(generateDesign).mockRejectedValueOnce(new Error("boom"));
    render(<StudioClient initialLanes={[lane()]} />);

    submitText("a red dragon");
    await advance(WINDOW_MS + 1000);
    expect(screen.queryByText(FAILED)).toBeNull();

    await act(async () => {
      failRead(new Error("offline"));
    });

    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(composerValue()).toBe("a red dragon");
    expect(pendingCount()).toBe(0);
  });

  it("18. a snapshot decides an entry and the deadline timer then reaches it: one notice, words restored once", async () => {
    h.polledLanes = []; // the lane closed elsewhere: failed at once (#204)
    vi.mocked(generateDesign).mockRejectedValueOnce(new Error("boom"));
    render(<StudioClient initialLanes={[lane({ cells: [cell("img-1")] })]} />);

    anchorCell(0);
    submitText("make it blue");
    await advance(0);
    expect(screen.getAllByText(FAILED)).toHaveLength(1);
    expect(composerValue()).toBe("make it blue");

    // The user clears the box; a second decision would put the words back.
    fireEvent.change(screen.getByTestId("studio-composer"), {
      target: { value: "" },
    });
    await advance(WINDOW_MS + GRACE_MS);

    expect(screen.getAllByText(FAILED)).toHaveLength(1);
    expect(composerValue()).toBe("");
    expect(pendingCount()).toBe(0);
  });
});
