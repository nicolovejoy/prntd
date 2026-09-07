import { describe, it, expect } from "vitest";
import { breadcrumbTrail, upTarget, HOME } from "@/lib/nav";

describe("breadcrumbTrail", () => {
  it("returns no ancestors at the root", () => {
    expect(breadcrumbTrail("/")).toEqual([]);
  });

  it("places top-level hubs directly under Home", () => {
    for (const hub of ["/shop", "/studio", "/studio/library", "/orders", "/admin"]) {
      expect(breadcrumbTrail(hub)).toEqual([HOME]);
    }
  });

  it("builds the funnel spine and threads id into hrefs", () => {
    const params = { id: "abc", product: "bella-canvas-3001", color: "Black" };

    expect(breadcrumbTrail("/design", params).map((c) => c.label)).toEqual([
      "Home",
      "Studio",
    ]);

    expect(breadcrumbTrail("/preview", params).at(-1)).toEqual({
      label: "Design",
      href: "/design?id=abc",
    });
  });

  it("has no trail for /order (redirect-only route)", () => {
    expect(breadcrumbTrail("/order", { id: "abc" })).toEqual([]);
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

  it("uses the recorded origin as the detail page's parent", () => {
    expect(breadcrumbTrail("/d/img1", { from: "/studio/library" }).at(-1)).toEqual({
      label: "My Designs",
      href: "/studio/library",
    });
    expect(breadcrumbTrail("/d/img1", { from: "/orders" }).at(-1)).toEqual({
      label: "Orders",
      href: "/orders",
    });
    expect(breadcrumbTrail("/d/img1", { from: "/shop" }).at(-1)).toEqual({
      label: "Shop",
      href: "/shop",
    });
  });

  it("still resolves the retired origins /designs and /prints", () => {
    // Links shared before nav model A carry the old markers; they must not
    // fall through to the Shop default.
    expect(breadcrumbTrail("/d/img1", { from: "/designs" }).at(-1)).toEqual({
      label: "My Designs",
      href: "/studio/library",
    });
    expect(breadcrumbTrail("/d/img1", { from: "/prints" }).at(-1)).toEqual({
      label: "Shop",
      href: "/shop",
    });
  });

  it("falls back to the Shop when there is no recorded origin", () => {
    expect(breadcrumbTrail("/d/img1").at(-1)).toEqual({
      label: "Shop",
      href: "/shop",
    });
  });

  it("puts the thread and the preview under the Studio", () => {
    expect(upTarget("/design")).toEqual({ label: "Studio", href: "/studio" });
    expect(breadcrumbTrail("/preview", { id: "d1" })).toEqual([
      HOME,
      { label: "Studio", href: "/studio" },
      { label: "Design", href: "/design?id=d1" },
    ]);
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
    expect(upTarget("/preview", { id: "x" })).toEqual({
      label: "Design",
      href: "/design?id=x",
    });
  });

  it("is null at the root", () => {
    expect(upTarget("/")).toBeNull();
  });

  it("is Home at a top-level hub", () => {
    expect(upTarget("/shop")).toEqual(HOME);
  });
});
