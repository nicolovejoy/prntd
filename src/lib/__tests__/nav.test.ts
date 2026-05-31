import { describe, it, expect } from "vitest";
import { breadcrumbTrail, upTarget, HOME } from "@/lib/nav";

describe("breadcrumbTrail", () => {
  it("returns no ancestors at the root", () => {
    expect(breadcrumbTrail("/")).toEqual([]);
  });

  it("places top-level hubs directly under Home", () => {
    for (const hub of ["/prints", "/designs", "/orders", "/admin"]) {
      expect(breadcrumbTrail(hub)).toEqual([HOME]);
    }
  });

  it("builds the funnel spine and threads id/product/color into hrefs", () => {
    const params = { id: "abc", product: "bella-canvas-3001", color: "Black" };

    expect(breadcrumbTrail("/design", params).map((c) => c.label)).toEqual([
      "Home",
      "My Designs",
    ]);

    expect(breadcrumbTrail("/preview", params).at(-1)).toEqual({
      label: "Design",
      href: "/design?id=abc",
    });

    expect(breadcrumbTrail("/order", params).at(-1)).toEqual({
      label: "Preview",
      href: "/preview?id=abc&product=bella-canvas-3001",
    });
  });

  it("sends the terminal confirm page up to order history, not the funnel", () => {
    expect(breadcrumbTrail("/order/confirm", { id: "abc" })).toEqual([
      HOME,
      { label: "Orders", href: "/orders" },
    ]);
  });

  it("omits absent params from funnel hrefs", () => {
    expect(breadcrumbTrail("/preview", {}).at(-1)).toEqual({
      label: "Design",
      href: "/design",
    });
  });

  it("derives a design detail's parent from ?from", () => {
    expect(breadcrumbTrail("/d/img1", { from: "/designs" }).at(-1)).toEqual({
      label: "My Designs",
      href: "/designs",
    });
    expect(breadcrumbTrail("/d/img1", { from: "/orders" }).at(-1)).toEqual({
      label: "Orders",
      href: "/orders",
    });
    expect(breadcrumbTrail("/d/img1", { from: "/prints" }).at(-1)).toEqual({
      label: "Fresh Prints",
      href: "/prints",
    });
  });

  it("falls back to Fresh Prints for a design detail with no origin", () => {
    expect(breadcrumbTrail("/d/img1").at(-1)).toEqual({
      label: "Fresh Prints",
      href: "/prints",
    });
  });

  it("nests admin detail pages under Admin", () => {
    expect(breadcrumbTrail("/admin/orders/o1").at(-1)).toEqual({
      label: "Admin",
      href: "/admin",
    });
    expect(breadcrumbTrail("/admin/published").at(-1)).toEqual({
      label: "Admin",
      href: "/admin",
    });
  });

  it("returns [] for unknown routes", () => {
    expect(breadcrumbTrail("/sign-in")).toEqual([]);
  });
});

describe("upTarget", () => {
  it("is the immediate parent (last crumb)", () => {
    expect(upTarget("/order", { id: "x" })).toEqual({
      label: "Preview",
      href: "/preview?id=x",
    });
  });

  it("is null at the root", () => {
    expect(upTarget("/")).toBeNull();
  });

  it("is Home at a top-level hub", () => {
    expect(upTarget("/prints")).toEqual(HOME);
  });
});
