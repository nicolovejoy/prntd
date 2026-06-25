import { describe, it, expect } from "vitest";
import {
  slugify,
  uniqueSlug,
  storeShareUrl,
  canManageStore,
  storeIsPublic,
  canViewStore,
  productIsListed,
  canBuyStoreProduct,
} from "@/lib/stores";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Manine's Baseball Club")).toBe("manines-baseball-club");
  });
  it("strips emoji and punctuation", () => {
    expect(slugify("July 4th Special! 🎆")).toBe("july-4th-special");
  });
  it("collapses whitespace and underscores", () => {
    expect(slugify("  the   band_shop ")).toBe("the-band-shop");
  });
  it("falls back to 'shop' for empty/emoji-only names", () => {
    expect(slugify("🎉🎉")).toBe("shop");
    expect(slugify("   ")).toBe("shop");
  });
  it("caps length and never leaves a trailing hyphen", () => {
    const s = slugify("a".repeat(80) + " club");
    expect(s.length).toBeLessThanOrEqual(60);
    expect(s.endsWith("-")).toBe(false);
  });
});

describe("uniqueSlug", () => {
  it("returns the base slug when free", () => {
    expect(uniqueSlug("Team Shop", () => false)).toBe("team-shop");
  });
  it("suffixes -2, -3 on collision", () => {
    const taken = new Set(["team-shop", "team-shop-2"]);
    expect(uniqueSlug("Team Shop", (s) => taken.has(s))).toBe("team-shop-3");
  });
});

describe("storeShareUrl", () => {
  it("builds from the request origin, not a hardcoded host", () => {
    expect(storeShareUrl("manines-club", "https://prntd-abc.vercel.app")).toBe(
      "https://prntd-abc.vercel.app/shop/manines-club"
    );
    expect(storeShareUrl("manines-club", "https://prntd.org")).toBe(
      "https://prntd.org/shop/manines-club"
    );
  });
});

describe("access guards", () => {
  const live = { status: "live" as const, ownerId: "u1" };
  const draft = { status: "draft" as const, ownerId: "u1" };

  it("canManageStore: owner only", () => {
    expect(canManageStore({ id: "u1" }, { ownerId: "u1" })).toBe(true);
    expect(canManageStore({ id: "u2" }, { ownerId: "u1" })).toBe(false);
    expect(canManageStore(null, { ownerId: "u1" })).toBe(false);
  });

  it("storeIsPublic: live only", () => {
    expect(storeIsPublic(live)).toBe(true);
    expect(storeIsPublic(draft)).toBe(false);
  });

  it("canViewStore: public when live, owner sees drafts", () => {
    expect(canViewStore(live, null)).toBe(true); // anyone
    expect(canViewStore(draft, null)).toBe(false); // stranger can't see a draft
    expect(canViewStore(draft, { id: "u1" })).toBe(true); // owner can
    expect(canViewStore(draft, { id: "u2" })).toBe(false);
  });
});

describe("storefront buy guards", () => {
  const liveStore = { id: "s1", status: "live" as const };
  const draftStore = { id: "s1", status: "draft" as const };
  const listed = { status: "listed" as const, storeId: "s1" };
  const draftProduct = { status: "draft" as const, storeId: "s1" };

  it("productIsListed: listed only", () => {
    expect(productIsListed(listed)).toBe(true);
    expect(productIsListed(draftProduct)).toBe(false);
    expect(productIsListed({ status: "hidden" as const })).toBe(false);
  });

  it("canBuyStoreProduct: listed product in a live store, belonging to it", () => {
    expect(canBuyStoreProduct(listed, liveStore)).toBe(true);
  });
  it("canBuyStoreProduct: rejects a draft product", () => {
    expect(canBuyStoreProduct(draftProduct, liveStore)).toBe(false);
  });
  it("canBuyStoreProduct: rejects a listed product in a non-live store", () => {
    expect(canBuyStoreProduct(listed, draftStore)).toBe(false);
  });
  it("canBuyStoreProduct: rejects a product that isn't in this store", () => {
    expect(canBuyStoreProduct({ status: "listed" as const, storeId: "other" }, liveStore)).toBe(false);
    expect(canBuyStoreProduct({ status: "listed" as const, storeId: null }, liveStore)).toBe(false);
  });
});
