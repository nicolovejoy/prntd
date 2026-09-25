import { describe, it, expect, vi } from "vitest";
import { createRef } from "react";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { getBlankOrThrow } from "@/lib/blanks";
import { BuyPanel, type BuyPanelHandle } from "../buy-panel";

vi.mock("../../actions", () => ({
  buyPublishedDesign: vi.fn().mockResolvedValue({ url: null, needsAuth: false }),
  getBuyPageBackSources: vi.fn().mockResolvedValue({
    groups: [
      {
        id: "my-designs",
        label: "My designs",
        images: [{ id: "back-1", imageUrl: "https://img.example/back-1.png" }],
      },
    ],
  }),
}));

// buy-panel imports ensureGuestSession → auth-client → better-auth, which
// pulls optional otel deps that don't resolve under vitest; mock the module.
vi.mock("@/lib/ensure-guest-session", () => ({
  ensureGuestSession: vi.fn(async () => {}),
}));
vi.mock("@/app/cart/actions", () => ({
  addToCart: vi.fn(async () => ({ ok: true, count: 1 })),
}));

import { buyPublishedDesign } from "../../actions";
import { addToCart } from "@/app/cart/actions";
import { ADD_TO_CART_FAILED, CHECKOUT_FAILED } from "@/lib/action-copy";

/** The panel starts collapsed (#128); most tests exercise the expanded stack. */
function expand() {
  fireEvent.click(screen.getByTestId("order-expand"));
}

function buyButton() {
  // Rendered twice (desktop inline + mobile sticky); both share state.
  return screen.getAllByRole("button", { name: /Order — \$/ })[0];
}

describe("BuyPanel progressive disclosure (#128)", () => {
  it("starts collapsed: Order CTA + startAction, no pickers", () => {
    render(
      <BuyPanel
        imageId="img-1"
        isLoggedIn
        startAction={<button>New design from this image</button>}
      />
    );
    // Collapsed CTA carries no price — the total depends on options the
    // user hasn't picked yet; the expanded buy button shows the real total.
    expect(screen.getByRole("button", { name: "Order" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "New design from this image" })
    ).toBeInTheDocument();
    // No picker stack yet.
    expect(screen.queryByText("Size")).not.toBeInTheDocument();
    expect(screen.queryByText("Choose a size")).not.toBeInTheDocument();
    expect(screen.queryByText("Total")).not.toBeInTheDocument();
  });

  it("tapping Order expands the picker stack in place", () => {
    render(
      <BuyPanel
        imageId="img-1"
        isLoggedIn
        startAction={<button>New design from this image</button>}
      />
    );
    expand();
    expect(screen.getAllByText("Choose a size").length).toBeGreaterThan(0);
    expect(screen.getByText("Total")).toBeInTheDocument();
    // The expand toggle is gone; the remix action stays available.
    expect(screen.queryByTestId("order-expand")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "New design from this image" })
    ).toBeInTheDocument();
  });

  it("signed-out: expanding reveals the sign-in gate, not a buy button", () => {
    render(<BuyPanel imageId="img-1" isLoggedIn={false} />);
    expand();
    expect(screen.getAllByText("Sign in to buy").length).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: /Order — \$/ })
    ).not.toBeInTheDocument();
  });
});

