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
    // The picker's label is "Background — <colour>" (BackgroundPicker).
    expect(screen.queryByText(/^Background/)).not.toBeInTheDocument();
    // And no title editor: there is no listing to name.
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("add to cart follows the flag for the owner of a private image too", async () => {
    vi.stubEnv("CART_ENABLED", "true");
    await renderPage({ order: "1" });
    expect(cartEnabled()).toBe(true);
    expect(screen.getAllByTestId("add-to-cart").length).toBeGreaterThan(0);
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

describe("the page for a published image", () => {
  const PUBLISHED = {
    publishedAt: new Date(),
    title: "Fox",
    backgroundColor: "Black",
    canOrder: true,
  };

  it("shows its owner the panel, the backdrop picker on the pinned colour, the title editor and a published owner row", async () => {
    h.image = imagePage(PUBLISHED);
    await renderPage();
    expect(screen.getByTestId("order-expand")).toBeInTheDocument();
    expect(screen.getByText("Background — Black")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByTestId("owner-actions")).toHaveTextContent("published");
  });

  it("shows a stranger the panel but no backdrop picker, no title editor and no owner row", async () => {
    h.session = { user: { id: "stranger", isAnonymous: false } };
    h.image = imagePage({ ...PUBLISHED, isOwn: false, designerId: "someone-else" });
    await renderPage();
    expect(screen.getByTestId("order-expand")).toBeInTheDocument();
    expect(screen.queryByText(/^Background/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("owner-actions")).not.toBeInTheDocument();
  });
});

describe("publishing from the page keeps the open panel and shows the published values (fixes D and 2)", () => {
  const PUBLISHED = { publishedAt: new Date(), title: "Fox", backgroundColor: "Black" };

  async function pageNode() {
    return PublishedImagePage({
      params: Promise.resolve({ imageId: "img-1" }),
      searchParams: Promise.resolve({}),
    });
  }

  it("with no colour picked, the default follows the pinned backdrop, and the picker and the title editor show the published values", async () => {
    h.image = imagePage();
    const { rerender } = render(await pageNode());
    expect(screen.queryByText(/^Background/)).not.toBeInTheDocument();

    h.image = imagePage(PUBLISHED);
    rerender(await pageNode());

    expect(screen.getByText("Background — Black")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByDisplayValue("Fox")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("order-expand"));
    expect(screen.getByText("Color — Black")).toBeInTheDocument();
  });

  it("an open panel stays open with its size and the buyer's own colour, and the title editor shows the title", async () => {
    h.image = imagePage();
    const { rerender } = render(await pageNode());
    fireEvent.click(screen.getByTestId("order-expand"));
    const blank = getBlankOrThrow(DEFAULT_BLANK_ID);
    const size = blank.sizes[1];
    fireEvent.click(screen.getAllByRole("button", { name: size })[0]);
    // The buyer picks a colour that is neither the default nor the new backdrop.
    const picked = blank.colors.find((c) => c.name !== "White" && c.name !== "Black")!;
    fireEvent.click(screen.getByTitle(picked.name));
    expect(screen.getByText(`Color — ${picked.name}`)).toBeInTheDocument();

    h.image = imagePage(PUBLISHED);
    rerender(await pageNode());

    // Still open, same size, same colour: the buyer's pick is not overridden.
    expect(screen.queryByTestId("order-expand")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: size })[0]).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByText(`Color — ${picked.name}`)).toBeInTheDocument();
    // The title editor shows the published title. (The backdrop picker lives
    // on the collapsed hero, so it is covered by the collapsed test above.)
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByDisplayValue("Fox")).toBeInTheDocument();
  });

  it("an open panel whose colour was left at the default follows the new backdrop", async () => {
    h.image = imagePage();
    const { rerender } = render(await pageNode());
    fireEvent.click(screen.getByTestId("order-expand"));
    expect(screen.getByText("Color — White")).toBeInTheDocument();

    h.image = imagePage(PUBLISHED);
    rerender(await pageNode());
    expect(screen.queryByTestId("order-expand")).not.toBeInTheDocument();
    expect(screen.getByText("Color — Black")).toBeInTheDocument();
  });
});

describe("the back arrow's fallback origin (fix G)", () => {
  const arrow = () => screen.getByRole("link", { name: /^Back to / });

  it("a private image with no `from` goes back to My Designs", async () => {
    await renderPage();
    expect(arrow()).toHaveAccessibleName("Back to My Designs");
    expect(arrow()).toHaveAttribute("href", "/designs");
  });

  it("a published image with no `from` still goes back to the Shop", async () => {
    h.image = imagePage({ publishedAt: new Date(), title: "Fox", backgroundColor: "Black" });
    await renderPage();
    expect(arrow()).toHaveAccessibleName("Back to Shop");
    expect(arrow()).toHaveAttribute("href", "/shop");
  });

  it("an explicit `from` on a private image is kept", async () => {
    await renderPage({ from: "/orders" });
    expect(arrow()).toHaveAccessibleName("Back to Orders");
  });
});
