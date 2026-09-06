/**
 * Render + interaction coverage for the Studio screen (slices 2+3): the empty
 * state, a lane's cells with the primary marked, a pending cell with elapsed
 * time — and the anchor model: tap to anchor, chip with dismiss, anchored
 * submit = edit of that image, unanchored submit = fresh conversation, cap
 * visible, Close clears a lane.
 *
 * The one test that matters most (plan, slice 3): the anchor survives a poll
 * refresh landing mid-typing. Server actions are mocked; polling arithmetic
 * lives in generation-poll's own unit tests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
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

beforeEach(() => {
  vi.clearAllMocks();
  h.polledLanes = [];
});

describe("StudioClient rendering", () => {
  it("shows the empty state with a Shop path when there are no lanes", () => {
    render(<StudioClient initialLanes={[]} />);
    expect(screen.getByText("No open designs.")).toBeTruthy();
    // A buy-only account lands here since / redirects signed-in users; the
    // Shop link is their way onward.
    expect(
      screen.getByRole("link", { name: "Browse the Shop" }).getAttribute("href")
    ).toBe("/prints");
  });

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
    expect(cells[0].className).not.toContain("border-accent");
    expect(cells[1].className).toContain("border-accent");
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

describe("anchoring", () => {
  it("tap anchors a cell and shows the chip; dismiss clears it", () => {
    render(<StudioClient initialLanes={[lane({ cells: [cell("img-1")] })]} />);

    fireEvent.click(screen.getByTestId("studio-cell"));
    const chip = screen.getByTestId("anchor-chip");
    expect(chip.textContent).toContain("Editing · geometric wolf head");

    fireEvent.click(screen.getByLabelText("Clear anchor"));
    expect(screen.queryByTestId("anchor-chip")).toBeNull();
  });

  it("tapping the anchored cell again clears the anchor", () => {
    render(<StudioClient initialLanes={[lane({ cells: [cell("img-1")] })]} />);

    fireEvent.click(screen.getByTestId("studio-cell"));
    expect(screen.getByTestId("anchor-chip")).toBeTruthy();
    fireEvent.click(screen.getByTestId("studio-cell"));
    expect(screen.queryByTestId("anchor-chip")).toBeNull();
  });

  it("the anchor survives a poll refresh landing mid-typing", async () => {
    const l = lane({ cells: [cell("img-1")], pending: [pendingJob("job-9")] });
    h.polledLanes = [l];
    render(<StudioClient initialLanes={[l]} />);

    fireEvent.click(screen.getByTestId("studio-cell"));
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

    fireEvent.click(screen.getByTestId("studio-cell"));
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

    fireEvent.click(screen.getByTestId("studio-cell"));
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

describe("closing a lane", () => {
  it("Close removes the lane and closes the conversation", async () => {
    render(<StudioClient initialLanes={[lane()]} />);

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

    fireEvent.click(screen.getByTestId("studio-delete-lane"));
    await screen.findByTestId("confirm-sheet");
    fireEvent.click(screen.getByTestId("confirm-sheet-confirm"));

    await waitFor(() => expect(screen.getByTestId("studio-lane")).toBeTruthy());
    expect(screen.getByText(/used by a shop product/)).toBeTruthy();
  });

  it("does nothing when the confirm is dismissed", async () => {
    render(<StudioClient initialLanes={[lane()]} />);

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

describe("StudioClient — archive link (slice 4)", () => {
  it("offers a quiet route to the archive, empty bench or not", () => {
    const { unmount } = render(<StudioClient initialLanes={[]} />);
    expect(screen.getByRole("link", { name: "Archive" })).toHaveAttribute(
      "href",
      "/studio/archive"
    );
    unmount();

    render(<StudioClient initialLanes={[lane({ cells: [cell("img-1")] })]} />);
    expect(screen.getByRole("link", { name: "Archive" })).toHaveAttribute(
      "href",
      "/studio/archive"
    );
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
    expect(screen.queryByTestId("select-mode")).toBeNull();
    unmount();
    render(<StudioClient initialLanes={three()} />);
    expect(screen.getByTestId("select-mode")).toBeTruthy();
  });

  it("Select swaps the composer for the bar and shows a checkbox per lane", () => {
    render(<StudioClient initialLanes={three()} />);

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
    fireEvent.click(screen.getByTestId("select-mode"));

    fireEvent.click(screen.getAllByTestId("lane-checkbox")[0]);
    expect(screen.getByTestId("selected-count").textContent).toBe("1 selected");

    fireEvent.click(screen.getByText("two"));
    expect(screen.getByTestId("selected-count").textContent).toBe("2 selected");

    // A cell tap selects rather than anchors.
    fireEvent.click(screen.getAllByTestId("studio-cell")[0]);
    expect(screen.getByTestId("selected-count").textContent).toBe("1 selected");
    expect(screen.queryByTestId("anchor-chip")).toBeNull();
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
    fireEvent.click(screen.getByTestId("select-mode"));

    const boxes = screen.getAllByTestId("lane-checkbox") as HTMLInputElement[];
    expect(boxes[3].disabled).toBe(true);

    fireEvent.click(screen.getByTestId("select-all"));
    expect(screen.getByTestId("selected-count").textContent).toBe("3 selected");
    expect(boxes[3].checked).toBe(false);
  });

  it("Done and Escape leave select mode and clear the selection", () => {
    render(<StudioClient initialLanes={three()} />);

    fireEvent.click(screen.getByTestId("select-mode"));
    fireEvent.click(screen.getAllByTestId("lane-checkbox")[0]);
    fireEvent.click(screen.getByTestId("select-done"));
    expect(screen.getByTestId("studio-composer")).toBeTruthy();

    fireEvent.click(screen.getByTestId("select-mode"));
    expect(screen.getByTestId("selected-count").textContent).toBe("0 selected");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("select-bar")).toBeNull();
  });

  it("Delete confirms once, calls the action with the ids, removes the lanes", async () => {
    // The refetch after the delete returns server truth: the survivor.
    h.polledLanes = [three()[1]];
    render(<StudioClient initialLanes={three()} />);
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

    fireEvent.click(screen.getByTestId("studio-cell"));
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

    fireEvent.click(screen.getByTestId("studio-cell"));
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

    fireEvent.click(screen.getByTestId("studio-cell"));
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
    vi.mocked(generateDesign).mockRejectedValueOnce(new Error("boom"));
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

    fireEvent.click(screen.getByTestId("studio-cell"));
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

    fireEvent.click(screen.getByTestId("studio-cell"));
    submitText("make it blue");

    expect(screen.getByTestId("cap-notice").textContent).toContain("3 generating");
    expect(
      (screen.getByTestId("studio-generate") as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it("a lane with only an optimistic cell is not selectable", () => {
    deferGenerate();
    render(<StudioClient initialLanes={[lane({ cells: [cell("img-1")] })]} />);

    fireEvent.click(screen.getByTestId("studio-cell"));
    submitText("make it blue");
    fireEvent.click(screen.getByTestId("select-mode"));

    const box = screen.getByTestId("lane-checkbox") as HTMLInputElement;
    expect(box.disabled).toBe(true);
    fireEvent.click(screen.getByTestId("select-all"));
    expect(screen.getByTestId("selected-count").textContent).toBe("0 selected");
  });

  it("leaves the anchor where the user put it across the submit", () => {
    deferGenerate();
    render(<StudioClient initialLanes={[lane({ cells: [cell("img-1")] })]} />);

    fireEvent.click(screen.getByTestId("studio-cell"));
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
      fireEvent.click(screen.getByTestId("studio-cell"));
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

    fireEvent.click(screen.getByTestId("studio-cell"));
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
