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
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { StudioClient } from "../studio-client";
import type { StudioLane } from "@/lib/studio";

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
  beforeEach(() => {
    // The confirm is the only thing standing between a tap and a delete.
    window.confirm = vi.fn(() => true);
  });

  it("Delete removes the lane and deletes the conversation", async () => {
    render(<StudioClient initialLanes={[lane()]} />);

    fireEvent.click(screen.getByTestId("studio-delete-lane"));

    expect(screen.queryByTestId("studio-lane")).toBeNull();
    await waitFor(() => expect(deleteDesign).toHaveBeenCalledWith("design-1"));
  });

  it("keeps the lane and shows the reason when the delete is refused", async () => {
    vi.mocked(deleteDesign).mockResolvedValueOnce({
      error: "This design is used by a shop product. Delete the product first.",
    });
    render(<StudioClient initialLanes={[lane()]} />);

    fireEvent.click(screen.getByTestId("studio-delete-lane"));

    await waitFor(() => expect(screen.getByTestId("studio-lane")).toBeTruthy());
    expect(screen.getByText(/used by a shop product/)).toBeTruthy();
  });

  it("does nothing when the confirm is dismissed", () => {
    window.confirm = vi.fn(() => false);
    render(<StudioClient initialLanes={[lane()]} />);

    fireEvent.click(screen.getByTestId("studio-delete-lane"));

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

  beforeEach(() => {
    window.confirm = vi.fn(() => true);
  });

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

    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(vi.mocked(window.confirm).mock.calls[0][0]).toContain(
      "Delete 2 conversations and their images?"
    );
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
    vi.mocked(deleteConversations).mockResolvedValueOnce({
      deleted: ["d1"],
      skipped: [{ id: "d2", reason: "ordered" }],
    });
    // d3 was deleted too in the mock's view; the server says d2 survives.
    h.polledLanes = [three()[1]];
    render(<StudioClient initialLanes={three()} />);
    fireEvent.click(screen.getByTestId("select-mode"));
    fireEvent.click(screen.getByTestId("select-all"));

    fireEvent.click(screen.getByTestId("bulk-delete"));

    // Optimistically all three leave…
    expect(screen.queryByTestId("studio-lane")).toBeNull();
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

    await waitFor(() =>
      expect(screen.getAllByTestId("studio-lane")).toHaveLength(3)
    );
    expect(screen.getByText(/Couldn't delete those designs/)).toBeTruthy();
  });

  it("does nothing when the confirm is dismissed", () => {
    window.confirm = vi.fn(() => false);
    render(<StudioClient initialLanes={three()} />);
    fireEvent.click(screen.getByTestId("select-mode"));
    fireEvent.click(screen.getByTestId("select-all"));

    fireEvent.click(screen.getByTestId("bulk-delete"));

    expect(deleteConversations).not.toHaveBeenCalled();
    expect(screen.getAllByTestId("studio-lane")).toHaveLength(3);
    expect(screen.getByTestId("select-bar")).toBeTruthy();
  });
});
