import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("@/app/designs/actions", () => ({
  unpublishImage: vi.fn(async () => {}),
  updatePublishedNaming: vi.fn(async () => {}),
}));

import { unpublishImage } from "@/app/designs/actions";
import { UnpublishAction } from "../unpublish-action";
import { UNPUBLISH_UPLOAD_BODY, UNPUBLISH_UPLOAD_TITLE } from "@/lib/action-copy";

describe("UnpublishAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("confirms before un-publishing, then sends the owner to My Designs", async () => {
    render(<UnpublishAction imageId="img-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Un-publish" }));
    // The confirm sheet, not window.confirm (#200).
    expect(
      screen.getByText("Take this design down from the storefront?")
    ).toBeInTheDocument();
    expect(unpublishImage).not.toHaveBeenCalled();

    // Preflight ruling P2: target the sheet's own testid, not an index into a
    // role query — the trigger and the confirm share the label "Un-publish".
    fireEvent.click(screen.getByTestId("confirm-sheet-confirm"));
    await waitFor(() => expect(unpublishImage).toHaveBeenCalledWith("img-1"));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/designs"));
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.queryByText(UNPUBLISH_UPLOAD_TITLE)).not.toBeInTheDocument();
  });

  it("keeps the design copy for a non-upload", () => {
    render(<UnpublishAction imageId="img-1" isUpload={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Un-publish" }));
    expect(
      screen.getByText("Take this design down from the storefront?")
    ).toBeInTheDocument();
    expect(screen.getByText("You can re-publish it later.")).toBeInTheDocument();
  });

  it("uses the photo copy for an upload and stays put afterwards", async () => {
    render(<UnpublishAction imageId="img-1" isUpload />);
    fireEvent.click(screen.getByRole("button", { name: "Un-publish" }));
    expect(screen.getByText(UNPUBLISH_UPLOAD_TITLE)).toBeInTheDocument();
    expect(screen.getByText(UNPUBLISH_UPLOAD_BODY)).toBeInTheDocument();
    expect(
      screen.queryByText("Take this design down from the storefront?")
    ).not.toBeInTheDocument();
    expect(screen.queryByText("You can re-publish it later.")).not.toBeInTheDocument();
    // The confirm label is unchanged.
    expect(screen.getByTestId("confirm-sheet-confirm")).toHaveTextContent("Un-publish");
    expect(unpublishImage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("confirm-sheet-confirm"));
    await waitFor(() => expect(unpublishImage).toHaveBeenCalledWith("img-1"));
    // The action's own revalidatePath re-renders the page; the component
    // navigates nowhere and does not refresh a second time.
    await waitFor(() => expect(screen.getByRole("button", { name: "Un-publish" })).toBeEnabled());
    expect(push).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("does nothing for an upload when the confirm is dismissed", async () => {
    render(<UnpublishAction imageId="img-1" isUpload />);
    fireEvent.click(screen.getByRole("button", { name: "Un-publish" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByText(UNPUBLISH_UPLOAD_TITLE)).not.toBeInTheDocument()
    );
    expect(unpublishImage).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("does nothing when the confirm is dismissed", async () => {
    render(<UnpublishAction imageId="img-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Un-publish" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(
        screen.queryByText("Take this design down from the storefront?")
      ).not.toBeInTheDocument()
    );
    expect(unpublishImage).not.toHaveBeenCalled();
  });
});
