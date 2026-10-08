/**
 * The image detail page for an admin-hidden image (#288): the owner gets a
 * plain notice in place of the artwork and the buy surface; anyone else keeps
 * the not-found page (getImagePage returns null for them, tested in
 * src/app/designs/__tests__/admin-hidden-owner.integration.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({ result: null as unknown }));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => ({ user: { id: "owner" } }) } },
  isAnonymousUser: () => false,
}));
vi.mock("@/lib/image-share", () => ({ getImageShareCard: vi.fn() }));
vi.mock("@/app/preview/actions", () => ({
  getLastPurchaseDefaults: vi.fn(async () => null),
}));
vi.mock("../../actions", () => ({
  getImagePage: vi.fn(async () => h.result),
  getConversationImages: vi.fn(),
  resolveInitialBack: vi.fn(),
}));
vi.mock("@/app/cart/actions", () => ({
  addToCart: vi.fn(),
  updateCartItem: vi.fn(),
  getEditableCartLine: vi.fn(),
}));
vi.mock("@/lib/ensure-guest-session", () => ({ ensureGuestSession: vi.fn() }));
vi.mock("@/app/designs/actions", () => ({
  updatePublishedNaming: vi.fn(),
  unpublishImage: vi.fn(),
  publishImage: vi.fn(),
}));
vi.mock("../start-from-image", () => ({ StartFromImage: () => null }));
vi.mock("../owner-actions", () => ({ OwnerActions: () => null }));
vi.mock("../conversation-images", () => ({ ConversationImages: () => null }));

import PublishedImagePage from "../page";

async function renderPage(search: Record<string, string> = {}) {
  return render(
    await PublishedImagePage({
      params: Promise.resolve({ imageId: "img-1" }),
      searchParams: Promise.resolve(search),
    })
  );
}

beforeEach(() => {
  h.result = { hiddenForOwner: true, imageId: "img-1", title: "Rocket Cat" };
});

describe("the hidden notice", () => {
  it("shows the heading, the body and the contact line with a mailto link", async () => {
    await renderPage();
    expect(screen.getByRole("heading", { name: "Hidden" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "An admin has hidden this image. It is not shown in the Shop or on your pages, and it can't be ordered or published."
      )
    ).toBeInTheDocument();
    expect(screen.getByText(/^Questions:/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "help@prntd.org" })).toHaveAttribute(
      "href",
      "mailto:help@prntd.org"
    );
  });

  it("renders no artwork, no buy panel and no publish or remix controls", async () => {
    await renderPage({ order: "1" });
    expect(document.querySelector("img")).toBeNull();
    expect(screen.queryByTestId("order-expand")).toBeNull();
    expect(screen.queryByTestId("add-to-cart")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link", { name: /publish|new design/i })).toBeNull();
    expect(screen.queryByText(/new design from this image/i)).toBeNull();
    expect(document.querySelector('a[href^="/preview"]')).toBeNull();
  });

  it("links back to My Designs", async () => {
    await renderPage();
    const back = screen.getAllByRole("link", { name: /My Designs/ })[0];
    expect(back).toHaveAttribute("href", "/designs");
  });

  it("keeps the not-found page when there is no result", async () => {
    h.result = null;
    await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
