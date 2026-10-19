/**
 * The owner row on the image detail page for an uploaded photo (#355): the
 * photo can be ordered but not published, so the row states "Not published"
 * and offers neither Publish nor the guest sign-up prompt. OwnerActions and
 * PublishCta are real here, so the page's own wiring is what is asserted
 * (owner-order-page.test.tsx stubs the owner row). The leaves that only call
 * server actions are stubbed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  session: null as unknown,
  image: null as unknown,
  line: null as { id: string; quantity: number } | null,
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
  getEditableCartLine: vi.fn(async () => h.line),
}));
vi.mock("@/app/designs/actions", () => ({
  updatePublishedNaming: vi.fn(async () => {}),
  unpublishImage: vi.fn(async () => {}),
  publishImage: vi.fn(async () => ({})),
}));
// Leaves that only call server actions this test does not exercise.
vi.mock("../start-from-image", () => ({
  StartFromImage: () => <button>New design from this image</button>,
}));
vi.mock("../conversation-images", () => ({ ConversationImages: () => null }));
vi.mock("../conversation-actions", () => ({ ConversationActions: () => null }));
vi.mock("@/components/publish-modal", () => ({ PublishModal: () => null }));
vi.mock("@/lib/shop-listed-conversations", () => ({
  shopListingsRemovedByDelete: vi.fn(async () => new Set<string>()),
}));

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
    operation: null,
    ...overrides,
  };
}

async function renderPage() {
  const ui = await PublishedImagePage({
    params: Promise.resolve({ imageId: "img-1" }),
    searchParams: Promise.resolve({}),
  });
  return render(ui);
}

beforeEach(() => {
  h.session = OWNER;
  h.image = imagePage();
  h.line = null;
  vi.stubEnv("MULTI_PLACEMENT_ENABLED", "true");
});

describe("the owner row for an uploaded photo (#355)", () => {
  it("offers Order and states Not published, with no Publish and no sign-up prompt (#355)", async () => {
    h.image = imagePage({ operation: "upload" });
    await renderPage();
    expect(screen.getByText("Not published")).toBeInTheDocument();
    expect(screen.getByTestId("order-expand")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("guest-publish-prompt")).not.toBeInTheDocument();
  });

  it("a generated image still offers Publish (#355)", async () => {
    h.image = imagePage({ operation: "generate" });
    await renderPage();
    expect(screen.getByRole("button", { name: "Publish" })).toBeInTheDocument();
  });

  it("an image with no recorded operation still offers Publish (#355)", async () => {
    await renderPage();
    expect(screen.getByRole("button", { name: "Publish" })).toBeInTheDocument();
  });

  it("an anonymous owner of a generated image still sees the sign-up prompt (#355)", async () => {
    h.session = { user: { id: "owner", isAnonymous: true } };
    h.image = imagePage({ operation: "generate" });
    await renderPage();
    expect(screen.getByTestId("guest-publish-prompt")).toBeInTheDocument();
  });
});
