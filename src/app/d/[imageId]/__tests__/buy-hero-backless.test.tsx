/**
 * #167 review fix (2b): `backOffered` must also check the blank actually has
 * a back placement, mirroring /preview's `showBack`. Isolated in its own
 * file because it needs a fabricated backless blank as the ONLY active
 * product — mocking `@/lib/blanks` file-wide would break every other
 * `buy-hero.test.tsx` case that expects a back-capable default blank.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BuyHero } from "../buy-hero";

vi.mock("@/lib/blanks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/blanks")>();
  const base = actual.getBlank(actual.DEFAULT_BLANK_ID)!;
  const backless = {
    ...base,
    id: "backless-test-blank",
    placements: base.placements.filter((p) => p.id !== "back"),
  };
  const getBlank = (id: string) =>
    id === backless.id ? backless : actual.getBlank(id);
  return {
    ...actual,
    DEFAULT_BLANK_ID: backless.id,
    ACTIVE_BLANKS: [backless],
    getBlank,
    // pricing.ts's computePrice calls this directly; the real implementation
    // closes over the real (unmocked) getBlank, so it doesn't see the
    // fabricated blank without its own override.
    getBlankOrThrow: (id: string) => {
      const product = getBlank(id);
      if (!product) throw new Error(`Unknown product: ${id}`);
      return product;
    },
  };
});

vi.mock("../../actions", () => ({
  getListingMockup: vi.fn().mockResolvedValue({ mockupUrl: "https://r2/front.jpg" }),
  getListingBackMockup: vi.fn(),
  getBuyPageBackSources: vi.fn().mockResolvedValue({
    groups: [
      {
        id: "my-designs",
        label: "My designs",
        images: [{ id: "back-1", imageUrl: "https://img.example/back-1.png" }],
      },
    ],
  }),
  buyPublishedDesign: vi.fn().mockResolvedValue({ url: null, needsAuth: false }),
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
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function renderHero() {
  return render(
    <BuyHero
      imageId="img-1"
      imageUrl="https://img.example/front.png"
      alt="Fox"
      initialBackgroundColor="Black"
      canEdit={false}
      isLoggedIn
      backEnabled
    />
  );
}

describe("BuyHero backOffered (#167 review fix 2b)", () => {
  it("a blank with no back placement offers no back, even with backEnabled", async () => {
    renderHero();
    fireEvent.click(screen.getByTestId("order-expand"));

    await screen.findByTestId("side-hero");
    expect(screen.queryByTestId("add-back-tile")).not.toBeInTheDocument();
    expect(screen.queryByTestId("side-tile")).not.toBeInTheDocument();
  });
});