describe("BuyPanel size gate (#60)", () => {
  it("starts with no size selected and the CTA disabled", () => {
    render(<BuyPanel imageId="img-1" isLoggedIn />);
    expand();
    expect(buyButton()).toBeDisabled();
    expect(screen.getAllByText("Choose a size").length).toBeGreaterThan(0);
    expect(buyPublishedDesign).not.toHaveBeenCalled();
  });

  it("enables the CTA once a size is picked", () => {
    render(<BuyPanel imageId="img-1" isLoggedIn />);
    expand();
    fireEvent.click(screen.getByRole("button", { name: "M" }));
    expect(buyButton()).toBeEnabled();
    expect(screen.queryByText("Choose a size")).not.toBeInTheDocument();
  });

  it("labels the pinned color as the designer's pick", () => {
    render(<BuyPanel imageId="img-1" isLoggedIn preferredColor="Black" />);
    expand();
    expect(
      screen.getByText("Shown in Black — designer's pick")
    ).toBeInTheDocument();
  });

  it("shows no designer's-pick note without a pinned color", () => {
    render(<BuyPanel imageId="img-1" isLoggedIn />);
    expand();
    expect(screen.queryByText(/designer's pick/)).not.toBeInTheDocument();
  });
});

// Regression guards for the #86 fallout: the swatch row must always be
// exactly the selected product's palette, and a selection invalidated by a
// product switch resets per the §3 precedence (pinned backdrop > White >
// first) instead of an ad-hoc first-color pick.
const CLASSIC = "bella-canvas-3001";
const BOX = "cotton-heritage-mc1087";
const classicColors = getBlankOrThrow(CLASSIC).colors.map((c) => c.name);
const boxColors = getBlankOrThrow(BOX).colors.map((c) => c.name);

/** Color swatches are the only buttons carrying a title attribute. */
function swatchNames() {
  return screen
    .getAllByRole("button")
    .filter((b) => b.hasAttribute("title"))
    .map((b) => b.getAttribute("title"));
}

describe("BuyPanel color palette derives from the selected product", () => {
  it("renders exactly the default product's colors", () => {
    render(<BuyPanel imageId="img-1" isLoggedIn />);
    expand();
    expect(swatchNames()).toEqual(classicColors);
  });

  it("a remembered product seeds its own palette, not the default's", () => {
    render(
      <BuyPanel
        imageId="img-1"
        isLoggedIn
        remembered={{ blankId: BOX, size: null }}
      />
    );
    expand();
    expect(swatchNames()).toEqual(boxColors);
  });

  it("switching product replaces the palette entirely", () => {
    render(<BuyPanel imageId="img-1" isLoggedIn />);
    expand();
    fireEvent.click(screen.getByRole("button", { name: "Box Tee" }));
    // Exact equality: every Box Tee color, nothing carried over.
    expect(swatchNames()).toEqual(boxColors);
    expect(screen.queryByTitle("Sage")).not.toBeInTheDocument();
    // And back: the full Classic palette returns.
    fireEvent.click(screen.getByRole("button", { name: "Classic Tee" }));
    expect(swatchNames()).toEqual(classicColors);
  });

  it("re-applies the pinned backdrop when a switch invalidates the pick", () => {
    // Pinned Black is valid on both products. The user's Sage pick dies with
    // the switch to Box Tee, so the reset goes back to the designer's pick —
    // not to whatever color happens to be first in the new palette.
    render(<BuyPanel imageId="img-1" isLoggedIn preferredColor="Black" />);
    expand();
    fireEvent.click(screen.getByTitle("Sage"));
    expect(screen.getByText("Color — Sage")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Box Tee" }));
    expect(screen.getByText("Color — Black")).toBeInTheDocument();
  });

  it("falls back to White when the pinned backdrop is invalid too", () => {
    // Tan exists on the Classic Tee only.
    render(<BuyPanel imageId="img-1" isLoggedIn preferredColor="Tan" />);
    expand();
    fireEvent.click(screen.getByTitle("Sage"));
    fireEvent.click(screen.getByRole("button", { name: "Box Tee" }));
    expect(screen.getByText("Color — White")).toBeInTheDocument();
  });

  it("keeps a still-valid pick across a product switch", () => {
    render(<BuyPanel imageId="img-1" isLoggedIn />);
    expand();
    fireEvent.click(screen.getByTitle("Black"));
    fireEvent.click(screen.getByRole("button", { name: "Box Tee" }));
    expect(screen.getByText("Color — Black")).toBeInTheDocument();
  });
});

describe("BuyPanel back design (#25 on /d)", () => {
  it("hides the affordance without backEnabled", () => {
    render(<BuyPanel imageId="img-1" isLoggedIn />);
    expand();
    expect(screen.queryByText(/Add a back design/)).not.toBeInTheDocument();
  });

  async function pickBack() {
    fireEvent.click(screen.getByText(/Add a back design/));
    fireEvent.click(
      await screen.findByRole("button", { name: "My designs option" })
    );
  }

  it("picking a source adds the +$8 line and updates the total", async () => {
    render(<BuyPanel imageId="img-1" isLoggedIn backEnabled />);
    expand();
    await pickBack();

    // Both the picked row and the price line label it.
    expect(screen.getAllByText("Back design").length).toBeGreaterThan(0);
    expect(screen.getByText("+$8.00")).toBeInTheDocument();
    // $19.43 front + $8.00 back + $4.69 shipping.
    fireEvent.click(screen.getByRole("button", { name: "M" }));
    expect(
      screen.getAllByRole("button", { name: "Order — $32.12" }).length
    ).toBeGreaterThan(0);
  });

  it("passes the picked back image to buyPublishedDesign", async () => {
    render(<BuyPanel imageId="img-1" isLoggedIn backEnabled />);
    expand();
    await pickBack();
    fireEvent.click(screen.getByRole("button", { name: "M" }));
    fireEvent.click(buyButton());
    expect(buyPublishedDesign).toHaveBeenCalledWith(
      expect.objectContaining({ backImageId: "back-1" })
    );
  });

  it("the remove affordance clears the back and the upcharge", async () => {
    render(<BuyPanel imageId="img-1" isLoggedIn backEnabled />);
    expand();
    await pickBack();
    fireEvent.click(
      screen.getByRole("button", { name: "Remove back design" })
    );
    expect(screen.queryByText("+$8.00")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "M" }));
    expect(
      screen.getAllByRole("button", { name: "Order — $24.12" }).length
    ).toBeGreaterThan(0);
  });
});

describe("BuyPanel add to cart (#146)", () => {
  it("hidden when the cart flag is off (default)", () => {
    render(<BuyPanel imageId="img-1" isLoggedIn />);
    expand();
    expect(screen.queryAllByTestId("add-to-cart")).toHaveLength(0);
  });

  it("shows when cartEnabled, gated on size like /preview", () => {
    render(<BuyPanel imageId="img-1" isLoggedIn cartEnabled />);
    expand();
    const [btn] = screen.getAllByTestId("add-to-cart");
    expect(btn).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "M" }));
    expect(btn).toBeEnabled();
  });

  it("shows for signed-out visitors too — guests have carts", () => {
    render(<BuyPanel imageId="img-1" isLoggedIn={false} cartEnabled />);
    expand();
    expect(screen.getAllByTestId("add-to-cart").length).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("link", { name: "Sign in to buy" }).length
    ).toBeGreaterThan(0);
  });

  it("pins the exact image: addToCart is called with frontImageId", async () => {
    render(<BuyPanel imageId="img-1" isLoggedIn cartEnabled />);
    expand();
    fireEvent.click(screen.getByRole("button", { name: "M" }));
    fireEvent.click(screen.getAllByTestId("add-to-cart")[0]);
    await vi.waitFor(() => expect(addToCart).toHaveBeenCalled());
    expect(addToCart).toHaveBeenCalledWith(
      expect.objectContaining({ frontImageId: "img-1", size: "M" })
    );
    expect(
      (addToCart as ReturnType<typeof vi.fn>).mock.calls[0][0]
    ).not.toHaveProperty("designId");
  });
});

