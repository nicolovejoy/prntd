import { describe, it, expect, vi } from "vitest";
import { createRef } from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
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
