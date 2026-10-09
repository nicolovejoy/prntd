// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { StudioLane } from "@/lib/studio";

vi.mock("../actions", () => ({
  getConversationHistory: vi.fn(async () => [
    { id: "m1", role: "user", content: "a bear reading", imageId: null, createdAt: new Date(1) },
    { id: "m2", role: "assistant", content: "Rendered.", imageId: "b", createdAt: new Date(2) },
  ]),
}));
import { getConversationHistory } from "../actions";
import { getColorHex } from "@/lib/blanks";
import { FocusedStage } from "../focused-stage";

window.HTMLElement.prototype.scrollIntoView = vi.fn();

function cell(imageId: string, over: Partial<StudioLane["cells"][number]> = {}) {
  return { imageId, imageUrl: `https://cdn.example/${imageId}.png`, isPrimary: false, createdAt: new Date(), backdropColor: null, luminance: null, ...over };
}
function lane(over: Partial<StudioLane> = {}): StudioLane {
  return { designId: "d1", title: "woodcut bear", lastActiveAt: new Date(), messageCount: 4, cells: [cell("a"), cell("b"), cell("c")], pending: [], ...over };
}

/** The props half of renderStage, for tests that render more than once. */
function renderStageProps(over: Partial<Parameters<typeof FocusedStage>[0]> = {}) {
  return {
    lane: lane(),
    index: 1,
    nowMs: Date.now(),
    composer: <div data-testid="composer-slot" />,
    unresolvedCellIds: new Set<string>(),
    onBack: vi.fn((e) => e.preventDefault()),
    onPickResult: vi.fn((_i, e) => e.preventDefault()),
    onNewDesign: vi.fn((e) => e.preventDefault()),
    onCancel: vi.fn(),
    focusHrefFor: (i: number) => `/studio?conversation=d1&image=${["a", "b", "c"][i]}`,
    benchHref: "/studio",
    ...over,
  };
}

function renderStage(over: Partial<Parameters<typeof FocusedStage>[0]> = {}) {
  const props = renderStageProps(over);
  render(<FocusedStage {...props} />);
  return props;
}

beforeEach(() => vi.clearAllMocks());

