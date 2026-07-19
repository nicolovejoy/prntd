import { describe, expect, it } from "vitest";
import { isFunnelRoute } from "@/lib/funnel-routes";

describe("isFunnelRoute", () => {
  it("matches the purchase-path routes", () => {
    expect(isFunnelRoute("/design")).toBe(true);
    expect(isFunnelRoute("/preview")).toBe(true);
    expect(isFunnelRoute("/order")).toBe(true);
    expect(isFunnelRoute("/order/confirm")).toBe(true);
    expect(isFunnelRoute("/cart")).toBe(true);
  });

  it("does not match sibling routes sharing a prefix", () => {
    expect(isFunnelRoute("/designs")).toBe(false);
    expect(isFunnelRoute("/orders")).toBe(false);
  });

  it("does not match non-funnel pages", () => {
    expect(isFunnelRoute("/")).toBe(false);
    expect(isFunnelRoute("/prints")).toBe(false);
    expect(isFunnelRoute("/d/abc123")).toBe(false);
    expect(isFunnelRoute("/dashboard")).toBe(false);
    expect(isFunnelRoute("/admin")).toBe(false);
  });
});