// #167: the hero mirrors the back pick (to render a back tile) and opens the
// panel's picker from its add-a-back tile. The panel stays the source of
// truth for both; these are the report and the handle it exposes.
describe("BuyPanel back pick reporting + handle (#167)", () => {
  it("onBackChange reports null on mount, then the pick", async () => {
    const onBackChange = vi.fn();
    render(
      <BuyPanel
        imageId="img-1"
        isLoggedIn
        backEnabled
        onBackChange={onBackChange}
      />
    );
    expect(onBackChange).toHaveBeenCalledTimes(1);
    expect(onBackChange).toHaveBeenLastCalledWith(null);

    expand();
    fireEvent.click(screen.getByText(/Add a back design/));
    fireEvent.click(
      await screen.findByRole("button", { name: "My designs option" })
    );
    expect(onBackChange).toHaveBeenLastCalledWith({
      id: "back-1",
      imageUrl: "https://img.example/back-1.png",
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Remove back design" })
    );
    expect(onBackChange).toHaveBeenLastCalledWith(null);
  });

  it("the handle's openBackPicker shows the picker", () => {
    const ref = createRef<BuyPanelHandle>();
    render(<BuyPanel ref={ref} imageId="img-1" isLoggedIn backEnabled />);
    expand();
    expect(
      screen.queryByText("Pick an image to print on the back.")
    ).not.toBeInTheDocument();

    act(() => ref.current!.openBackPicker());
    expect(
      screen.getByText("Pick an image to print on the back.")
    ).toBeInTheDocument();
  });
});

describe("BuyPanel Paper pass (#188)", () => {
  it("expanded: still renders the size picker, the total and Add to cart", () => {
    render(<BuyPanel imageId="img-1" isLoggedIn cartEnabled />);
    expand();
    // The money surface survives the re-skin: a size gate, a computed total,
    // and the cart path. The nightly Stripe e2e buys via the cart, not via
    // this page, so this is the guard for the panel's own rendering.
    const blank = getBlankOrThrow("bella-canvas-3001");
    expect(screen.getByRole("button", { name: blank.sizes[0] })).toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
    // Rendered twice (desktop inline + mobile sticky bar), like every other
    // add-to-cart assertion in this file — same reason buyButton() above
    // takes index [0].
    expect(screen.getAllByTestId("add-to-cart")[0]).toBeInTheDocument();
    // Size gate still closed until a pick.
    expect(screen.getAllByTestId("add-to-cart")[0]).toBeDisabled();
  });

  it("expanded: labels the sections it owns in mono caps", () => {
    render(<BuyPanel imageId="img-1" isLoggedIn backEnabled />);
    expand();
    expect(screen.getByText("Product")).toBeInTheDocument();
    // The back section became "Front & back" when it gained the Front row
    // and the swap (#138 slice 3).
    expect(screen.getByText("Front & back")).toBeInTheDocument();
    expect(screen.getByText("Price")).toBeInTheDocument();
  });
});

// #138 slice 3: with a back picked the buyer can swap the two sides — the
// pick onto the front, this page's image onto the back. No front picker.
describe("BuyPanel swap (#138 slice 3)", () => {
  const PAGE_URL = "https://img.example/page.png";

  function renderPanel(extra: Partial<Parameters<typeof BuyPanel>[0]> = {}) {
    return render(
      <BuyPanel
        imageId="img-1"
        imageUrl={PAGE_URL}
        isLoggedIn
        backEnabled
        cartEnabled
        {...extra}
      />
    );
  }

  async function pickBack() {
    fireEvent.click(screen.getByText(/Add a back design/));
    fireEvent.click(
      await screen.findByRole("button", { name: "My designs option" })
    );
  }

  function rowImage(side: "front" | "back") {
    return screen
      .getByTestId(`side-row-${side}`)
      .querySelector("img")
      ?.getAttribute("src");
  }

  function swapButton() {
    return screen.queryByRole("button", { name: "Swap front and back" });
  }

  it("offers no swap and no Front row until a back is picked", () => {
    renderPanel();
    expand();
    expect(swapButton()).not.toBeInTheDocument();
    expect(screen.queryByTestId("side-row-front")).not.toBeInTheDocument();
    // And no front picker anywhere on this page.
    expect(screen.queryByText(/print on the front/)).not.toBeInTheDocument();
  });

  it("with a back picked: Front row shows this page's image, Back row the pick", async () => {
    renderPanel();
    expand();
    await pickBack();
    expect(rowImage("front")).toBe(PAGE_URL);
    expect(rowImage("back")).toBe("https://img.example/back-1.png");
    expect(swapButton()).toBeInTheDocument();
    // The Front row has no controls of its own.
    const frontRow = screen.getByTestId("side-row-front");
    expect(frontRow.querySelector("button")).toBeNull();
  });

  it("Swap exchanges the rows; × follows the pick, Change stays off the front", async () => {
    renderPanel();
    expand();
    await pickBack();

    fireEvent.click(swapButton()!);
    expect(rowImage("front")).toBe("https://img.example/back-1.png");
    expect(rowImage("back")).toBe(PAGE_URL);
    // No Change anywhere while swapped — on the front it would be a front
    // picker. The × moved with the pick to the Front row.
    expect(screen.queryByRole("button", { name: "Change" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Remove back design" })
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId("side-row-front")).getByRole("button", {
        name: "Remove front design",
      })
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("side-row-back")).queryByRole("button")
    ).toBeNull();

    fireEvent.click(swapButton()!);
    expect(rowImage("front")).toBe(PAGE_URL);
    expect(rowImage("back")).toBe("https://img.example/back-1.png");
    expect(screen.getByRole("button", { name: "Change" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove back design" })
    ).toBeInTheDocument();
  });

  it("Swap is a toggle button: aria-pressed says which way round the shirt is", async () => {
    renderPanel();
    expand();
    await pickBack();
    expect(swapButton()).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(swapButton()!);
    expect(swapButton()).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(swapButton()!);
    expect(swapButton()).toHaveAttribute("aria-pressed", "false");
  });

  it("removing the pick while swapped leaves this page's image alone on the front", async () => {
    const onFrontChange = vi.fn();
    const onBackChange = vi.fn();
    renderPanel({ onFrontChange, onBackChange });
    expand();
    await pickBack();
    fireEvent.click(swapButton()!);

    fireEvent.click(screen.getByRole("button", { name: "Remove front design" }));
    expect(screen.queryByTestId("side-row-front")).not.toBeInTheDocument();
    expect(swapButton()).not.toBeInTheDocument();
    expect(onFrontChange).toHaveBeenLastCalledWith({ id: "img-1", imageUrl: PAGE_URL });
    expect(onBackChange).toHaveBeenLastCalledWith(null);

    fireEvent.click(screen.getByRole("button", { name: "M" }));
    // $19.43 + $4.69 — the back upcharge went with the back.
    expect(
      screen.getAllByRole("button", { name: "Order — $24.12" }).length
    ).toBeGreaterThan(0);
    vi.mocked(buyPublishedDesign).mockClear();
    fireEvent.click(buyButton());
    const call = vi.mocked(buyPublishedDesign).mock.calls[0][0];
    expect(call.backImageId).toBeUndefined();
    expect(call).not.toHaveProperty("frontImageId");
  });

  it("a swap never moves the price", async () => {
    renderPanel();
    expand();
    await pickBack();
    fireEvent.click(screen.getByRole("button", { name: "M" }));
    // $19.43 front + $8.00 back + $4.69 shipping, before and after.
    expect(
      screen.getAllByRole("button", { name: "Order — $32.12" }).length
    ).toBeGreaterThan(0);
    fireEvent.click(swapButton()!);
    expect(
      screen.getAllByRole("button", { name: "Order — $32.12" }).length
    ).toBeGreaterThan(0);
    expect(screen.getByText("+$8.00")).toBeInTheDocument();
  });

  it("buy sends the swapped front and this page's image as the back", async () => {
    renderPanel();
    expand();
    await pickBack();
    fireEvent.click(swapButton()!);
    fireEvent.click(screen.getByRole("button", { name: "M" }));
    vi.mocked(buyPublishedDesign).mockClear();
    fireEvent.click(buyButton());
    expect(buyPublishedDesign).toHaveBeenCalledWith(
      expect.objectContaining({
        imageId: "img-1",
        frontImageId: "back-1",
        backImageId: "img-1",
      })
    );
  });

  it("unswapped, buy sends no frontImageId at all", async () => {
    renderPanel();
    expand();
    await pickBack();
    fireEvent.click(screen.getByRole("button", { name: "M" }));
    vi.mocked(buyPublishedDesign).mockClear();
    fireEvent.click(buyButton());
    const call = vi.mocked(buyPublishedDesign).mock.calls[0][0];
    expect(call).toMatchObject({ imageId: "img-1", backImageId: "back-1" });
    expect(call).not.toHaveProperty("frontImageId");
  });

  it("add to cart sends the swap as front + back on the frontImageId entry", async () => {
    renderPanel();
    expand();
    await pickBack();
    fireEvent.click(swapButton()!);
    fireEvent.click(screen.getByRole("button", { name: "M" }));
    vi.mocked(addToCart).mockClear();
    fireEvent.click(screen.getAllByTestId("add-to-cart")[0]);
    await vi.waitFor(() => expect(addToCart).toHaveBeenCalled());
    expect(addToCart).toHaveBeenCalledWith(
      expect.objectContaining({
        frontImageId: "img-1",
        front: "back-1",
        back: "img-1",
      })
    );
  });

  it("removing the back after swapping back resets to this page's image alone", async () => {
    renderPanel();
    expand();
    await pickBack();
    fireEvent.click(swapButton()!);
    fireEvent.click(swapButton()!);
    fireEvent.click(screen.getByRole("button", { name: "Remove back design" }));
    expect(swapButton()).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "M" }));
    vi.mocked(buyPublishedDesign).mockClear();
    fireEvent.click(buyButton());
    const call = vi.mocked(buyPublishedDesign).mock.calls[0][0];
    expect(call.backImageId).toBeUndefined();
    expect(call).not.toHaveProperty("frontImageId");
  });

  it("no swap is offered when the pick is this page's own image", async () => {
    const { getBuyPageBackSources } = await import("../../actions");
    vi.mocked(getBuyPageBackSources).mockResolvedValueOnce({
      groups: [
        {
          id: "shop",
          label: "Shop",
          images: [{ id: "img-1", imageUrl: PAGE_URL }],
        },
      ],
    });
    renderPanel();
    expand();
    fireEvent.click(screen.getByText(/Add a back design/));
    fireEvent.click(await screen.findByRole("button", { name: "Shop option" }));
    expect(rowImage("back")).toBe(PAGE_URL);
    expect(swapButton()).not.toBeInTheDocument();
  });

  it("reports both sides: onFrontChange and onBackChange follow the swap", async () => {
    const onFrontChange = vi.fn();
    const onBackChange = vi.fn();
    renderPanel({ onFrontChange, onBackChange });
    expect(onFrontChange).toHaveBeenLastCalledWith({
      id: "img-1",
      imageUrl: PAGE_URL,
    });
    expand();
    await pickBack();
    fireEvent.click(swapButton()!);
    expect(onFrontChange).toHaveBeenLastCalledWith({
      id: "back-1",
      imageUrl: "https://img.example/back-1.png",
    });
    expect(onBackChange).toHaveBeenLastCalledWith({
      id: "img-1",
      imageUrl: PAGE_URL,
    });
  });
});

