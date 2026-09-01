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
}));
vi.mock("@/app/design/actions", () => ({
  generateDesign: vi.fn(async () => ({
    kind: "queued",
    jobId: "job-new",
    generationNumber: 1,
    imageId: "img-new",
  })),
  closeConversation: vi.fn(async () => {}),
}));

import { getStudioLanes } from "../actions";
import { generateDesign, closeConversation } from "@/app/design/actions";

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
