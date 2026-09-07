import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("@/app/designs/actions", () => ({
  unpublishImage: vi.fn(async () => {}),
  updatePublishedNaming: vi.fn(async () => {}),
}));

import { unpublishImage } from "@/app/designs/actions";
import { UnpublishAction } from "../unpublish-action";

describe("UnpublishAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("confirms before un-publishing, then sends the owner to their library", async () => {
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
    await waitFor(() => expect(push).toHaveBeenCalledWith("/studio/library"));
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