// Order and Add to cart used to swallow a failure: the button came back and
// nothing said why. Now a line of our own copy appears under the CTAs (the
// thrown message is a Next.js digest in production).
describe("BuyPanel failure notices", () => {
  it("a failed Order shows the checkout notice and re-enables the button", async () => {
    vi.mocked(buyPublishedDesign).mockRejectedValueOnce(new Error("digest"));
    render(<BuyPanel imageId="img-1" isLoggedIn />);
    expand();
    fireEvent.click(screen.getByRole("button", { name: "M" }));
    fireEvent.click(buyButton());
    const notices = await screen.findAllByText(CHECKOUT_FAILED);
    expect(notices.length).toBeGreaterThan(0);
    expect(buyButton()).toBeEnabled();
  });

  it("a failed Add to cart shows the cart notice", async () => {
    vi.mocked(addToCart).mockRejectedValueOnce(new Error("digest"));
    render(<BuyPanel imageId="img-1" isLoggedIn cartEnabled />);
    expand();
    fireEvent.click(screen.getByRole("button", { name: "M" }));
    fireEvent.click(screen.getAllByTestId("add-to-cart")[0]);
    expect((await screen.findAllByText(ADD_TO_CART_FAILED)).length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("add-to-cart")[0]).toBeEnabled();
  });

  it("signed-out: a failed Add to cart shows the notice too", async () => {
    vi.mocked(addToCart).mockRejectedValueOnce(new Error("digest"));
    render(<BuyPanel imageId="img-1" isLoggedIn={false} cartEnabled />);
    expand();
    fireEvent.click(screen.getByRole("button", { name: "M" }));
    fireEvent.click(screen.getAllByTestId("add-to-cart")[0]);
    expect((await screen.findAllByText(ADD_TO_CART_FAILED)).length).toBeGreaterThan(0);
  });

  it("the notice clears on the next attempt", async () => {
    vi.mocked(buyPublishedDesign)
      .mockRejectedValueOnce(new Error("digest"))
      .mockImplementationOnce(() => new Promise(() => {}));
    render(<BuyPanel imageId="img-1" isLoggedIn />);
    expand();
    fireEvent.click(screen.getByRole("button", { name: "M" }));
    fireEvent.click(buyButton());
    await screen.findAllByText(CHECKOUT_FAILED);
    fireEvent.click(buyButton());
    expect(screen.queryByText(CHECKOUT_FAILED)).not.toBeInTheDocument();
  });
});
