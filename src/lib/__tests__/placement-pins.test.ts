import { describe, it, expect } from "vitest";
import {
  resolveBuyPageFront,
  buyPagePlacements,
} from "../placement-pins";

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
