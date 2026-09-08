import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { IdentityBlock } from "../identity-block";

// EditableNaming is a client island with a router dependency; the block's own
// job is the labelled rows, so the title value is stubbed to a plain heading.
vi.mock("../editable-naming", () => ({
  EditableNaming: ({ title }: { title: string | null }) => (
    <h1>{title ?? "Untitled"}</h1>
  ),
}));

describe("IdentityBlock", () => {
  it("labels title and designer, and shows no price", () => {
    render(
      <IdentityBlock
        imageId="img-1"
        title="Dapper Whale"
        canEditTitle={false}
        designerName="Nico"
        forkChain={[]}
      />
    );
    expect(screen.getByText("Title")).toBeInTheDocument();
    expect(screen.getByText("Designed by")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Dapper Whale" })
    ).toBeInTheDocument();
    expect(screen.getByText("Nico")).toBeInTheDocument();
    // No price before garment + size are picked (Nico, 2026-09-08).
    expect(screen.queryByText("Price")).not.toBeInTheDocument();
    expect(screen.queryByText(/\$\d/)).not.toBeInTheDocument();
  });

  it("omits the fork row when there is no fork chain", () => {
    render(
      <IdentityBlock
        imageId="img-1"
        title="Dapper Whale"
        canEditTitle={false}
        designerName="Nico"
        forkChain={[]}
      />
    );
    expect(screen.queryByText("Forked from")).not.toBeInTheDocument();
  });

  it("renders the fork chain as links when present", () => {
    render(
      <IdentityBlock
        imageId="img-2"
        title="Remix"
        canEditTitle={false}
        designerName="Ada"
        forkChain={[
          { imageId: "img-1", title: "Original", designerName: "Nico" },
        ]}
      />
    );
    expect(screen.getByText("Forked from")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Original" });
    expect(link).toHaveAttribute("href", "/d/img-1");
    expect(screen.getByText(/by Nico/)).toBeInTheDocument();
  });

  it("falls back to 'an earlier design' for an empty-string fork-chain title, not a blank link", () => {
    render(
      <IdentityBlock
        imageId="img-2"
        title="Remix"
        canEditTitle={false}
        designerName="Ada"
        forkChain={[{ imageId: "img-1", title: "", designerName: "Nico" }]}
      />
    );
    const link = screen.getByRole("link", { name: "an earlier design" });
    expect(link).toHaveAttribute("href", "/d/img-1");
  });
});
