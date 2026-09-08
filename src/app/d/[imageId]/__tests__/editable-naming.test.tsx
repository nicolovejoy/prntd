import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { EditableNaming } from "../editable-naming";
import { EMPTY_TITLE_REJECTED } from "@/lib/action-copy";

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

  it("never calls the action with a blank title", async () => {
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
