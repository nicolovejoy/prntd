import { describe, it, expect } from "vitest";
import { designerAttribution } from "../order-attribution";

describe("designerAttribution", () => {
  it("returns the designer name when the buyer didn't design it (buy-existing)", () => {
    expect(
      designerAttribution({
        designerId: "designer-1",
        designerName: "Ada",
        buyerId: "buyer-2",
      })
    ).toBe("Ada");
  });

  it("returns null when buyer === designer (self-designed order)", () => {
    expect(
      designerAttribution({
        designerId: "user-1",
        designerName: "Ada",
        buyerId: "user-1",
      })
    ).toBeNull();
  });

  it("returns null when there's no designer id (e.g. orphaned design)", () => {
    expect(
      designerAttribution({
        designerId: null,
        designerName: "Ada",
        buyerId: "buyer-2",
      })
    ).toBeNull();
  });

  it("returns null when the designer differs but has no name", () => {
    expect(
      designerAttribution({
        designerId: "designer-1",
        designerName: null,
        buyerId: "buyer-2",
      })
    ).toBeNull();
  });
});
