import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PublishModal } from "../publish-modal";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/app/designs/actions", () => ({
  publishImage: vi.fn().mockResolvedValue(undefined),
}));

import { publishImage } from "@/app/designs/actions";

/**
 * #140: publishing must force an explicit backdrop pick — no default color,
 * Publish stays disabled until the owner picks one. Regression coverage for
 * that gate; the full-vs-collapsed palette split itself is markup, covered
 * separately in background-picker.test.tsx.
 */
describe("PublishModal forced backdrop pick (#140)", () => {
  function publishButton() {
    return screen.getByRole("button", { name: "Publish" });
  }

  it("disables Publish until a backdrop swatch is picked", () => {
    render(
      <PublishModal
        imageId="img-1"
        imageUrl="https://img.example/art.png"
        open
        onClose={() => {}}
      />
    );
    expect(publishButton()).toBeDisabled();
  });

  it("enables Publish once a swatch is picked", () => {
    render(
      <PublishModal
        imageId="img-1"
        imageUrl="https://img.example/art.png"
        open
        onClose={() => {}}
      />
    );
    fireEvent.click(screen.getByTitle("Black"));
    expect(publishButton()).toBeEnabled();
  });

  it("never calls publishImage while no backdrop is picked", () => {
    render(
      <PublishModal imageId="img-1" open onClose={() => {}} />
    );
    fireEvent.click(publishButton());
    expect(publishImage).not.toHaveBeenCalled();
  });

  it("publishes with the picked backdrop color", async () => {
    render(
      <PublishModal imageId="img-1" open onClose={() => {}} />
    );
    fireEvent.click(screen.getByTitle("Navy"));
    fireEvent.click(publishButton());
    await waitFor(() =>
      expect(publishImage).toHaveBeenCalledWith(
        "img-1",
        expect.objectContaining({ backgroundColor: "Navy" })
      )
    );
  });

  it("shows the full palette, not the collapsed 5 + more", () => {
    render(
      <PublishModal imageId="img-1" open onClose={() => {}} />
    );
    expect(
      screen.queryByTestId("background-picker-expand")
    ).not.toBeInTheDocument();
    // Full Classic Tee palette includes colors well past the collapsed
    // row's first 5.
    expect(screen.getByTitle("Navy")).toBeInTheDocument();
  });
});

describe("PublishModal live preview (#140)", () => {
  it("renders no preview without an image URL", () => {
    render(<PublishModal imageId="img-1" open onClose={() => {}} />);
    expect(screen.queryByTestId("publish-preview")).not.toBeInTheDocument();
  });

  it("renders the artwork on a neutral backdrop before a pick", () => {
    render(
      <PublishModal
        imageId="img-1"
        imageUrl="https://img.example/art.png"
        open
        onClose={() => {}}
      />
    );
    const preview = screen.getByTestId("publish-preview");
    expect(preview.className).toContain("bg-checkerboard");
  });

  it("re-colors the preview to the picked backdrop", () => {
    render(
      <PublishModal
        imageId="img-1"
        imageUrl="https://img.example/art.png"
        open
        onClose={() => {}}
      />
    );
    fireEvent.click(screen.getByTitle("Black"));
    const preview = screen.getByTestId("publish-preview");
    expect(preview.className).not.toContain("bg-checkerboard");
    expect(preview.style.backgroundColor).not.toBe("");
  });
});
