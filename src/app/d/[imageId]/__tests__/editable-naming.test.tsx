import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { EditableNaming } from "../editable-naming";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/app/designs/actions", () => ({
  updatePublishedNaming: vi.fn(async () => {}),
}));

describe("EditableNaming", () => {
  it("renders an Untitled heading for an unpublished, untitled image with no edit access", () => {
    render(<EditableNaming imageId="img-1" title={null} canEdit={false} />);
    expect(
      screen.getByRole("heading", { name: "Untitled" })
    ).toBeInTheDocument();
  });
});
