/**
 * The image detail page for the owner's UNPUBLISHED image (one buy surface,
 * slice 3): the owner gets the same Order panel a Shop buyer uses instead of a
 * link out to /preview, applied from the link's picks too. An image with no
 * live conversation gets no Order. An anonymous owner sees "Sign in to buy".
 *
 * The page is an async server component, called directly here with its data
 * sources mocked; BuyHero and BuyPanel are real, so what is asserted is what
 * the viewer would see. Prices are matched by pattern only.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ACTIVE_BLANKS, DEFAULT_BLANK_ID, getBlankOrThrow } from "@/lib/blanks";

const h = vi.hoisted(() => ({
  session: null as unknown,
  image: null as unknown,
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
vi.mock("../owner-actions", () => ({
  OwnerActions: ({ isPublished }: { isPublished: boolean }) => (
    <div data-testid="owner-actions">{isPublished ? "published" : "private"}</div>
  ),
}));
vi.mock("../conversation-images", () => ({ ConversationImages: () => null }));

import PublishedImagePage from "../page";
import { buyPublishedDesign, getImagePage } from "../../actions";
import { cartEnabled } from "@/lib/flags";

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

beforeEach(() => {
  h.session = OWNER;
  h.image = imagePage();
  vi.mocked(buyPublishedDesign).mockClear();
  vi.mocked(getImagePage).mockClear();
  vi.stubEnv("MULTI_PLACEMENT_ENABLED", "true");
});

describe("the image detail page for the owner's unpublished image", () => {
  it("shows the Order panel, not a link to /preview", async () => {
    await renderPage();
    expect(screen.getByTestId("order-expand")).toBeInTheDocument();
    expect(
      document.querySelector('a[href^="/preview"]')
    ).not.toBeInTheDocument();
    // The owner's row and the remix action stay.
    expect(screen.getByTestId("owner-actions")).toHaveTextContent("private");
    expect(
      screen.getByRole("button", { name: "New design from this image" })
    ).toBeInTheDocument();
  });

  it("offers no backdrop picker (no publication to pin it on)", async () => {
    await renderPage();
    expect(screen.queryByText(/backdrop/i)).not.toBeInTheDocument();
  });

  it("Order, then a size, enables the Order button", async () => {
    await renderPage();
    fireEvent.click(screen.getByTestId("order-expand"));
    const blank = getBlankOrThrow(DEFAULT_BLANK_ID);
    const orderButtons = () =>
      screen.getAllByRole("button", { name: /^Order( — \$.+)?$/ });
    expect(orderButtons()[0]).toBeDisabled();
    fireEvent.click(screen.getAllByRole("button", { name: blank.sizes[0] })[0]);
    expect(orderButtons()[0]).toBeEnabled();
    expect(orderButtons()[0]).toHaveTextContent(/Order — \$\d/);
  });

  it("applies the link's picks: expanded, with the size chosen", async () => {
    const blank = ACTIVE_BLANKS.find((b) => b.id === DEFAULT_BLANK_ID)!;
    const size = blank.sizes[0];
    await renderPage({ order: "1", product: blank.id, size });
    // Already expanded: no expand button, and the size is picked, so the
    // Order button is enabled without a tap.
    expect(screen.queryByTestId("order-expand")).not.toBeInTheDocument();
    expect(screen.getByText("Size")).toBeInTheDocument();
    expect(screen.queryByText("Choose a size")).not.toBeInTheDocument();
    const orderButtons = screen.getAllByRole("button", {
      name: /^Order( — \$.+)?$/,
    });
    expect(orderButtons[0]).toBeEnabled();
    expect(orderButtons[0]).toHaveTextContent(/Order — \$\d/);
  });

  it("an anonymous owner sees Sign in to buy and no Order action", async () => {
    h.session = { user: { id: "owner", isAnonymous: true } };
    await renderPage({ order: "1" });
    const signIn = screen.getAllByRole("link", { name: /Sign in to buy/ })[0];
    expect(signIn.getAttribute("href")).toMatch(/^\/sign-in\?next=/);
    // The return path is this image's page with the panel open.
    expect(decodeURIComponent(signIn.getAttribute("href")!)).toContain(
      "/d/img-1?order=1"
    );
    expect(
      screen.queryByRole("button", { name: /^Order( — \$.+)?$/ })
    ).not.toBeInTheDocument();
    expect(buyPublishedDesign).not.toHaveBeenCalled();
  });

  it("an image with no live conversation gets no Order", async () => {
    h.image = imagePage({ canOrder: false, hasSourceConversation: false });
    await renderPage({ order: "1" });
    expect(screen.queryByTestId("order-expand")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Order/ })
    ).not.toBeInTheDocument();
    expect(
      document.querySelector('a[href^="/preview"]')
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "New design from this image" })
    ).toBeInTheDocument();
  });

  it("a non-owner never reaches the page: the 404 is the data layer's", async () => {
    vi.mocked(getImagePage).mockResolvedValueOnce(null);
    await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("the page for a published image is unchanged", () => {
  it("still shows the panel, with the owner row marked published", async () => {
    h.image = imagePage({ publishedAt: new Date() });
    await renderPage();
    expect(screen.getByTestId("order-expand")).toBeInTheDocument();
    expect(screen.getByTestId("owner-actions")).toHaveTextContent("published");
  });

  it("add to cart follows the flag for the owner of a private image too", async () => {
    vi.stubEnv("CART_ENABLED", "true");
    await renderPage({ order: "1" });
    expect(cartEnabled()).toBe(true);
    expect(screen.getAllByTestId("add-to-cart").length).toBeGreaterThan(0);
  });
});
