/**
 * The parent crumb of an unpublished upload's image detail page. My Designs
 * leaves uploads out (#355), so with no recognised `from` the parent is the
 * Studio: the stage of the upload's conversation, else the bench. The
 * mobile back arrow (BuyHero's `backHref`) comes from the same trail.
 * Harness as upload-owner-row.test.tsx; the leaves are stubbed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  session: null as unknown,
  image: null as unknown,
  stageHref: "/studio?conversation=design-1&image=img-1",
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => h.session } },
  isAnonymousUser: (u: { isAnonymous?: boolean } | undefined) =>
    Boolean(u?.isAnonymous),
}));
vi.mock("@/lib/image-share", () => ({ getImageShareCard: vi.fn() }));
vi.mock("@/app/preview/actions", () => ({
  getLastPurchaseDefaults: vi.fn(async () => null),
}));
vi.mock("../../actions", () => ({
  getImagePage: vi.fn(async () => h.image),
  getConversationImages: vi.fn(async () => ({
    images: [],
    primaryImageId: null,
  })),
  resolveInitialBack: vi.fn(async () => null),
  getListingMockup: vi.fn(async () => ({ mockupUrl: "https://r2.example/m.jpg" })),
  getListingBackMockup: vi.fn(async () => ({
    mockupUrl: "https://r2.example/b.jpg",
  })),
  buyPublishedDesign: vi.fn().mockResolvedValue({ url: null, needsAuth: false }),
  getBuyPageBackSources: vi.fn().mockResolvedValue({ groups: [] }),
}));
vi.mock("@/lib/ensure-guest-session", () => ({
  ensureGuestSession: vi.fn(async () => {}),
}));
vi.mock("@/app/cart/actions", () => ({
  addToCart: vi.fn(async () => ({ ok: true, count: 1 })),
  updateCartItem: vi.fn(async () => ({ ok: true })),
  getEditableCartLine: vi.fn(async () => null),
}));
vi.mock("@/app/designs/actions", () => ({
  updatePublishedNaming: vi.fn(async () => {}),
  unpublishImage: vi.fn(async () => {}),
  publishImage: vi.fn(async () => ({})),
}));
vi.mock("../start-from-image", () => ({
  StartFromImage: () => <button>New design from this image</button>,
}));
vi.mock("../conversation-images", () => ({ ConversationImages: () => null }));
vi.mock("../conversation-actions", () => ({ ConversationActions: () => null }));
vi.mock("@/components/publish-modal", () => ({ PublishModal: () => null }));
vi.mock("@/lib/shop-listed-conversations", () => ({
  shopListingsRemovedByDelete: vi.fn(async () => new Set<string>()),
}));
const conversationStudioHref = vi.hoisted(() => vi.fn());
vi.mock("@/lib/studio-entry", () => ({ conversationStudioHref }));

import PublishedImagePage from "../page";

const OWNER = { user: { id: "owner", isAnonymous: false } };

function imagePage(overrides: Record<string, unknown> = {}) {
  return {
    imageId: "img-1",
    imageUrl: "https://img.example/private.png",
    title: null,
    description: null,
    backgroundColor: null,
    designerName: "owner",
    designerId: "owner",
    isOwn: true,
    publishedAt: null,
    sourceDesignId: "design-1",
    hasSourceConversation: true,
    sourceConversationArchived: false,
    canOrder: true,
    forkChain: [],
    operation: "upload",
    ...overrides,
  };
}

async function renderPage(search: Record<string, string> = {}) {
  const ui = await PublishedImagePage({
    params: Promise.resolve({ imageId: "img-1" }),
    searchParams: Promise.resolve(search),
  });
  return render(ui);
}

/** The desktop trail's parent link: the last link inside the breadcrumb nav. */
function parentLink() {
  const links = screen
    .getByRole("navigation", { name: "Breadcrumb" })
    .querySelectorAll("ol a");
  const last = links[links.length - 1];
  return { label: last.textContent, href: last.getAttribute("href") };
}

beforeEach(() => {
  h.session = OWNER;
  h.image = imagePage();
  conversationStudioHref.mockReset();
  conversationStudioHref.mockImplementation(async () => h.stageHref);
  vi.stubEnv("MULTI_PLACEMENT_ENABLED", "true");
});

describe("the parent crumb of an unpublished upload", () => {
  it("is the Studio stage of its conversation when the link has no from", async () => {
    await renderPage();
    expect(parentLink()).toEqual({ label: "Studio", href: h.stageHref });
    expect(conversationStudioHref).toHaveBeenCalledWith("owner", "design-1");
  });

  it("gives the mobile back arrow the same target", async () => {
    await renderPage();
    expect(screen.getByRole("link", { name: "Back to Studio" })).toHaveAttribute(
      "href",
      h.stageHref
    );
  });

  it("is My Designs when the link names /designs", async () => {
    await renderPage({ from: "/designs" });
    expect(parentLink()).toEqual({ label: "My Designs", href: "/designs" });
    expect(conversationStudioHref).not.toHaveBeenCalled();
  });

  it("treats an unrecognised from as absent", async () => {
    await renderPage({ from: "//evil.example" });
    expect(parentLink()).toEqual({ label: "Studio", href: h.stageHref });
  });

  it("is the bench when the image has no source conversation", async () => {
    h.image = imagePage({ sourceDesignId: null, hasSourceConversation: false });
    await renderPage();
    expect(parentLink()).toEqual({ label: "Studio", href: "/studio" });
    expect(conversationStudioHref).not.toHaveBeenCalled();
  });

  it("is the bench when the stage lookup throws", async () => {
    conversationStudioHref.mockRejectedValue(new Error("db down"));
    await renderPage();
    expect(parentLink()).toEqual({ label: "Studio", href: "/studio" });
  });
});

describe("pages that are not an unpublished upload keep their parent", () => {
  it("a private generated image without from is under My Designs", async () => {
    h.image = imagePage({ operation: "generate" });
    await renderPage();
    expect(parentLink()).toEqual({ label: "My Designs", href: "/designs" });
    expect(conversationStudioHref).not.toHaveBeenCalled();
  });

  it("a private image with no recorded operation is under My Designs", async () => {
    h.image = imagePage({ operation: null });
    await renderPage();
    expect(parentLink()).toEqual({ label: "My Designs", href: "/designs" });
  });
});
