import { describe, it, expect } from "vitest";
import {
  normalizeFrontPin,
  swapPlacementPins,
  resolveBuyPageFront,
  buyPagePlacements,
} from "../placement-pins";

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

describe("resolveBuyPageFront (#138 slice 3, swap only)", () => {
  it("no front → the page image", () => {
    expect(
      resolveBuyPageFront({ pageImageId: "P", front: undefined, back: null })
    ).toBe("P");
    expect(
      resolveBuyPageFront({ pageImageId: "P", front: null, back: "B" })
    ).toBe("P");
  });

  it("a front equal to the page image is not an override", () => {
    expect(
      resolveBuyPageFront({ pageImageId: "P", front: "P", back: "B" })
    ).toBe("P");
  });

  it("a different front is allowed as a swap (page image on the back)", () => {
    expect(
      resolveBuyPageFront({ pageImageId: "P", front: "B", back: "P" })
    ).toBe("B");
  });

  it("refuses a different front when the page image is not the back", () => {
    // Another image on the back: the page image would not be printed.
    expect(() =>
      resolveBuyPageFront({ pageImageId: "P", front: "B", back: "C" })
    ).toThrow("A different front needs this design on the back");
    // No back at all (e.g. dropped because the flag is off).
    expect(() =>
      resolveBuyPageFront({ pageImageId: "P", front: "B", back: null })
    ).toThrow("A different front needs this design on the back");
    expect(() =>
      resolveBuyPageFront({ pageImageId: "P", front: "B", back: undefined })
    ).toThrow("A different front needs this design on the back");
  });
});

describe("buyPagePlacements (#138 slice 3)", () => {
  const page = { id: "P", imageUrl: "https://img.example/p.png" };
  const added = { id: "B", imageUrl: "https://img.example/b.png" };

  it("nothing added: the page image alone, on the front", () => {
    expect(buyPagePlacements({ page, added: null, swapped: false })).toEqual({
      front: page,
      back: null,
    });
  });

  it("swapped with nothing added changes nothing", () => {
    expect(buyPagePlacements({ page, added: null, swapped: true })).toEqual({
      front: page,
      back: null,
    });
  });

  it("an added back sits on the back until swapped", () => {
    expect(buyPagePlacements({ page, added, swapped: false })).toEqual({
      front: page,
      back: added,
    });
  });

  it("swapped: the added image is the front and the page image the back", () => {
    expect(buyPagePlacements({ page, added, swapped: true })).toEqual({
      front: added,
      back: page,
    });
  });
});
