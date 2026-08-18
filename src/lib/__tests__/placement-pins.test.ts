import { describe, it, expect } from "vitest";
import { normalizeFrontPin, swapPlacementPins } from "../placement-pins";

describe("normalizeFrontPin", () => {
  it("picking the primary is the default, not a pin", () => {
    expect(normalizeFrontPin("img-primary", "img-primary")).toBeNull();
  });

  it("picking any other image is a pin", () => {
    expect(normalizeFrontPin("img-other", "img-primary")).toBe("img-other");
  });

  it("with no primary known, any pick is a pin", () => {
    expect(normalizeFrontPin("img-other", null)).toBe("img-other");
  });
});

describe("swapPlacementPins", () => {
  it("literally exchanges the two ids (§2)", () => {
    expect(
      swapPlacementPins({
        frontImageId: "A",
        backImageId: "B",
        primaryImageId: "P",
      })
    ).toEqual({ front: "B", back: "A" });
  });

  it("a back that is the primary swaps in as the default front (null pin)", () => {
    expect(
      swapPlacementPins({
        frontImageId: "A",
        backImageId: "P",
        primaryImageId: "P",
      })
    ).toEqual({ front: null, back: "A" });
  });

  it("the default front (primary) swaps out as an explicit back id", () => {
    // Caller passes the EFFECTIVE front — the primary when unpinned — so the
    // back keeps a concrete id, never null.
    expect(
      swapPlacementPins({
        frontImageId: "P",
        backImageId: "B",
        primaryImageId: "P",
      })
    ).toEqual({ front: "B", back: "P" });
  });

  it("double swap restores the original pins", () => {
    const once = swapPlacementPins({
      frontImageId: "P",
      backImageId: "B",
      primaryImageId: "P",
    });
    const twice = swapPlacementPins({
      frontImageId: once.front ?? "P",
      backImageId: once.back!,
      primaryImageId: "P",
    });
    expect(twice).toEqual({ front: null, back: "B" });
  });
});
