import { describe, expect, it } from "vitest";
import { isFunnelRoute } from "@/lib/funnel-routes";

describe("isFunnelRoute", () => {
  it("matches the purchase-path routes", () => {
    expect(isFunnelRoute("/design")).toBe(true);
    expect(isFunnelRoute("/preview")).toBe(true);
    expect(isFunnelRoute("/order")).toBe(true);
    expect(isFunnelRoute("/order/confirm")).toBe(true);
    expect(isFunnelRoute("/cart")).toBe(true);
    expect(isFunnelRoute("/studio")).toBe(true);
    // Bench has no fixed bottom chrome outside select mode now either (the
    // composer moved to a top panel, #188 slice 3); library and archive
    // never had any. The whole /studio prefix sweeps them all in regardless
    // (see the docblock in funnel-routes.ts) — pin that explicitly rather
    // than only covering the Bench tab.
    expect(isFunnelRoute("/studio/library")).toBe(true);
    // /d is the buy page; its sticky Add-to-cart bar is what the launcher
    // overlapped.
    expect(isFunnelRoute("/d")).toBe(true);
    expect(isFunnelRoute("/d/abc123")).toBe(true);
  });

  it("does not match sibling routes sharing a prefix", () => {
    expect(isFunnelRoute("/designs")).toBe(false);
    expect(isFunnelRoute("/orders")).toBe(false);
    // /dashboard shares its first two characters with the /d prefix but
    // never the "/d" or "/d/…" boundary the matcher requires — the same
    // trap /designs pins for /design.
    expect(isFunnelRoute("/dashboard")).toBe(false);
  });

  it("does not match non-funnel pages", () => {
    expect(isFunnelRoute("/")).toBe(false);
    expect(isFunnelRoute("/shop")).toBe(false);
    expect(isFunnelRoute("/admin")).toBe(false);
  });
});
