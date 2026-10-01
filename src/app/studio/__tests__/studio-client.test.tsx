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
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import { StudioClient } from "../studio-client";
import type { StudioLane } from "@/lib/studio";
import type { BulkDeleteResult } from "@/lib/studio-view";
import {
  LOST_SUBMIT_ERROR_ATTEMPTS,
  LOST_SUBMIT_LOOKUP_INTERVAL_MS,
  LOST_SUBMIT_LOOKUP_TIMEOUT_MS,
} from "@/lib/lost-submit";

const h = vi.hoisted(() => ({
  polledLanes: [] as unknown[],
}));

vi.mock("../actions", () => ({
  getStudioLanes: vi.fn(async () => h.polledLanes),
  deleteConversations: vi.fn(async (ids: string[]) => ({
    deleted: ids,
    skipped: [],
  })),
  getGenerationJobStatus: vi.fn(async () => ({ status: "none" })),
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

import {
  deleteConversations,
  getGenerationJobStatus,
  getStudioLanes,
} from "../actions";
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
    h.polledLanes = [lane({ cells: [cell("img-1")] })];
    render(<StudioClient initialLanes={[lane({ cells: [cell("img-1")] })]} />);

    anchorCell(0);
    fireEvent.change(screen.getByTestId("studio-composer"), {
      target: { value: "make it blue" },
    });
    fireEvent.submit(screen.getByTestId("studio-composer").closest("form")!);

    await waitFor(() =>
      expect(generateDesign).toHaveBeenCalledWith("design-1", "make it blue", {
        anchorImageId: "img-1",
        jobId: expect.any(String),
      })
    );
    // An accepted turn spends the anchor (2026-10-01): the next idea starts
    // a new lane instead of landing in this one.
    await waitFor(() => expect(screen.queryByTestId("anchor-chip")).toBeNull());
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
    expect(opts).toEqual({ jobId: expect.any(String) });
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

  it("removes the cell when the action throws", async () => {
    // A digest is what marks this as a genuine server-side throw (#245) —
    // without one it would now be treated as a lost response and wait out
    // the reconcile window instead of failing immediately.
    vi.mocked(generateDesign).mockRejectedValueOnce(
      Object.assign(new Error("boom"), { digest: "test-digest" })
    );
    render(<StudioClient initialLanes={[lane()]} />);

    submitText("a red dragon");

    await waitFor(() =>
      expect(screen.queryByTestId("studio-pending-cell")).toBeNull()
    );
    expect(screen.getByText(/Something went wrong/)).toBeTruthy();
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

  it("keeps the anchor while the submit is in flight, until the turn is accepted", () => {
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
 * #245 rebuild: a generateDesign response can be lost after the server
 * already accepted the request (a transport failure, not a thrown digest
 * error) — the job row may exist even though the client never heard back.
 * The client mints its own job id up front and sends it as generateDesign's
 * `jobId`; if the response is lost, a reconcile loop looks that exact id up
 * (getGenerationJobStatus) until it lands, fails, is cancelled, or the
 * window runs out. See docs/superpowers/plans/2026-09-26-245-lost-generate-
 * response.md, Design §Client, and the ledger's rebuild rulings.
 */
describe("lost Generate response reconcile (#245)", () => {
  function submitText(value: string) {
    fireEvent.change(screen.getByTestId("studio-composer"), {
      target: { value },
    });
    fireEvent.submit(screen.getByTestId("studio-composer").closest("form")!);
  }

  /** Stubs crypto.randomUUID to hand out `ids` in call order. */
  function mockUuidSequence(ids: string[]) {
    let i = 0;
    return vi.spyOn(crypto, "randomUUID").mockImplementation(() => {
      const id = ids[i] ?? `extra-uuid-${i}`;
      i += 1;
      return id as `${string}-${string}-${string}-${string}-${string}`;
    });
  }

  function lostResponse() {
    return Promise.reject(new TypeError("Failed to fetch")) as never;
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("test 1: landed after loss — no notice, composer empty, one cell throughout, looked up by the sent id", async () => {
    vi.useFakeTimers();
    try {
      mockUuidSequence(["local-1", "job-1"]);
      vi.mocked(generateDesign).mockImplementationOnce(lostResponse);
      vi.mocked(getGenerationJobStatus).mockResolvedValueOnce({
        status: "running",
      });
      h.polledLanes = [
        lane({ cells: [cell("img-1")], pending: [pendingJob("job-1", 0)] }),
      ];

      render(<StudioClient initialLanes={[lane({ cells: [cell("img-1")] })]} />);
      anchorCell(0);
      submitText("make it blue");

      expect(screen.getAllByTestId("studio-pending-cell")).toHaveLength(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(getGenerationJobStatus).toHaveBeenCalledWith("job-1");
      expect(screen.getAllByTestId("studio-pending-cell")).toHaveLength(1);
      expect(screen.queryByText(/Something went wrong/)).toBeNull();
      expect(
        (screen.getByTestId("studio-composer") as HTMLInputElement).value
      ).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("test 2: a poll lists the job under the client id before the lookup answers — still one cell", async () => {
    vi.useFakeTimers();
    try {
      mockUuidSequence(["local-2", "job-2"]);
      vi.mocked(generateDesign).mockImplementationOnce(lostResponse);
      let resolveStatus!: (v: { status: string }) => void;
      vi.mocked(getGenerationJobStatus).mockReturnValueOnce(
        new Promise((resolve) => {
          resolveStatus = resolve as never;
        }) as never
      );

      render(<StudioClient initialLanes={[lane({ cells: [cell("img-1")] })]} />);
      anchorCell(0);
      submitText("make it blue");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(getGenerationJobStatus).toHaveBeenCalledWith("job-2");

      // A periodic poll lists the job under the client id while the lookup
      // is still outstanding.
      h.polledLanes = [
        lane({ cells: [cell("img-1")], pending: [pendingJob("job-2", 0)] }),
      ];
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });

      expect(screen.getAllByTestId("studio-pending-cell")).toHaveLength(1);

      resolveStatus({ status: "running" });
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.getAllByTestId("studio-pending-cell")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("test 3: failed after loss — notice, words back, cell gone", async () => {
    vi.useFakeTimers();
    try {
      mockUuidSequence(["design-3", "local-3", "job-3"]);
      vi.mocked(generateDesign).mockImplementationOnce(lostResponse);
      let resolveStatus!: (v: { status: string }) => void;
      vi.mocked(getGenerationJobStatus).mockReturnValueOnce(
        new Promise((resolve) => {
          resolveStatus = resolve as never;
        }) as never
      );

      render(<StudioClient initialLanes={[lane()]} />);
      submitText("a red dragon");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(getGenerationJobStatus).toHaveBeenCalledWith("job-3");
      expect(generateDesign).toHaveBeenCalledWith(
        "design-3",
        "a red dragon",
        expect.objectContaining({ jobId: "job-3" })
      );
      expect(screen.queryByText(/Something went wrong/)).toBeNull();

      resolveStatus({ status: "failed" });
      await act(async () => {
        await Promise.resolve();
      });

      expect(screen.queryByTestId("studio-pending-cell")).toBeNull();
      expect(screen.getByText(/Something went wrong/)).toBeTruthy();
      expect(
        (screen.getByTestId("studio-composer") as HTMLInputElement).value
      ).toBe("a red dragon");
    } finally {
      vi.useRealTimers();
    }
  });

  it("test 4: none until the deadline — cell stays and no notice before, then fails", async () => {
    vi.useFakeTimers();
    try {
      mockUuidSequence(["design-4", "local-4", "job-4"]);
      vi.mocked(generateDesign).mockImplementationOnce(lostResponse);
      vi.mocked(getGenerationJobStatus).mockResolvedValue({ status: "none" });

      render(<StudioClient initialLanes={[lane()]} />);
      submitText("a red dragon");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByTestId("studio-pending-cell")).toBeTruthy();

      // Well before the 60s deadline.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(screen.getByTestId("studio-pending-cell")).toBeTruthy();
      expect(screen.queryByText(/Something went wrong/)).toBeNull();

      // Past the deadline.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(40_000);
      });
      expect(screen.queryByTestId("studio-pending-cell")).toBeNull();
      expect(screen.getByText(/Something went wrong/)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("test 5: a lookup called before the deadline can't fail the submit, however late it resolves", async () => {
    vi.useFakeTimers();
    try {
      mockUuidSequence(["design-5", "local-5", "job-5"]);
      vi.mocked(generateDesign).mockImplementationOnce(lostResponse);
      // Every ordinary call answers "none" instantly — a plain reconcile
      // cadence right up to the deadline. Second independent review, item 3
      // bounds each lookup to LOST_SUBMIT_LOOKUP_TIMEOUT_MS (10s), so a call
      // can no longer be held open across the WHOLE 60s ordinary deadline the
      // way the pre-item-3 version of this test did — the one call that
      // matters here is instead held open for a few seconds, well inside its
      // own 10s budget, spanning the deadline itself.
      vi.mocked(getGenerationJobStatus).mockResolvedValue({ status: "none" });

      render(<StudioClient initialLanes={[lane()]} />);
      submitText("a red dragon");

      // Call 1 at t=0.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(getGenerationJobStatus).toHaveBeenCalledTimes(1);

      // Calls 2 through 19, at t=3000..54000 — all instant "none", all well
      // before deadlineMs (60s).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(54_000);
      });
      expect(getGenerationJobStatus).toHaveBeenCalledTimes(19);
      expect(screen.getByTestId("studio-pending-cell")).toBeTruthy();

      // Call 20, dispatched at t=57000 — still before the 60s deadline —
      // hangs instead of answering instantly.
      let holdResolve!: (v: { status: string }) => void;
      vi.mocked(getGenerationJobStatus).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            holdResolve = resolve as never;
          }) as never
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });
      expect(getGenerationJobStatus).toHaveBeenCalledTimes(20);

      // Real time crosses the ordinary deadline (t=60000) while call 20 —
      // dispatched at t=57000, so its OWN calledAtMs is still before it — is
      // still outstanding, well inside its 10s timeout budget (so no
      // internal timeout fires and no new call is dispatched yet).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(getGenerationJobStatus).toHaveBeenCalledTimes(20);
      expect(screen.getByTestId("studio-pending-cell")).toBeTruthy();

      // Call 20 finally answers "none" at t=62000 — after the deadline was
      // crossed — but since IT was called before the deadline, it must not
      // fail (rule 5).
      holdResolve({ status: "none" });
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.getByTestId("studio-pending-cell")).toBeTruthy();
      expect(screen.queryByText(/Something went wrong/)).toBeNull();

      // The next lookup (call 21), dispatched well after the deadline,
      // decides for real.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });
      expect(getGenerationJobStatus).toHaveBeenCalledTimes(21);

      expect(screen.queryByTestId("studio-pending-cell")).toBeNull();
      expect(screen.getByText(/Something went wrong/)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("test 6: a digest throw fails at once and never calls the lookup", async () => {
    mockUuidSequence(["design-6", "local-6", "job-6"]);
    vi.mocked(generateDesign).mockRejectedValueOnce(
      Object.assign(new Error("x"), { digest: "123" })
    );

    render(<StudioClient initialLanes={[lane()]} />);
    submitText("a red dragon");

    expect(generateDesign).toHaveBeenCalledWith(
      "design-6",
      "a red dragon",
      expect.objectContaining({ jobId: "job-6" })
    );

    await waitFor(() =>
      expect(screen.queryByTestId("studio-pending-cell")).toBeNull()
    );
    expect(screen.getByText(/Something went wrong/)).toBeTruthy();
    expect(getGenerationJobStatus).not.toHaveBeenCalled();
  });

  it("test 7 (#204): a digest throw on an anchored closed lane reconciles via one poll, no lookup", async () => {
    mockUuidSequence(["local-7", "job-7"]);
    vi.mocked(generateDesign).mockRejectedValueOnce(
      Object.assign(new Error("closed"), { digest: "abc" })
    );
    h.polledLanes = []; // the lane closed server-side

    render(<StudioClient initialLanes={[lane({ cells: [cell("img-1")] })]} />);
    anchorCell(0);
    submitText("make it blue");

    expect(generateDesign).toHaveBeenCalledWith(
      expect.any(String),
      "make it blue",
      expect.objectContaining({ jobId: "job-7" })
    );

    await waitFor(() => expect(getStudioLanes).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId("studio-lane")).toBeNull());
    expect(screen.queryByTestId("anchor-chip")).toBeNull();
    expect(screen.getByText(/Something went wrong/)).toBeTruthy();
    expect(
      (screen.getByTestId("studio-composer") as HTMLInputElement).value
    ).toBe("make it blue");
    expect(getGenerationJobStatus).not.toHaveBeenCalled();
  });

  it("test 8: two lost submits in one lane reconcile independently by their own id", async () => {
    vi.useFakeTimers();
    try {
      mockUuidSequence(["local-a", "job-a", "local-b", "job-b"]);
      vi.mocked(generateDesign)
        .mockImplementationOnce(lostResponse)
        .mockImplementationOnce(lostResponse);
      vi.mocked(getGenerationJobStatus).mockImplementation(
        async (jobId: string) =>
          jobId === "job-a" ? { status: "running" } : { status: "none" }
      );
      // Present from the start so the "job-a landed" pollOnce doesn't wipe
      // the lane out from under the still-outstanding "job-b" overlay.
      h.polledLanes = [
        lane({ cells: [cell("img-1")], pending: [pendingJob("job-a", 0)] }),
      ];

      render(<StudioClient initialLanes={[lane({ cells: [cell("img-1")] })]} />);
      anchorCell(0);
      submitText("first");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      anchorCell(0);
      submitText("second");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(getGenerationJobStatus).toHaveBeenCalledWith("job-a");
      expect(getGenerationJobStatus).toHaveBeenCalledWith("job-b");
      // job-a landed (now the server's own pending cell); job-b is still
      // waiting on its own deadline.
      expect(screen.getAllByTestId("studio-pending-cell")).toHaveLength(2);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(65_000);
      });
      // job-b fails at its own deadline; job-a's cell remains.
      expect(screen.getByText(/Something went wrong/)).toBeTruthy();
      expect(screen.getAllByTestId("studio-pending-cell")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("test 9: another tab's job in the same lane isn't mistaken for this submit's", async () => {
    vi.useFakeTimers();
    try {
      mockUuidSequence(["local-9", "job-9"]);
      vi.mocked(generateDesign).mockImplementationOnce(lostResponse);
      vi.mocked(getGenerationJobStatus).mockResolvedValue({ status: "none" });
      h.polledLanes = [
        lane({
          cells: [cell("img-1")],
          pending: [pendingJob("other-tab-job", 0)],
        }),
      ];

      render(<StudioClient initialLanes={[lane({ cells: [cell("img-1")] })]} />);
      anchorCell(0);
      submitText("make it blue");

      // A periodic poll picks up the other tab's job.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      // The other tab's real cell, plus this submit's own overlay (still
      // unresolved) — never merged into one.
      expect(screen.getAllByTestId("studio-pending-cell")).toHaveLength(2);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(65_000);
      });
      expect(screen.getByText(/Something went wrong/)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("test 10: offline at submit and at the catch fails fast, no lookup", async () => {
    mockUuidSequence(["design-10", "local-10", "job-10"]);
    const onLineSpy = vi
      .spyOn(navigator, "onLine", "get")
      .mockReturnValue(false);
    vi.mocked(generateDesign).mockRejectedValueOnce(
      new TypeError("Failed to fetch")
    );

    render(<StudioClient initialLanes={[lane()]} />);
    submitText("a red dragon");

    expect(generateDesign).toHaveBeenCalledWith(
      "design-10",
      "a red dragon",
      expect.objectContaining({ jobId: "job-10" })
    );

    await waitFor(() =>
      expect(screen.queryByTestId("studio-pending-cell")).toBeNull()
    );
    expect(screen.getByText(/Something went wrong/)).toBeTruthy();
    expect(getGenerationJobStatus).not.toHaveBeenCalled();
    onLineSpy.mockRestore();
  });

  it("test 11: a cancelled reconcile drops the cell silently — no notice, no words back", async () => {
    vi.useFakeTimers();
    try {
      mockUuidSequence(["design-11", "local-11", "job-11"]);
      vi.mocked(generateDesign).mockImplementationOnce(lostResponse);
      vi.mocked(getGenerationJobStatus).mockResolvedValueOnce({
        status: "cancelled",
      });

      render(<StudioClient initialLanes={[lane()]} />);
      submitText("a red dragon");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(screen.queryByTestId("studio-pending-cell")).toBeNull();
      expect(screen.queryByText(/Something went wrong/)).toBeNull();
      expect(
        (screen.getByTestId("studio-composer") as HTMLInputElement).value
      ).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("test 12: every lookup throwing waits well past the ordinary deadline, then fails only at the hard backstop (independent review, item 1)", async () => {
    vi.useFakeTimers();
    try {
      mockUuidSequence(["design-12", "local-12", "job-12"]);
      vi.mocked(generateDesign).mockImplementationOnce(lostResponse);
      vi.mocked(getGenerationJobStatus).mockRejectedValue(
        new Error("network")
      );

      render(<StudioClient initialLanes={[lane()]} />);
      submitText("a red dragon");

      // Well past the ordinary 60s deadline: an ERRORING lookup is not proof
      // the job is gone (the device may simply have no network right now),
      // unlike a real "none" answer, so it must not fail here the way test 4
      // does for "none".
      await act(async () => {
        await vi.advanceTimersByTimeAsync(90_000);
      });
      expect(screen.getByTestId("studio-pending-cell")).toBeTruthy();
      expect(screen.queryByText(/Something went wrong/)).toBeNull();

      // Only the hard backstop — STALE_OPTIMISTIC_MS (6 minutes) since the
      // submit — gives up on a lookup that never once answers.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5 * 60_000);
      });
      expect(screen.queryByTestId("studio-pending-cell")).toBeNull();
      expect(screen.getByText(/Something went wrong/)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("test 12b: lookups keep erroring past the deadline, then one succeeds — no notice, composer empty, one cell (independent review, item 1)", async () => {
    vi.useFakeTimers();
    try {
      mockUuidSequence(["design-12b", "local-12b", "job-12b"]);
      vi.mocked(generateDesign).mockImplementationOnce(lostResponse);
      // Persistent default: every lookup errors until told otherwise below.
      vi.mocked(getGenerationJobStatus).mockRejectedValue(
        new Error("network")
      );

      render(<StudioClient initialLanes={[lane()]} />);
      submitText("a red dragon");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(getGenerationJobStatus).toHaveBeenCalledTimes(1);

      // Scenario from the prod report: a phone loses the response, sits with
      // no network for a couple of minutes (well past the 60s deadline) while
      // the render actually finishes, then regains signal. Every lookup in
      // that window errors — none of them may report failure.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(70_000);
      });
      expect(screen.getByTestId("studio-pending-cell")).toBeTruthy();
      expect(screen.queryByText(/Something went wrong/)).toBeNull();

      // The phone regains signal: the very next lookup answers for real.
      vi.mocked(getGenerationJobStatus).mockResolvedValueOnce({
        status: "succeeded",
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });

      expect(screen.getAllByTestId("studio-pending-cell")).toHaveLength(1);
      expect(screen.queryByText(/Something went wrong/)).toBeNull();
      expect(
        (screen.getByTestId("studio-composer") as HTMLInputElement).value
      ).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("test 13: unmounting during the window stops further lookups", async () => {
    vi.useFakeTimers();
    try {
      mockUuidSequence(["design-13", "local-13", "job-13"]);
      vi.mocked(generateDesign).mockImplementationOnce(lostResponse);
      vi.mocked(getGenerationJobStatus).mockResolvedValue({ status: "none" });

      const { unmount } = render(<StudioClient initialLanes={[lane()]} />);
      submitText("a red dragon");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      const callsBeforeUnmount = vi.mocked(getGenerationJobStatus).mock.calls
        .length;
      expect(callsBeforeUnmount).toBeGreaterThan(0);

      unmount();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(65_000);
      });
      expect(vi.mocked(getGenerationJobStatus).mock.calls.length).toBe(
        callsBeforeUnmount
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("test 14: words typed during the window survive a failure", async () => {
    vi.useFakeTimers();
    try {
      mockUuidSequence(["design-14", "local-14", "job-14"]);
      vi.mocked(generateDesign).mockImplementationOnce(lostResponse);
      let resolveStatus!: (v: { status: string }) => void;
      vi.mocked(getGenerationJobStatus).mockReturnValueOnce(
        new Promise((resolve) => {
          resolveStatus = resolve as never;
        }) as never
      );

      render(<StudioClient initialLanes={[lane()]} />);
      submitText("a red dragon");

      expect(
        (screen.getByTestId("studio-composer") as HTMLInputElement).value
      ).toBe("");
      fireEvent.change(screen.getByTestId("studio-composer"), {
        target: { value: "something new" },
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(getGenerationJobStatus).toHaveBeenCalledWith("job-14");
      expect(screen.queryByText(/Something went wrong/)).toBeNull();

      resolveStatus({ status: "failed" });
      await act(async () => {
        await Promise.resolve();
      });

      expect(screen.getByText(/Something went wrong/)).toBeTruthy();
      expect(
        (screen.getByTestId("studio-composer") as HTMLInputElement).value
      ).toBe("something new");
    } finally {
      vi.useRealTimers();
    }
  });

  it("test 15: a poll lists the job under the client id past BOTH backstops while lookups keep throwing — no notice, words not given back", async () => {
    vi.useFakeTimers();
    try {
      mockUuidSequence(["design-15", "local-15", "job-15"]);
      vi.mocked(generateDesign).mockImplementationOnce(lostResponse);
      vi.mocked(getGenerationJobStatus).mockRejectedValue(
        new Error("network")
      );

      render(<StudioClient initialLanes={[lane()]} />);
      submitText("a red dragon");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByTestId("studio-pending-cell")).toBeTruthy();

      // A poll lists this submit's job under the client id — positive
      // server proof the submit landed, even though the lookup keeps
      // throwing on its own cadence.
      h.polledLanes = [lane({ pending: [pendingJob("job-15", 0)] })];
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });

      // Past the ordinary 60s deadline...
      await act(async () => {
        await vi.advanceTimersByTimeAsync(65_000);
      });
      expect(screen.getByTestId("studio-pending-cell")).toBeTruthy();

      // ...and past the hard backstop too (STALE_OPTIMISTIC_MS, 6 minutes
      // since the submit): the lane safety net recognises the pending job id
      // and must save this from failing even at the point where an ERRORING
      // lookup would otherwise finally give up.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5 * 60_000);
      });

      expect(screen.getByTestId("studio-pending-cell")).toBeTruthy();
      expect(screen.queryByText(/Something went wrong/)).toBeNull();
      expect(
        (screen.getByTestId("studio-composer") as HTMLInputElement).value
      ).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("test 16: a device woken past the hard deadline is not failed by its first post-wake errors — no notice, composer empty, one cell (second independent review, item 1)", async () => {
    vi.useFakeTimers();
    try {
      mockUuidSequence(["design-16", "local-16", "job-16"]);
      vi.mocked(generateDesign).mockImplementationOnce(lostResponse);
      vi.mocked(getGenerationJobStatus).mockRejectedValue(
        new Error("network")
      );
      // The design DID land server-side (only the response was lost), so
      // the independent poll loop's own STALE_OPTIMISTIC_MS ghost-drop
      // (settleOptimistic, unrelated to this reconcile fix) has real server
      // truth to hand off to once the overlay entry ages out mid-test — the
      // whole point of that drop being safe is that setLanes(fresh) runs
      // first in the same pollOnce(). Without this, the test would show no
      // cell at all once the poll fires, for a reason unrelated to the fix
      // under test.
      h.polledLanes = [
        lane({ designId: "design-16", pending: [pendingJob("job-16", 0)] }),
      ];

      render(<StudioClient initialLanes={[lane()]} />);
      // submit() reads Date.now() for startedAtMs (hence hardDeadlineMs)
      // synchronously, before generateDesign's rejection is even a
      // microtask yet — nothing has run asynchronously at this point, so
      // jumping the clock here, before flushing anything, faithfully
      // simulates a phone that freezes (no JS runs at all, no lookups are
      // even attempted) for 8 minutes starting the instant it submits: well
      // past STALE_OPTIMISTIC_MS (6 minutes), so hardDeadlineMs is already
      // BEHIND the device by the time its very first reconcile lookup is
      // ever dispatched, once everything below finally gets to run.
      submitText("a red dragon");
      vi.setSystemTime(Date.now() + 8 * 60_000);

      // The very first lookup ever made for this submit, and every one for
      // the next 30s, errors — the prod scenario this fix is for:
      // momentarily no network right when the tab wakes, even though the
      // render finishes regardless. Before this fix, a single error whose
      // calledAtMs is already past hardDeadlineMs failed the submit outright
      // on the spot; now the streak (which only just started, at this very
      // call) must itself run for the full window first.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(getGenerationJobStatus).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("studio-pending-cell")).toBeTruthy();
      expect(screen.queryByText(/Something went wrong/)).toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });

      expect(screen.getByTestId("studio-pending-cell")).toBeTruthy();
      expect(screen.queryByText(/Something went wrong/)).toBeNull();

      // The phone regains signal for real.
      vi.mocked(getGenerationJobStatus).mockResolvedValueOnce({
        status: "succeeded",
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });

      expect(screen.getAllByTestId("studio-pending-cell")).toHaveLength(1);
      expect(screen.queryByText(/Something went wrong/)).toBeNull();
      expect(
        (screen.getByTestId("studio-composer") as HTMLInputElement).value
      ).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("test 17: a lookup that never resolves times out and counts as an error, not an infinite stall (second independent review, item 3)", async () => {
    vi.useFakeTimers();
    try {
      mockUuidSequence(["design-17", "local-17", "job-17"]);
      vi.mocked(generateDesign).mockImplementationOnce(lostResponse);
      // Never settles at all — without a timeout on the lookup itself, the
      // reconcile loop would await this forever: no further attempts, no
      // notice, ever.
      vi.mocked(getGenerationJobStatus).mockReturnValue(
        new Promise(() => {}) as never
      );

      render(<StudioClient initialLanes={[lane()]} />);
      submitText("a red dragon");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(getGenerationJobStatus).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("studio-pending-cell")).toBeTruthy();

      // Past LOST_SUBMIT_LOOKUP_TIMEOUT_MS the hung lookup times out
      // (counted as "error"), and the loop's ordinary cadence fires a second
      // attempt — proof the loop is still alive rather than stuck.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(
          LOST_SUBMIT_LOOKUP_TIMEOUT_MS + LOST_SUBMIT_LOOKUP_INTERVAL_MS
        );
      });

      expect(getGenerationJobStatus).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId("studio-pending-cell")).toBeTruthy();
      expect(screen.queryByText(/Something went wrong/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("test 18: foreground errors, then a mid-loop device freeze — the post-wake error doesn't fail, but the streak keeps counting and eventually does (third review, item 1)", async () => {
    vi.useFakeTimers();
    try {
      mockUuidSequence(["design-18", "local-18", "job-18"]);
      vi.mocked(generateDesign).mockImplementationOnce(lostResponse);
      vi.mocked(getGenerationJobStatus).mockRejectedValue(new Error("network"));
      // h.polledLanes is left at its default `[]` (never shows job-18
      // pending), same as the ordinary failure tests (3, 4, 12) — this test
      // is deliberately the case where the server genuinely never learned
      // about the job (the lost-response scenario proper), not the "it
      // landed but the phone can't see it yet" case tests 12b/16 exercise.
      // The overlay's own entry (jobId still null, keyed on clientJobId)
      // renders the pending cell by itself while its age is under
      // STALE_OPTIMISTIC_MS; once real time crosses that (which this test's
      // freeze does), settleOptimistic's own unrelated age-out drops it with
      // nothing to hand off to — expected, and irrelevant to what this test
      // is checking (the streak-count threshold), so assertions below don't
      // depend on the cell still being visible past that point.

      render(<StudioClient initialLanes={[lane()]} />);
      submitText("a lost submit that survives a mid-loop freeze");

      // Call 1, at t=0 — the network is nominally fine; this is an ordinary
      // foreground blip, not a freeze.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      // Calls 2 and 3, at t=3000 and t=6000 — more ordinary foreground
      // errors. All well before hardDeadlineMs (STALE_OPTIMISTIC_MS, 6
      // minutes), so none of this can fail regardless of the count.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6_000);
      });
      expect(getGenerationJobStatus).toHaveBeenCalledTimes(3);
      expect(screen.getByTestId("studio-pending-cell")).toBeTruthy();
      expect(screen.queryByText(/Something went wrong/)).toBeNull();

      // The device freezes right here: no further attempts happen while
      // asleep, only the clock moves. Unlike test 16 (which jumps the clock
      // synchronously before the very first lookup, because no timer exists
      // yet to interfere), there IS a pending setTimeout now — the loop's own
      // 3s interval wait. Its remaining delay is unaffected by the jump, so
      // the very next vi.advanceTimersByTimeAsync call still has to run out
      // that same interval before the timer fires; the jump alone does not
      // make it fire early or "overdue".
      vi.setSystemTime(Date.now() + 8 * 60_000);

      // The phone wakes and makes its first attempt since the freeze (call
      // 4). Its calledAtMs is now far past hardDeadlineMs, but the streak is
      // only 4 long — nowhere near LOST_SUBMIT_ERROR_ATTEMPTS — so this must
      // not fail, exactly like test 16's single post-wake error. This is the
      // case a wall-clock streak got wrong: sleeping consumed 8 minutes of
      // clock time but made zero attempts, so it must not have consumed any
      // of the attempt budget either.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });
      expect(getGenerationJobStatus).toHaveBeenCalledTimes(4);
      expect(screen.queryByText(/Something went wrong/)).toBeNull();
      expect(
        (screen.getByTestId("studio-composer") as HTMLInputElement).value
      ).toBe("");

      // The device keeps trying and keeps failing to reach the server after
      // waking. Once the streak reaches LOST_SUBMIT_ERROR_ATTEMPTS in total
      // (call 20 — 16 more from here, all past hardDeadlineMs), the submit is
      // finally judged failed: notice shown, words restored.
      const remainingCalls = LOST_SUBMIT_ERROR_ATTEMPTS - 4;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(
          remainingCalls * LOST_SUBMIT_LOOKUP_INTERVAL_MS
        );
      });
      expect(getGenerationJobStatus).toHaveBeenCalledTimes(
        LOST_SUBMIT_ERROR_ATTEMPTS
      );
      expect(screen.getByText(/Something went wrong/)).toBeTruthy();
      expect(
        (screen.getByTestId("studio-composer") as HTMLInputElement).value
      ).toBe("a lost submit that survives a mid-loop freeze");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the anchor clears after an accepted Generate (2026-10-01)", () => {
  function submitText(value: string) {
    fireEvent.change(screen.getByTestId("studio-composer"), {
      target: { value },
    });
    fireEvent.submit(screen.getByTestId("studio-composer").closest("form")!);
  }

  function deferGenerate() {
    let settle!: (result: unknown) => void;
    const pending = new Promise((resolve) => {
      settle = resolve;
    });
    vi.mocked(generateDesign).mockReturnValueOnce(pending as never);
    return settle;
  }

  /** Types into the box without submitting. */
  function submitTextNoSubmit(value: string) {
    fireEvent.change(screen.getByTestId("studio-composer"), {
      target: { value },
    });
  }

  const queued = {
    kind: "queued",
    jobId: "job-new",
    generationNumber: 1,
    imageId: "img-new",
  };

  it("restores the unanchored placeholder, and the next Generate starts a new lane", async () => {
    h.polledLanes = [lane({ cells: [cell("img-1")] })];
    render(<StudioClient initialLanes={[lane({ cells: [cell("img-1")] })]} />);

    anchorCell(0);
    expect(
      (screen.getByTestId("studio-composer") as HTMLInputElement).placeholder
    ).toBe("Describe the change");
    submitText("make it blue");
    await waitFor(() => expect(screen.queryByTestId("anchor-chip")).toBeNull());
    expect(
      (screen.getByTestId("studio-composer") as HTMLInputElement).placeholder
    ).toBe("Describe a design");

    submitText("a red dragon");
    await waitFor(() => expect(generateDesign).toHaveBeenCalledTimes(2));
    const [designId, message, opts] = vi.mocked(generateDesign).mock.calls[1];
    expect(designId).not.toBe("design-1");
    expect(message).toBe("a red dragon");
    expect(opts).toEqual({ jobId: expect.any(String) });
  });

  it("keeps the anchor when the turn is refused, so the same edit can be retried", async () => {
    h.polledLanes = [lane({ cells: [cell("img-1")] })];
    vi.mocked(generateDesign).mockResolvedValueOnce({
      kind: "limit",
      message: "You've reached today's free design limit. Sign in to keep designing.",
    });
    render(<StudioClient initialLanes={[lane({ cells: [cell("img-1")] })]} />);

    anchorCell(0);
    submitText("make it blue");
    await waitFor(() => expect(screen.getByText(/free design limit/)).toBeTruthy());

    expect(screen.getByTestId("anchor-chip")).toBeTruthy();
    expect(
      (screen.getByTestId("studio-composer") as HTMLInputElement).value
    ).toBe("make it blue");
  });

  it("keeps the anchor when the action throws a server error", async () => {
    h.polledLanes = [lane({ cells: [cell("img-1")] })];
    vi.mocked(generateDesign).mockRejectedValueOnce(
      Object.assign(new Error("masked"), { digest: "abc" })
    );
    render(<StudioClient initialLanes={[lane({ cells: [cell("img-1")] })]} />);

    anchorCell(0);
    submitText("make it blue");
    await waitFor(() => expect(screen.getByText(/Something went wrong/)).toBeTruthy());

    expect(screen.getByTestId("anchor-chip")).toBeTruthy();
  });

  it("keeps a newer anchor set while the submit was in flight", async () => {
    const settle = deferGenerate();
    h.polledLanes = [
      lane({ cells: [cell("img-1")] }),
      lane({ designId: "design-2", title: "second lane", cells: [cell("img-2")] }),
    ];
    render(
      <StudioClient
        initialLanes={[
          lane({ cells: [cell("img-1")] }),
          lane({ designId: "design-2", title: "second lane", cells: [cell("img-2")] }),
        ]}
      />
    );

    anchorCell(0);
    submitText("make it blue");
    anchorCell(1);
    expect(screen.getByTestId("anchor-chip").textContent).toContain("second lane");

    await act(async () => {
      settle(queued);
    });

    expect(screen.getByTestId("anchor-chip").textContent).toContain("second lane");
  });

  describe("two submits from one anchor", () => {
    function setup() {
      h.polledLanes = [lane({ cells: [cell("img-1")] })];
      const settles: Array<(r: unknown) => void> = [deferGenerate(), deferGenerate()];
      render(<StudioClient initialLanes={[lane({ cells: [cell("img-1")] })]} />);
      anchorCell(0);
      submitText("first idea");
      submitText("second idea");
      return settles;
    }
    const refused = {
      kind: "limit",
      message: "You've reached today's free design limit. Sign in to keep designing.",
    };
    const composer = () => screen.getByTestId("studio-composer") as HTMLInputElement;

    it("A accepted, then B refused: B's words come back with the anchor", async () => {
      const [a, b] = setup();
      await act(async () => {
        a(queued);
      });
      await act(async () => {
        b(refused);
      });
      expect(composer().value).toBe("second idea");
      expect(screen.getByTestId("anchor-chip")).toBeTruthy();
    });

    it("B refused, then A accepted: the anchor B's words came back with survives", async () => {
      const [a, b] = setup();
      await act(async () => {
        b(refused);
      });
      await act(async () => {
        a(queued);
      });
      expect(composer().value).toBe("second idea");
      expect(screen.getByTestId("anchor-chip")).toBeTruthy();
    });

    it("a refusal whose words are not restored (new text in the box) leaves the anchor cleared", async () => {
      const [a, b] = setup();
      submitTextNoSubmit("third idea");
      await act(async () => {
        a(queued);
      });
      await act(async () => {
        b(refused);
      });
      expect(composer().value).toBe("third idea");
      expect(screen.queryByTestId("anchor-chip")).toBeNull();
    });
  });

  describe("words and anchor go back together", () => {
    const composer = () => screen.getByTestId("studio-composer") as HTMLInputElement;
    const refused = { kind: "limit", message: "Over the limit." };
    const twoLanes = () => [
      lane({ cells: [cell("img-1")] }),
      lane({ designId: "design-2", title: "second lane", cells: [cell("img-2")] }),
    ];

    function deferReject() {
      let reject!: (e: unknown) => void;
      const pending = new Promise((_, r) => {
        reject = r;
      });
      vi.mocked(generateDesign).mockReturnValueOnce(pending as never);
      return reject;
    }

    it("anchored submit refused after the user anchored a different image: words and the submitted anchor come back", async () => {
      h.polledLanes = twoLanes();
      const settle = deferGenerate();
      render(<StudioClient initialLanes={twoLanes()} />);
      anchorCell(0);
      submitText("make it blue");
      anchorCell(1);
      await act(async () => {
        settle(refused);
      });
      expect(composer().value).toBe("make it blue");
      expect(screen.getByTestId("anchor-chip").textContent).toContain(
        "geometric wolf head"
      );
    });

    it("unanchored submit refused after the user anchored an image: words back, no chip, retry starts a new lane", async () => {
      h.polledLanes = [lane({ cells: [cell("img-1")] })];
      const settle = deferGenerate();
      render(<StudioClient initialLanes={[lane({ cells: [cell("img-1")] })]} />);
      submitText("new idea");
      anchorCell(0);
      expect(screen.getByTestId("anchor-chip")).toBeTruthy();
      await act(async () => {
        settle(refused);
      });
      expect(composer().value).toBe("new idea");
      expect(screen.queryByTestId("anchor-chip")).toBeNull();

      fireEvent.submit(composer().closest("form")!);
      await waitFor(() => expect(generateDesign).toHaveBeenCalledTimes(2));
      const [designId, , opts] = vi.mocked(generateDesign).mock.calls[1];
      expect(designId).not.toBe("design-1");
      expect(opts).toEqual({ jobId: expect.any(String) });
    });

    it("anchored submit refused after the user dismissed the chip: words and chip come back", async () => {
      h.polledLanes = [lane({ cells: [cell("img-1")] })];
      const settle = deferGenerate();
      render(<StudioClient initialLanes={[lane({ cells: [cell("img-1")] })]} />);
      anchorCell(0);
      submitText("make it blue");
      fireEvent.click(screen.getByLabelText("Clear anchor"));
      expect(screen.queryByTestId("anchor-chip")).toBeNull();
      await act(async () => {
        settle(refused);
      });
      expect(composer().value).toBe("make it blue");
      expect(screen.getByTestId("anchor-chip")).toBeTruthy();
    });

    it("anchored submit refused after its image left the surface: words back, no chip", async () => {
      h.polledLanes = [lane({ cells: [cell("img-1")] })];
      const settle = deferGenerate();
      render(<StudioClient initialLanes={[lane({ cells: [cell("img-1")] })]} />);
      anchorCell(0);
      submitText("make it blue");
      h.polledLanes = []; // the conversation closed elsewhere
      fireEvent(window, new Event("focus"));
      await waitFor(() => expect(screen.queryByTestId("anchor-chip")).toBeNull());
      await act(async () => {
        settle(refused);
      });
      expect(composer().value).toBe("make it blue");
      expect(screen.queryByTestId("anchor-chip")).toBeNull();
    });

    it("server-action throw: words and anchor come back", async () => {
      h.polledLanes = [lane({ cells: [cell("img-1")] })];
      const reject = deferReject();
      render(<StudioClient initialLanes={[lane({ cells: [cell("img-1")] })]} />);
      anchorCell(0);
      submitText("make it blue");
      fireEvent.click(screen.getByLabelText("Clear anchor"));
      await act(async () => {
        reject(Object.assign(new Error("masked"), { digest: "abc" }));
      });
      expect(composer().value).toBe("make it blue");
      expect(screen.getByTestId("anchor-chip")).toBeTruthy();
    });

    it("offline fast-fail: words and anchor come back", async () => {
      h.polledLanes = [lane({ cells: [cell("img-1")] })];
      const onLineSpy = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
      try {
        const reject = deferReject();
        render(<StudioClient initialLanes={[lane({ cells: [cell("img-1")] })]} />);
        anchorCell(0);
        submitText("make it blue");
        fireEvent.click(screen.getByLabelText("Clear anchor"));
        await act(async () => {
          reject(new TypeError("Failed to fetch"));
        });
        expect(composer().value).toBe("make it blue");
        expect(screen.getByTestId("anchor-chip")).toBeTruthy();
      } finally {
        onLineSpy.mockRestore();
      }
    });

    it("reconcile 'failed' verdict: words and anchor come back", async () => {
      vi.useFakeTimers();
      try {
        h.polledLanes = [lane({ cells: [cell("img-1")] })];
        const reject = deferReject();
        vi.mocked(getGenerationJobStatus).mockResolvedValue({ status: "failed" });
        render(<StudioClient initialLanes={[lane({ cells: [cell("img-1")] })]} />);
        anchorCell(0);
        submitText("make it blue");
        fireEvent.click(screen.getByLabelText("Clear anchor"));
        await act(async () => {
          reject(new TypeError("Failed to fetch"));
          await vi.advanceTimersByTimeAsync(0);
        });
        expect(composer().value).toBe("make it blue");
        expect(screen.getByTestId("anchor-chip")).toBeTruthy();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("clears the anchor when a lost response is reconciled as run", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(generateDesign).mockImplementationOnce(
        () => Promise.reject(new TypeError("Failed to fetch")) as never
      );
      vi.mocked(getGenerationJobStatus).mockResolvedValueOnce({ status: "running" });
      h.polledLanes = [lane({ cells: [cell("img-1")] })];

      render(<StudioClient initialLanes={[lane({ cells: [cell("img-1")] })]} />);
      anchorCell(0);
      submitText("make it blue");
      expect(screen.getByTestId("anchor-chip")).toBeTruthy();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(screen.queryByTestId("anchor-chip")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the anchor when the lookup says cancelled", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(generateDesign).mockImplementationOnce(
        () => Promise.reject(new TypeError("Failed to fetch")) as never
      );
      vi.mocked(getGenerationJobStatus).mockResolvedValueOnce({ status: "cancelled" });
      h.polledLanes = [lane({ cells: [cell("img-1")] })];

      render(<StudioClient initialLanes={[lane({ cells: [cell("img-1")] })]} />);
      anchorCell(0);
      submitText("make it blue");
      expect(screen.getByTestId("anchor-chip")).toBeTruthy();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(screen.queryByTestId("anchor-chip")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the anchor when lookups keep erroring but a poll lists the client job id at the backstop", async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(crypto, "randomUUID")
        .mockReturnValueOnce("local-a1" as never)
        .mockReturnValueOnce("job-a1" as never);
      vi.mocked(generateDesign).mockImplementationOnce(
        () => Promise.reject(new TypeError("Failed to fetch")) as never
      );
      vi.mocked(getGenerationJobStatus).mockRejectedValue(new Error("network"));
      h.polledLanes = [lane({ cells: [cell("img-1")] })];

      render(<StudioClient initialLanes={[lane({ cells: [cell("img-1")] })]} />);
      anchorCell(0);
      submitText("make it blue");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      h.polledLanes = [
        lane({ cells: [cell("img-1")], pending: [pendingJob("job-a1", 0)] }),
      ];
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(screen.getByTestId("anchor-chip")).toBeTruthy();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(65_000 + 5 * 60_000);
      });

      expect(screen.getByTestId("studio-pending-cell")).toBeTruthy();
      expect(screen.queryByText(/Something went wrong/)).toBeNull();
      expect(screen.queryByTestId("anchor-chip")).toBeNull();
    } finally {
      vi.restoreAllMocks();
      vi.useRealTimers();
    }
  });

  it("keeps the anchor when a lost response is reconciled as not run", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(generateDesign).mockImplementationOnce(
        () => Promise.reject(new TypeError("Failed to fetch")) as never
      );
      vi.mocked(getGenerationJobStatus).mockResolvedValue({ status: "failed" });
      h.polledLanes = [lane({ cells: [cell("img-1")] })];

      render(<StudioClient initialLanes={[lane({ cells: [cell("img-1")] })]} />);
      anchorCell(0);
      submitText("make it blue");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(screen.getByText(/Something went wrong/)).toBeTruthy();
      expect(screen.getByTestId("anchor-chip")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
