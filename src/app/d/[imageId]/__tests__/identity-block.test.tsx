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
  it("labels title, designer and price", () => {
    render(
      <IdentityBlock
        imageId="img-1"
        title="Dapper Whale"
        canEditTitle={false}
        designerName="Nico"
        priceFloor={19.43}
        forkChain={[]}
      />
    );
    expect(screen.getByText("Title")).toBeInTheDocument();
    expect(screen.getByText("Designed by")).toBeInTheDocument();
    expect(screen.getByText("Price")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Dapper Whale" })
    ).toBeInTheDocument();
    expect(screen.getByText("Nico")).toBeInTheDocument();
    // Item price floor only — never "shipped" (ruling R1).
    expect(screen.getByText("From $19.43")).toBeInTheDocument();
    expect(screen.queryByText(/shipped/i)).not.toBeInTheDocument();
  });

  it("omits the fork row when there is no fork chain", () => {
    render(
      <IdentityBlock
        imageId="img-1"
        title="Dapper Whale"
        canEditTitle={false}
        designerName="Nico"
        priceFloor={19.43}
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
        priceFloor={19.43}
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
});
