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
    // The Studio bench has no fixed bottom chrome outside select mode now
    // either (the composer moved to a top panel, #188 slice 3) — only its
    // select-mode bar still sits at the bottom edge. /studio/library is now
    // only a 308 to /designs (nav model A, 2026-09-27), not a real view, but
    // the whole /studio prefix still sweeps it in regardless (see the
    // docblock in funnel-routes.ts) — pin that explicitly rather than only
    // covering the Studio bench.
    expect(isFunnelRoute("/studio/library")).toBe(true);
    // /designs (My Designs, moved out of the Studio by nav model A) has no
    // fixed bottom chrome of its own (its select controls are inline above
    // the grid) — it's listed for continuity with its old /studio/library
    // address, not because the launcher would overlap anything there.
    expect(isFunnelRoute("/designs")).toBe(true);
    expect(isFunnelRoute("/designs/whatever")).toBe(true);
    // /d is the buy page; its sticky Add-to-cart bar is what the launcher
    // overlapped.
    expect(isFunnelRoute("/d")).toBe(true);
    expect(isFunnelRoute("/d/abc123")).toBe(true);
    // /checkout is the embedded Stripe form page (#135 slice 2); its Pay
    // button is what the launcher overlapped.
    expect(isFunnelRoute("/checkout")).toBe(true);
  });

  it("does not match sibling routes sharing a prefix", () => {
    expect(isFunnelRoute("/orders")).toBe(false);
    // "/designer" shares the "/design" prefix as a substring but not the
    // "/design" or "/design/…" boundary the matcher requires — nor "/designs"
    // or "/designs/…" either, so it isn't swallowed by either listed prefix.
    expect(isFunnelRoute("/designer")).toBe(false);
    // /dashboard shares its first two characters with the /d prefix but
    // never the "/d" or "/d/…" boundary the matcher requires — the same
    // trap /designs would pin for /design, except /designs is its own
    // listed prefix now (nav model A) so that boundary is moot here.
    expect(isFunnelRoute("/dashboard")).toBe(false);
    // Same trap, one prefix over: shares "/checkout" as a substring but not
    // the "/checkout" or "/checkout/…" boundary.
    expect(isFunnelRoute("/checkouts")).toBe(false);
  });

  it("does not match non-funnel pages", () => {
    expect(isFunnelRoute("/")).toBe(false);
    expect(isFunnelRoute("/shop")).toBe(false);
    expect(isFunnelRoute("/admin")).toBe(false);
  });
});
