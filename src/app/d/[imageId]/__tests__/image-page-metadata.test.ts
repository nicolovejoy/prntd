/**
 * generateMetadata's title fallback. `card.title ?? "..."` does not catch an
 * empty string, and prod may already hold blank titles saved before the
 * server-side guard landed — an empty og:title is a nameless share card.
 *
 * page.tsx pulls in a wide tree of "use server" action modules through its
 * child components (BuyHero, OwnerActions, ConversationImages, …), several
 * of which transitively import better-auth. Importing the page module for
 * this test requires stubbing every one of page.tsx's own direct imports so
 * none of that heavier subtree ever loads — generateMetadata itself only
 * touches getImageShareCard.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const getImageShareCard = vi.fn();
vi.mock("@/lib/image-share", () => ({
  getImageShareCard: (...args: unknown[]) => getImageShareCard(...(args as [])),
}));

vi.mock("../../actions", () => ({
  getImagePage: vi.fn(),
  getConversationImages: vi.fn(),
}));
vi.mock("@/app/preview/actions", () => ({
  getLastPurchaseDefaults: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn() } },
  isAnonymousUser: vi.fn(),
}));
vi.mock("@/lib/blanks", () => ({
  multiPlacementEnabled: vi.fn(),
}));
vi.mock("@/lib/flags", () => ({
  cartEnabled: vi.fn(),
}));
vi.mock("../identity-block", () => ({ IdentityBlock: () => null }));
vi.mock("../published-image-view", () => ({ PublishedImageView: () => null }));
vi.mock("../buy-hero", () => ({ BuyHero: () => null }));
vi.mock("../start-from-image", () => ({ StartFromImage: () => null }));
vi.mock("../conversation-images", () => ({ ConversationImages: () => null }));
vi.mock("../owner-actions", () => ({ OwnerActions: () => null }));

const { generateMetadata } = await import("../page");

beforeEach(() => {
  getImageShareCard.mockReset();
});

describe("image detail page metadata", () => {
  it("falls back for an empty-string title, not a nameless card", async () => {
    getImageShareCard.mockResolvedValue({
      title: "",
      designerName: "Nico",
      imageUrl: "https://img.example/x.png",
      backgroundColor: null,
    });
    const meta = await generateMetadata({
      params: Promise.resolve({ imageId: "img-1" }),
    });
    expect(meta.title).toBe("A design on PRNTD");
    expect(meta.openGraph?.title).toBe("A design on PRNTD");
  });

  it("uses a real title", async () => {
    getImageShareCard.mockResolvedValue({
      title: "Dapper Whale",
      designerName: "Nico",
      imageUrl: "https://img.example/x.png",
      backgroundColor: null,
    });
    const meta = await generateMetadata({
      params: Promise.resolve({ imageId: "img-1" }),
    });
    expect(meta.title).toBe("Dapper Whale");
  });
});
