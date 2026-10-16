import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ConversationActions } from "../conversation-actions";
import { openConversation } from "@/app/d/conversation-actions";
import { deleteDesign } from "@/app/designs/actions";
import { OPEN_CONVERSATION_FAILED, DELETE_CONVERSATION_FAILED } from "@/lib/action-copy";
import { focusHref } from "@/lib/studio-focus";

vi.mock("@/app/d/conversation-actions", () => ({ openConversation: vi.fn() }));
vi.mock("@/app/designs/actions", () => ({ deleteDesign: vi.fn() }));

const assign = vi.fn();
let restoreLocation: (() => void) | null = null;

/** jsdom does not navigate and reports "Not implemented", so a stub that
 * records assign() is the only way a test can see where the page went. */
function stubLocationAssign() {
  const original = window.location;
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { assign },
  });
  restoreLocation = () =>
    Object.defineProperty(window, "location", { configurable: true, value: original });
}

beforeEach(() => {
  vi.spyOn(window, "alert").mockImplementation(() => {});
  assign.mockReset();
  stubLocationAssign();
});
afterEach(() => {
  restoreLocation?.();
  restoreLocation = null;
  vi.restoreAllMocks();
});

/** Walk the confirm sheet #200 puts in front of Delete. */
async function confirmDelete() {
  await act(async () => {
    fireEvent.click(screen.getByText("Delete conversation"));
  });
  await act(async () => {
    fireEvent.click(screen.getByTestId("confirm-sheet-confirm"));
  });
}

describe("ConversationActions", () => {
  it("reopens, then opens the Studio's stage on this page's image (R4)", async () => {
    const order: string[] = [];
    vi.mocked(openConversation).mockImplementationOnce(async () => {
      order.push("open");
    });
    assign.mockImplementation(() => {
      order.push("assign");
    });
    render(<ConversationActions designId="d1" imageId="img-1" archived />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("open-conversation"));
    });
    expect(openConversation).toHaveBeenCalledWith("d1");
    expect(assign).toHaveBeenCalledWith(focusHref({ designId: "d1", imageId: "img-1" }));
    expect(assign.mock.calls[0][0]).not.toContain("/design?");
    expect(order).toEqual(["open", "assign"]);
  });

  it("does not navigate when reopening fails", async () => {
    vi.mocked(openConversation).mockRejectedValueOnce(new Error("Unauthorized"));
    render(<ConversationActions designId="d1" imageId="img-1" archived={false} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("open-conversation"));
    });
    expect(assign).not.toHaveBeenCalled();
  });

  it("shows an inline line and no alert when opening fails", async () => {
    vi.mocked(openConversation).mockRejectedValueOnce(new Error("Unauthorized"));
    render(<ConversationActions designId="d1" imageId="img-1" archived={false} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("open-conversation"));
    });
    expect(screen.getByTestId("inline-notice")).toHaveTextContent(OPEN_CONVERSATION_FAILED);
    expect(window.alert).not.toHaveBeenCalled();
  });

  it("shows a structured refusal verbatim", async () => {
    vi.mocked(deleteDesign).mockResolvedValueOnce({ error: "This design has an order on it." });
    render(<ConversationActions designId="d1" imageId="img-1" archived={false} />);
    await confirmDelete();
    expect(screen.getByTestId("inline-notice")).toHaveTextContent("This design has an order on it.");
    expect(window.alert).not.toHaveBeenCalled();
  });

  it("shows the generic delete line when the action throws", async () => {
    vi.mocked(deleteDesign).mockRejectedValueOnce(new Error("boom"));
    render(<ConversationActions designId="d1" imageId="img-1" archived={false} />);
    await confirmDelete();
    expect(screen.getByTestId("inline-notice")).toHaveTextContent(DELETE_CONVERSATION_FAILED);
    expect(screen.queryByText("boom")).toBeNull();
    expect(window.alert).not.toHaveBeenCalled();
  });
});
