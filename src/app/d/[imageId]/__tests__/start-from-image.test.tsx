import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StartFromImage } from "../start-from-image";
import { startConversationFromImage } from "@/app/design/actions";
import { START_FROM_IMAGE_FAILED } from "@/lib/action-copy";

vi.mock("@/app/design/actions", () => ({ startConversationFromImage: vi.fn() }));
vi.mock("@/lib/ensure-guest-session", () => ({ ensureGuestSession: vi.fn(async () => {}) }));

beforeEach(() => {
  vi.spyOn(window, "alert").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("StartFromImage", () => {
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
