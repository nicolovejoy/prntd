import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { EditableNaming } from "../editable-naming";
import { EMPTY_TITLE_REJECTED, SAVE_TITLE_FAILED } from "@/lib/action-copy";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const updatePublishedNaming = vi.fn(async () => ({}) as { error?: string });
vi.mock("@/app/designs/actions", () => ({
  updatePublishedNaming: (...args: unknown[]) =>
    updatePublishedNaming(...(args as [])),
}));

describe("EditableNaming", () => {
  it("renders an Untitled heading for an unpublished, untitled image with no edit access", () => {
    render(<EditableNaming imageId="img-1" title={null} canEdit={false} />);
    expect(
      screen.getByRole("heading", { name: "Untitled" })
    ).toBeInTheDocument();
  });

  it("falls back to Untitled for an empty-string title, not a blank heading", () => {
    render(<EditableNaming imageId="img-1" title="" canEdit={false} />);
    expect(
      screen.getByRole("heading", { name: "Untitled" })
    ).toBeInTheDocument();
  });
});

describe("EditableNaming — blank titles", () => {
  beforeEach(() => {
    updatePublishedNaming.mockReset();
    updatePublishedNaming.mockResolvedValue({});
  });

  it("disables Save while the trimmed draft is empty", async () => {
    render(<EditableNaming imageId="img-1" title="Real Title" canEdit />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const input = screen.getByPlaceholderText("Title");
    fireEvent.change(input, { target: { value: "" } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "   x" } });
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  // A disabled <button> does not dispatch a click's activation behaviour
  // under jsdom — verified empirically: fireEvent.click on a disabled
  // button never reaches its onClick handler here, with 0 calls recorded
  // regardless of what handleSave's body does. So this test (like its
  // "disables Save" sibling above) can only ever pin the disabled
  // attribute, never the `if (blank) return;` guard inside handleSave —
  // and structurally it never could: `disabled={saving || blank}` means
  // blank can't be true while the button is enabled. See the comment at
  // the guard in editable-naming.tsx for the coverage this leaves.
  it("keeps Save disabled so the action is never reached with a blank title", async () => {
    render(<EditableNaming imageId="img-1" title="Real Title" canEdit />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByPlaceholderText("Title"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(updatePublishedNaming).not.toHaveBeenCalled();
  });

  it("shows the server's refusal verbatim and stays in the editor", async () => {
    updatePublishedNaming.mockResolvedValue({ error: EMPTY_TITLE_REJECTED });
    render(<EditableNaming imageId="img-1" title="Real Title" canEdit />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByPlaceholderText("Title"), {
      target: { value: "Real Title!" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    expect(await screen.findByTestId("inline-notice")).toHaveTextContent(
      EMPTY_TITLE_REJECTED
    );
    // Still editing — the draft is not silently discarded.
    expect(screen.getByPlaceholderText("Title")).toBeInTheDocument();
  });

  it("shows the generic failure line, not the thrown message, when the action rejects", async () => {
    updatePublishedNaming.mockRejectedValue(new Error("ECONNRESET"));
    render(<EditableNaming imageId="img-1" title="Real Title" canEdit />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByPlaceholderText("Title"), {
      target: { value: "Real Title!" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    const notice = await screen.findByTestId("inline-notice");
    expect(notice).toHaveTextContent(SAVE_TITLE_FAILED);
    // A thrown error is a digest in production, not this string — it must
    // never reach the reader.
    expect(notice).not.toHaveTextContent("ECONNRESET");
  });

  it("closes the editor on a successful save", async () => {
    render(<EditableNaming imageId="img-1" title="Real Title" canEdit />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByPlaceholderText("Title"), {
      target: { value: "Real Title!" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    expect(
      await screen.findByRole("heading", { name: "Real Title" })
    ).toBeInTheDocument();
  });
});