describe("FocusedStage", () => {
  it("shows the result count, the image, and the composer slot", () => {
    renderStage();
    expect(screen.getByText("Result 2 of 3")).toBeTruthy();
    expect(screen.getByTestId("stage-image").getAttribute("alt")).toBe("");
    expect(screen.getByTestId("composer-slot")).toBeTruthy();
  });

  it("paints a published result on its backdrop with the caption; unpublished on the well without one", () => {
    const { unmount } = render(
      <FocusedStage {...renderStageProps({ lane: lane({ cells: [cell("a", { backdropColor: "Navy" })] }), index: 0 })} />
    );
    const frame = screen.getByTestId("stage-frame");
    // jsdom normalises the hex to rgb(); set the same hex on a probe to compare.
    const probe = document.createElement("div");
    probe.style.backgroundColor = getColorHex("bella-canvas-3001", "Navy");
    expect(probe.style.backgroundColor).not.toBe("");
    expect(frame.style.backgroundColor).toBe(probe.style.backgroundColor);
    expect(screen.getByText("Shown on Navy")).toBeTruthy();
    unmount();
    renderStage({ index: 0 });
    expect(screen.getByTestId("stage-frame").className).toContain("bg-surface-well");
    expect(screen.queryByText(/Shown on/)).toBeNull();
  });

  it("links Order, Open and New design", () => {
    const props = renderStage();
    expect(screen.getByRole("link", { name: "Order" }).getAttribute("href")).toBe("/d/b?order=1&from=%2Fstudio");
    expect(screen.getByRole("link", { name: "Open" }).getAttribute("href")).toBe("/d/b");
    fireEvent.click(screen.getByRole("link", { name: "New design" }));
    expect(props.onNewDesign).toHaveBeenCalled();
  });

  it("← Studio and the result thumbnails are real links that report the click", () => {
    const props = renderStage();
    const back = screen.getByRole("link", { name: "← Studio" });
    expect(back.getAttribute("href")).toBe("/studio");
    fireEvent.click(back);
    expect(props.onBack).toHaveBeenCalled();
    const strip = screen.getByTestId("stage-results");
    const thumbs = within(strip).getAllByRole("link");
    expect(thumbs).toHaveLength(3);
    expect(thumbs[1].getAttribute("aria-current")).toBe("true");
    expect(thumbs[2].getAttribute("href")).toBe("/studio?conversation=d1&image=c");
    fireEvent.click(thumbs[2]);
    expect(props.onPickResult).toHaveBeenCalledWith(2, expect.anything());
  });

  it("renders pending jobs as dashed cells with a Cancel line, inert until resolved", () => {
    const props = renderStage({
      lane: lane({ pending: [{ jobId: "j1", generationNumber: 4, startedAt: new Date(Date.now() - 12_000) }, { jobId: "local-2", generationNumber: 0, startedAt: new Date(), optimistic: true }] }),
      unresolvedCellIds: new Set(["local-2"]),
    });
    expect(screen.getAllByTestId("stage-pending-cell")).toHaveLength(2);
    const cancels = screen.getAllByTestId("cancel-generation");
    expect(cancels).toHaveLength(1);
    fireEvent.click(cancels[0]);
    expect(props.onCancel).toHaveBeenCalledWith("j1");
    expect(screen.getAllByTestId("cancel-generation-placeholder")).toHaveLength(1);
  });

  it("history is collapsed, fetches once on open, and labels turns", async () => {
    // Two turns, as the mocked fetch returns: nothing new to refetch on reopen.
    renderStage({ lane: lane({ messageCount: 2 }) });
    const toggle = screen.getByRole("button", { name: "History · 2 messages" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(getConversationHistory).not.toHaveBeenCalled();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    await waitFor(() => expect(screen.getByText("a bear reading")).toBeTruthy());
    expect(screen.getByText("You")).toBeTruthy();
    expect(screen.getByText("PRNTD · Result 2")).toBeTruthy();
    expect(getConversationHistory).toHaveBeenCalledTimes(1);
    expect(getConversationHistory).toHaveBeenCalledWith("d1");
    fireEvent.click(toggle);
    expect(screen.queryByText("a bear reading")).toBeNull();
    fireEvent.click(toggle);
    expect(getConversationHistory).toHaveBeenCalledTimes(1);
  });

  it("reopening refetches when the conversation has gained turns since the last fetch", async () => {
    const props = renderStageProps({ lane: lane({ messageCount: 2 }) });
    const { rerender } = render(<FocusedStage {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "History · 2 messages" }));
    await waitFor(() => expect(screen.getByText("a bear reading")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "History · 2 messages" }));

    // A Generate on the stage wrote another turn; the poll brought the count.
    vi.mocked(getConversationHistory).mockResolvedValueOnce([
      { id: "m1", role: "user", content: "a bear reading", imageId: null, createdAt: new Date(1) },
      { id: "m2", role: "assistant", content: "Rendered.", imageId: "b", createdAt: new Date(2) },
      { id: "m3", role: "user", content: "make it red", imageId: null, createdAt: new Date(3) },
    ]);
    rerender(<FocusedStage {...props} lane={lane({ messageCount: 3 })} />);
    fireEvent.click(screen.getByRole("button", { name: "History · 3 messages" }));
    await waitFor(() => expect(screen.getByText("make it red")).toBeTruthy());
    expect(getConversationHistory).toHaveBeenCalledTimes(2);
  });

  it("scrolls the strip to the shown result, horizontally only", () => {
    // The strip spans 0–200; the shown thumbnail (index 2) sits at 260–316.
    const rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        const box =
          this.dataset.testid === "stage-results"
            ? { left: 0, right: 200 }
            : this.getAttribute("aria-current") === "true"
              ? { left: 260, right: 316 }
              : { left: 0, right: 0 };
        return { ...box, top: 0, bottom: 0, width: box.right - box.left, height: 0, x: box.left, y: 0, toJSON: () => ({}) } as DOMRect;
      });
    try {
      renderStage({ index: 2 });
      expect(screen.getByTestId("stage-results").scrollLeft).toBe(116);
      expect(window.HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
    } finally {
      rect.mockRestore();
    }
  });

  it("scrolls the strip to its right end while an edit is running", () => {
    const width = vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(480);
    try {
      renderStage({
        lane: lane({ pending: [{ jobId: "j1", generationNumber: 4, startedAt: new Date() }] }),
      });
      expect(screen.getByTestId("stage-results").scrollLeft).toBe(480);
    } finally {
      width.mockRestore();
    }
  });

  it("uses the singular label for one message", () => {
    renderStage({ lane: lane({ messageCount: 1 }) });
    expect(screen.getByRole("button", { name: "History · 1 message" })).toBeTruthy();
  });

  it("history shows a plain failure line when the fetch throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getConversationHistory).mockRejectedValueOnce(new Error("boom"));
    renderStage();
    fireEvent.click(screen.getByRole("button", { name: "History · 4 messages" }));
    await waitFor(() => expect(screen.getByText("Couldn't load the history.")).toBeTruthy());
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it("reopening after a failure refetches and drops the failure line", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getConversationHistory).mockRejectedValueOnce(new Error("boom"));
    renderStage();
    const toggle = screen.getByRole("button", { name: "History · 4 messages" });
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByText("Couldn't load the history.")).toBeTruthy());
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByText("a bear reading")).toBeTruthy());
    expect(screen.queryByText("Couldn't load the history.")).toBeNull();
    expect(getConversationHistory).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
  });

  it("shows Loading… while the fetch is pending and fetches once if reopened meanwhile", async () => {
    let resolve!: (v: Awaited<ReturnType<typeof getConversationHistory>>) => void;
    vi.mocked(getConversationHistory).mockImplementationOnce(
      () => new Promise((r) => { resolve = r; })
    );
    renderStage();
    const toggle = screen.getByRole("button", { name: "History · 4 messages" });
    fireEvent.click(toggle);
    expect(screen.getByText("Loading…")).toBeTruthy();
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(getConversationHistory).toHaveBeenCalledTimes(1);
    resolve([{ id: "m1", role: "user", content: "a bear reading", imageId: null, createdAt: new Date(1) }]);
    await waitFor(() => expect(screen.getByText("a bear reading")).toBeTruthy());
    expect(screen.queryByText("Loading…")).toBeNull();
  });
});
