import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DEFAULT_BLANK_ID, getColorHex } from "@/lib/blanks";
import { PublishedImageView } from "../published-image-view";
import { INSET_FOCUS_RING } from "@/lib/focus-ring";

const updatePublishedNaming = vi.fn(async () => ({}));
vi.mock("@/app/designs/actions", () => ({
  updatePublishedNaming: (...a: unknown[]) =>
    (updatePublishedNaming as (...x: unknown[]) => unknown)(...a),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

function renderView(canEdit = false, color: string | null = "Black") {
  return render(
    <PublishedImageView
      imageId="img-1"
      imageUrl="https://img.example/art.png"
      alt="Fox"
      initialBackgroundColor={color}
      canEdit={canEdit}
    />
  );
}

describe("PublishedImageView lightbox (#285)", () => {
  it("opens the artwork on its pinned backdrop from a View larger button", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "View larger: Fox" }));
    const viewer = screen.getByRole("dialog");
    const img = viewer.querySelector("img")!;
    expect(img).toHaveAttribute("src", "https://img.example/art.png");
    expect(img).toHaveAttribute("alt", "Fox");
    const faceBg = (img.parentElement as HTMLElement).style.backgroundColor;
    const blackHex = getColorHex(DEFAULT_BLANK_ID, "Black");
    // jsdom normalises the colour; compare through a probe element.
    const probe = document.createElement("div");
    probe.style.backgroundColor = blackHex;
    expect(faceBg).toBe(probe.style.backgroundColor);
  });

  it("Escape closes it and the card is still there", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "View larger: Fox" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByRole("button", { name: "View larger: Fox" })
    ).toBeInTheDocument();
  });

  it("works for the owner, whose picker stays under the card", () => {
    renderView(true);
    expect(screen.getByRole("button", { name: "View larger: Fox" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View larger: Fox" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("shows the backdrop the owner has just picked, not the one the page loaded with", async () => {
    renderView(true, "Black");
    // The picker is the only other group of buttons; pick White by name.
    fireEvent.click(screen.getByRole("button", { name: "White" }));
    await waitFor(() => expect(updatePublishedNaming).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "View larger: Fox" }));
    const img = screen.getByRole("dialog").querySelector("img")!;
    const probe = document.createElement("div");
    probe.style.backgroundColor = getColorHex(DEFAULT_BLANK_ID, "White");
    expect((img.parentElement as HTMLElement).style.backgroundColor).toBe(
      probe.style.backgroundColor
    );
  });

  it("keeps the artwork's alt in the button's name and the two-tone focus ring", () => {
    renderView();
    const btn = screen.getByRole("button", { name: "View larger: Fox" });
    expect(btn.className).toContain(INSET_FOCUS_RING);
    expect(btn.className).toContain("relative");
  });
});
