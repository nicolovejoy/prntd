import { describe, it, expect } from "vitest";
import {
  contributorAttribution,
  designerAttribution,
  placementImageIds,
  resolveContributors,
} from "../order-attribution";

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

describe("placementImageIds", () => {
  it("returns front first, then the other placements in JSON order", () => {
    expect(placementImageIds({ back: "b", front: "f", sleeve: "s" })).toEqual([
      "f",
      "b",
      "s",
    ]);
  });

  it("collapses the same image used twice", () => {
    expect(placementImageIds({ front: "f", back: "f" })).toEqual(["f"]);
  });

  it("is empty for a null or absent placements JSON", () => {
    expect(placementImageIds(null)).toEqual([]);
    expect(placementImageIds({})).toEqual([]);
  });
});

describe("resolveContributors", () => {
  const owners = new Map([
    ["img-front", { userId: "ada", name: "Ada" }],
    ["img-back", { userId: "bo", name: "Bo" }],
  ]);

  it("lists distinct owners front-first", () => {
    expect(
      resolveContributors({
        placements: { back: "img-back", front: "img-front" },
        ownerByImageId: owners,
      })
    ).toEqual([
      { userId: "ada", name: "Ada" },
      { userId: "bo", name: "Bo" },
    ]);
  });

  it("collapses one owner who supplied both sides", () => {
    expect(
      resolveContributors({
        placements: { front: "img-front", back: "img-front" },
        ownerByImageId: owners,
      })
    ).toEqual([{ userId: "ada", name: "Ada" }]);
  });

  it("falls back to the conversation owner when no placement resolves", () => {
    expect(
      resolveContributors({
        placements: null,
        ownerByImageId: owners,
        fallback: { userId: "legacy", name: "Legacy" },
      })
    ).toEqual([{ userId: "legacy", name: "Legacy" }]);
  });

  it("returns nothing when nothing resolves and there is no fallback", () => {
    expect(
      resolveContributors({
        placements: { front: "ghost" },
        ownerByImageId: owners,
      })
    ).toEqual([]);
  });
});

describe("contributorAttribution", () => {
  it("names one contributor", () => {
    expect(
      contributorAttribution({
        contributors: [{ userId: "ada", name: "Ada" }],
        viewerId: "buyer",
      })
    ).toBe("Ada");
  });

  it("joins two contributors front-first with an ampersand", () => {
    expect(
      contributorAttribution({
        contributors: [
          { userId: "ada", name: "Ada" },
          { userId: "bo", name: "Bo" },
        ],
        viewerId: "buyer",
      })
    ).toBe("Ada & Bo");
  });

  it("names the other contributor alone when the viewer is one of two", () => {
    expect(
      contributorAttribution({
        contributors: [
          { userId: "ada", name: "Ada" },
          { userId: "bo", name: "Bo" },
        ],
        viewerId: "ada",
      })
    ).toBe("Bo");
  });

  it("returns null when the viewer is the only contributor", () => {
    expect(
      contributorAttribution({
        contributors: [{ userId: "ada", name: "Ada" }],
        viewerId: "ada",
      })
    ).toBeNull();
  });

  it("returns null when the viewer contributed both placements", () => {
    expect(
      contributorAttribution({
        contributors: [{ userId: "ada", name: "Ada" }],
        viewerId: "ada",
      })
    ).toBeNull();
  });

  it("returns null with no contributors at all", () => {
    expect(contributorAttribution({ contributors: [], viewerId: "buyer" })).toBeNull();
  });

  it("skips a contributor with no name and keeps the rest", () => {
    expect(
      contributorAttribution({
        contributors: [
          { userId: "ada", name: null },
          { userId: "bo", name: "Bo" },
        ],
        viewerId: "buyer",
      })
    ).toBe("Bo");
  });

  it("returns null when no contributor has a name", () => {
    expect(
      contributorAttribution({
        contributors: [{ userId: "ada", name: null }],
        viewerId: "buyer",
      })
    ).toBeNull();
  });
});
