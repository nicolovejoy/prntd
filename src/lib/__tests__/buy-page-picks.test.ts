import { describe, it, expect } from "vitest";
import { ACTIVE_BLANKS, DEFAULT_BLANK_ID, getBlankOrThrow } from "@/lib/blanks";
import {
  parseBuyPagePicks,
  buyPageHref,
  withBuyPagePicks,
} from "@/lib/buy-page-picks";

const blank = getBlankOrThrow(DEFAULT_BLANK_ID);
const other = ACTIVE_BLANKS.find((b) => b.id !== DEFAULT_BLANK_ID)!;

describe("parseBuyPagePicks", () => {
  it("returns all-empty for no params", () => {
    expect(parseBuyPagePicks({})).toEqual({
      order: false, product: null, size: null, color: null,
      back: null, swap: false, line: null,
    });
  });

  it("reads a full, valid link", () => {
    const picks = parseBuyPagePicks({
      order: "1", product: other.id, size: other.sizes[0],
      color: other.colors[0].name, back: "img-b", swap: "1", line: "line-1",
    });
    expect(picks).toEqual({
      order: true, product: other.id, size: other.sizes[0],
      color: other.colors[0].name, back: "img-b", swap: true, line: "line-1",
    });
  });

  it("drops an unknown product and validates size and colour against the default blank", () => {
    const picks = parseBuyPagePicks({
      product: "discontinued-tee", size: blank.sizes[0], color: blank.colors[0].name,
    });
    expect(picks.product).toBeNull();
    expect(picks.size).toBe(blank.sizes[0]);
    expect(picks.color).toBe(blank.colors[0].name);
  });

  it("drops a size the product does not offer, keeps the rest", () => {
    const picks = parseBuyPagePicks({ product: blank.id, size: "9XL", color: blank.colors[0].name });
    expect(picks).toMatchObject({ product: blank.id, size: null, color: blank.colors[0].name });
  });

  it("drops a colour outside the palette", () => {
    expect(parseBuyPagePicks({ product: blank.id, color: "Plaid" }).color).toBeNull();
  });

  it("ignores swap without a back", () => {
    expect(parseBuyPagePicks({ swap: "1" }).swap).toBe(false);
  });

  it("takes the first value of a repeated param and ignores empty strings", () => {
    const picks = parseBuyPagePicks({ size: [blank.sizes[0], "9XL"], back: "" });
    expect(picks.size).toBe(blank.sizes[0]);
    expect(picks.back).toBeNull();
  });

  it("rejects ids with characters an id never has", () => {
    expect(parseBuyPagePicks({ back: "a b/../c" }).back).toBeNull();
    expect(parseBuyPagePicks({ line: "x".repeat(200) }).line).toBeNull();
  });
});

describe("buyPageHref", () => {
  it("is the bare page with no picks", () => {
    expect(buyPageHref("img-1", {})).toBe("/d/img-1");
  });

  it("writes picks in a fixed order and encodes them", () => {
    expect(
      buyPageHref("img-1", {
        order: true, product: blank.id, size: "M", color: "Heather Grey",
        back: "img-b", swap: true, from: "/designs",
      })
    ).toBe(
      `/d/img-1?order=1&product=${blank.id}&size=M&color=Heather+Grey&back=img-b&swap=1&from=%2Fdesigns`
    );
  });

  it("round-trips through parseBuyPagePicks", () => {
    const picks = { order: true, product: blank.id, size: blank.sizes[1], color: blank.colors[1].name, back: "img-b", swap: true, line: null };
    const href = buyPageHref("img-1", picks);
    const parsed = parseBuyPagePicks(
      Object.fromEntries(new URL(href, "http://x.invalid").searchParams)
    );
    expect(parsed).toEqual(picks);
  });
});

describe("withBuyPagePicks", () => {
  it("replaces pick params and keeps the others", () => {
    expect(
      withBuyPagePicks("?from=%2Fshop&size=S&back=old", { order: true, size: "L", back: null })
    ).toBe("?from=%2Fshop&order=1&size=L");
  });

  it("returns an empty string when nothing is left", () => {
    expect(withBuyPagePicks("?size=S", { size: null })).toBe("");
  });
});
