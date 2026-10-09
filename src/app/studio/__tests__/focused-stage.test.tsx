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
import { FocusedStage } from "../focused-stage";

window.HTMLElement.prototype.scrollIntoView = vi.fn();

function cell(imageId: string, over: Partial<StudioLane["cells"][number]> = {}) {
  return { imageId, imageUrl: `https://cdn.example/${imageId}.png`, isPrimary: false, createdAt: new Date(), backdropColor: null, ...over };
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
    expect(frame.style.backgroundColor).not.toBe("");
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
    renderStage();
    const toggle = screen.getByRole("button", { name: "History · 4 messages" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(getConversationHistory).not.toHaveBeenCalled();
    fireEvent.click(toggle);
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

  it("uses the singular label for one message", () => {
    renderStage({ lane: lane({ messageCount: 1 }) });
    expect(screen.getByRole("button", { name: "History · 1 message" })).toBeTruthy();
  });

  it("history shows a plain failure line when the fetch throws", async () => {
    vi.mocked(getConversationHistory).mockRejectedValueOnce(new Error("boom"));
    renderStage();
    fireEvent.click(screen.getByRole("button", { name: "History · 4 messages" }));
    await waitFor(() => expect(screen.getByText("Couldn't load the history.")).toBeTruthy());
  });
});
