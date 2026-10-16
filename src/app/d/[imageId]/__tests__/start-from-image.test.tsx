import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StartFromImage } from "../start-from-image";
import { startConversationFromImage } from "@/app/design/actions";
import { START_FROM_IMAGE_FAILED } from "@/lib/action-copy";
import { focusHref } from "@/lib/studio-focus";

vi.mock("@/app/design/actions", () => ({ startConversationFromImage: vi.fn() }));
vi.mock("@/lib/ensure-guest-session", () => ({ ensureGuestSession: vi.fn(async () => {}) }));

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

describe("StartFromImage", () => {
  it("opens the Studio's stage on this image in the new conversation (R4)", async () => {
    vi.mocked(startConversationFromImage).mockResolvedValueOnce({ designId: "design-new" });
    render(<StartFromImage imageId="img-a" />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("start-from-image"));
    });
    expect(startConversationFromImage).toHaveBeenCalledWith("img-a");
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith(
      focusHref({ designId: "design-new", imageId: "img-a" })
    );
    expect(assign.mock.calls[0][0]).not.toContain("/design?");
  });

  it("does not navigate when the action throws", async () => {
    vi.mocked(startConversationFromImage).mockRejectedValueOnce(new Error("Unauthorized"));
    render(<StartFromImage imageId="img-a" />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("start-from-image"));
    });
    expect(assign).not.toHaveBeenCalled();
  });

  it("shows an inline failure line and no alert when the action throws", async () => {
    vi.mocked(startConversationFromImage).mockRejectedValueOnce(new Error("Unauthorized"));
    render(<StartFromImage imageId="img-a" />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("start-from-image"));
    });
    expect(screen.getByTestId("inline-notice")).toHaveTextContent(START_FROM_IMAGE_FAILED);
    expect(window.alert).not.toHaveBeenCalled();
    expect(screen.getByTestId("start-from-image")).toBeEnabled();
  });

  it("clears a previous failure line when the action is retried", async () => {
    vi.mocked(startConversationFromImage)
      .mockRejectedValueOnce(new Error("Unauthorized"))
      .mockImplementationOnce(() => new Promise(() => {}));
    render(<StartFromImage imageId="img-a" />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("start-from-image"));
    });
    expect(screen.getByTestId("inline-notice")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByTestId("start-from-image"));
    });
    expect(screen.queryByTestId("inline-notice")).not.toBeInTheDocument();
  });
});
