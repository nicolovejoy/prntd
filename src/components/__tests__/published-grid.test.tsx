/**
 * Shop card anatomy (Paper slice 6, #188). The card sells a shirt: art on its
 * pinned backdrop in a hairline frame, then title, then what it costs and on
 * what garment, then the maker.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PublishedGrid } from "@/components/published-grid";
import type { PublishedImage } from "@/app/d/actions";

function img(over: Partial<PublishedImage> = {}): PublishedImage {
  return {
    imageId: "i1",
    imageUrl: "https://example.com/a.png",
    title: "Dapper Whale",
    description: null,
    backgroundColor: null,
    designerName: "Nico",
    designerId: "u1",
    isOwn: false,
    publishedAt: new Date("2026-09-01T00:00:00Z"),
    forkChain: [],
    ...over,
  };
}

describe("PublishedGrid", () => {
  it("prices the card by its garment", () => {
    render(<PublishedGrid images={[img()]} />);
    expect(screen.getByText("From $19.43 · Classic Tee")).toBeTruthy();
  });

  it("prices a composition that fixes a garment off that garment", () => {
    render(<PublishedGrid images={[img({ blankId: "cotton-heritage-mc1087" })]} />);
    expect(screen.getByText("From $26.18 · Box Tee")).toBeTruthy();
  });

  it("falls back to Untitled rather than dropping the title line", () => {
    render(<PublishedGrid images={[img({ title: null })]} />);
    expect(screen.getByText("Untitled")).toBeTruthy();
  });

  it("attributes the maker, and says 'by you' for the viewer's own", () => {
    render(<PublishedGrid images={[img(), img({ imageId: "i2", isOwn: true })]} />);
    expect(screen.getByText("by Nico")).toBeTruthy();
    expect(screen.getByText("by you")).toBeTruthy();
  });

  it("paints the pinned backdrop, defaulting a legacy null to White (#76)", () => {
    const { container } = render(
      <PublishedGrid images={[img({ backgroundColor: "Black" })]} />
    );
    const well = container.querySelector("[style*='background-color']");
    expect(well?.getAttribute("style")).toContain("12, 12, 12"); // #0c0c0c
    const plain = render(<PublishedGrid images={[img({ imageId: "i9" })]} />);
    expect(
      plain.container.querySelector("[style*='background-color']")?.getAttribute("style")
    ).toContain("255, 255, 255");
  });

  it("frames the art in a hairline that goes ink on hover, not a rounded accent tile", () => {
    const { container } = render(<PublishedGrid images={[img()]} />);
    const well = container.querySelector("[style*='background-color']")!;
    expect(well.className).toContain("border-border");
    expect(well.className).toContain("group-hover:border-border-hover");
    expect(well.className).not.toContain("rounded");
    expect(well.className).not.toContain("border-accent");
    expect(well.className).not.toContain("shadow");
  });

  it("is two columns on a phone, three at sm and four at lg", () => {
    render(<PublishedGrid images={[img()]} />);
    const grid = screen.getByTestId("published-grid");
    expect(grid.className).toContain("grid-cols-2");
    expect(grid.className).toContain("sm:grid-cols-3");
    expect(grid.className).toContain("lg:grid-cols-4");
    expect(grid.className).not.toContain("md:grid-cols-4");
  });

  it("keeps the lazy-loading attributes and a sizes hint matching those columns (#134/#144)", () => {
    render(<PublishedGrid images={[img()]} />);
    const el = screen.getByRole("img");
    expect(el.getAttribute("loading")).toBe("lazy");
    expect(el.getAttribute("decoding")).toBe("async");
    // The breakpoints in `sizes` must be the grid's own, or the browser
    // fetches a 25vw source for a 33vw slot between 768 and 1023px.
    expect(el.getAttribute("sizes")).toBe(
      "(max-width: 639px) 50vw, (max-width: 1023px) 33vw, 25vw"
    );
  });

  it("records the origin on each card link so Escape returns there", () => {
    render(<PublishedGrid images={[img()]} from="/shop" />);
    expect(screen.getByRole("link").getAttribute("href")).toBe(
      "/d/i1?from=%2Fshop"
    );
  });
});
