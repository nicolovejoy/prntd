/**
 * BuyHero (#167 decision 1 on the image detail page): once Order expands the
 * panel, the hero shows the front and — after a back is picked in the panel
 * — a smaller back tile rendering the real back mockup, fetched strictly
 * after the front's fetch settles. Tapping the tile swaps prominence; a back
 * failure is visible in the tile with a retry.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  act,
} from "@testing-library/react";
import { DEFAULT_BLANK_ID } from "@/lib/blanks";
import { BuyHero } from "../buy-hero";

vi.mock("../../actions", () => ({
  getListingMockup: vi.fn(),
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

// buy-panel imports ensureGuestSession → auth-client → better-auth, which
// pulls optional otel deps that don't resolve under vitest; mock the module.
vi.mock("@/lib/ensure-guest-session", () => ({
  ensureGuestSession: vi.fn(async () => {}),
}));
vi.mock("@/app/cart/actions", () => ({
  addToCart: vi.fn(async () => ({ ok: true, count: 1 })),
}));
// The collapsed hero is PublishedImageView, which wires the owner's
// backdrop picker to these.
vi.mock("@/app/designs/actions", () => ({
  updatePublishedNaming: vi.fn(async () => {}),
  unpublishImage: vi.fn(async () => {}),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { getListingMockup, getListingBackMockup } from "../../actions";

const frontMock = vi.mocked(getListingMockup);
const backMock = vi.mocked(getListingBackMockup);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderHero(props: { backEnabled?: boolean } = {}) {
  return render(
    <BuyHero
      imageId="img-1"
      imageUrl="https://img.example/front.png"
      alt="Fox"
      initialBackgroundColor="Black"
      canEdit={false}
      isLoggedIn
      backEnabled={props.backEnabled}
    >
      <p>meta</p>
    </BuyHero>
  );
}

function expand() {
  fireEvent.click(screen.getByTestId("order-expand"));
}

/** Pick the one back source through the panel's picker, via the hero tile. */
async function pickBack() {
  fireEvent.click(screen.getByTestId("add-back-tile"));
  fireEvent.click(
    await screen.findByRole("button", { name: "My designs option" })
  );
}

beforeEach(() => {
  frontMock.mockReset().mockResolvedValue({ mockupUrl: "https://r2/front.jpg" });
  backMock.mockReset().mockResolvedValue({ mockupUrl: "https://r2/back.jpg" });
});

describe("BuyHero (#167)", () => {
  it("expanding swaps to the front hero and fetches the front mockup; no tile without backEnabled", async () => {
    renderHero();
    expect(screen.queryByTestId("side-hero")).not.toBeInTheDocument();
    expect(frontMock).not.toHaveBeenCalled();

    expand();
    expect(screen.getByTestId("side-hero")).toHaveAttribute("data-side", "front");
    await waitFor(() =>
      expect(frontMock).toHaveBeenCalledWith({
        imageId: "img-1",
        productId: DEFAULT_BLANK_ID,
        colorName: "Black",
      })
    );
    expect(screen.queryByTestId("side-tile")).not.toBeInTheDocument();
    expect(screen.queryByTestId("add-back-tile")).not.toBeInTheDocument();
    expect(backMock).not.toHaveBeenCalled();
    // The meta block and the panel are still in place around the hero.
    expect(screen.getByText("meta")).toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
  });

  it("the side label pill shows only once a back is picked (two panels on screen)", async () => {
    renderHero({ backEnabled: true });
    expand();
    await screen.findByTestId("side-hero");
    // Lone front (the add-back tile, not a second side panel): no pill.
    expect(screen.queryByText("Front")).not.toBeInTheDocument();

    await pickBack();
    await screen.findByTestId("side-tile");
    expect(screen.getByText("Front")).toBeInTheDocument();
    expect(screen.getByText("Back")).toBeInTheDocument();
  });

  it("with backEnabled and no back, the tile slot offers Add a back design and opens the panel picker", async () => {
    renderHero({ backEnabled: true });
    expand();
    const tile = screen.getByTestId("add-back-tile");
    expect(tile).toHaveTextContent("Add a back design (+$8.00)");
    expect(
      screen.queryByText("Pick an image to print on the back.")
    ).not.toBeInTheDocument();

    fireEvent.click(tile);
    expect(
      await screen.findByText("Pick an image to print on the back.")
    ).toBeInTheDocument();
  });

  it("picking a back shows the back tile and fetches its mockup only after the front settles", async () => {
    const front = deferred<{ mockupUrl: string }>();
    frontMock.mockReturnValue(front.promise);
    renderHero({ backEnabled: true });
    expand();
    await waitFor(() => expect(frontMock).toHaveBeenCalledTimes(1));

    await pickBack();
    const tile = await screen.findByTestId("side-tile");
    expect(tile).toHaveAttribute("data-side", "back");
    // The tile is on screen with the instant artwork while the front is
    // still in flight — but the back fetch has not started.
    expect(
      within(tile).getByTestId("side-mockup-instant").querySelector("img")
    ).toHaveAttribute("src", "https://img.example/back-1.png");
    expect(backMock).not.toHaveBeenCalled();

    await act(async () => {
      front.resolve({ mockupUrl: "https://r2/front.jpg" });
    });
    await waitFor(() =>
      expect(backMock).toHaveBeenCalledWith({
        imageId: "img-1",
        backImageId: "back-1",
        productId: DEFAULT_BLANK_ID,
        colorName: "Black",
      })
    );
    expect(backMock).toHaveBeenCalledTimes(1);
    // The exact back mockup mounts in the tile once its URL is known.
    await waitFor(() =>
      expect(
        within(screen.getByTestId("side-tile")).getByTestId("side-mockup-exact")
      ).toBeInTheDocument()
    );
  });

  it("fetches the back after a FAILED front too — the front's error never hides the back", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    frontMock.mockRejectedValue(new Error("printful down"));
    renderHero({ backEnabled: true });
    expand();
    await pickBack();

    await waitFor(() => expect(backMock).toHaveBeenCalledTimes(1));
    // And the front's failure is visible in the hero with its own retry.
    const hero = screen.getByTestId("side-hero");
    expect(within(hero).getByRole("alert")).toHaveTextContent(
      "Couldn't render the preview."
    );
    fireEvent.click(within(hero).getByRole("button", { name: "Retry preview" }));
    await waitFor(() => expect(frontMock).toHaveBeenCalledTimes(2));
    // A front retry does not re-render the healthy back.
    expect(backMock).toHaveBeenCalledTimes(1);
  });

  it("tapping the tile swaps which side is the hero", async () => {
    renderHero({ backEnabled: true });
    expand();
    await pickBack();
    await screen.findByTestId("side-tile");

    fireEvent.click(screen.getByRole("button", { name: "Show back large" }));
    expect(screen.getByTestId("side-hero")).toHaveAttribute("data-side", "back");
    expect(screen.getByTestId("side-tile")).toHaveAttribute("data-side", "front");

    fireEvent.click(screen.getByRole("button", { name: "Show front large" }));
    expect(screen.getByTestId("side-hero")).toHaveAttribute("data-side", "front");
    expect(screen.getByTestId("side-tile")).toHaveAttribute("data-side", "back");
  });

  it("a back mockup failure is visible in the tile with a retry that re-fetches", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    backMock.mockRejectedValueOnce(new Error("printful down"));
    renderHero({ backEnabled: true });
    expand();
    await pickBack();

    const tile = await screen.findByTestId("side-tile");
    const alert = await within(tile).findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't render the preview.");
    expect(backMock).toHaveBeenCalledTimes(1);
    // No auto-refire: the error sits until the buyer retries.
    expect(screen.getByTestId("side-hero").querySelector("[role=alert]")).toBeNull();

    fireEvent.click(within(tile).getByRole("button", { name: "Retry preview" }));
    await waitFor(() => expect(backMock).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(within(screen.getByTestId("side-tile")).queryByRole("alert")).toBeNull()
    );
    // The front was never re-fetched by the back's retry.
    expect(frontMock).toHaveBeenCalledTimes(1);
  });

  it("removing the back drops the tile, the hero is the front again, and the add-back tile returns", async () => {
    renderHero({ backEnabled: true });
    expand();
    await pickBack();
    await screen.findByTestId("side-tile");
    // Make the back large first, so the reset is observable.
    fireEvent.click(screen.getByRole("button", { name: "Show back large" }));
    expect(screen.getByTestId("side-hero")).toHaveAttribute("data-side", "back");

    fireEvent.click(screen.getByRole("button", { name: "Remove back design" }));
    expect(screen.queryByTestId("side-tile")).not.toBeInTheDocument();
    expect(screen.getByTestId("side-hero")).toHaveAttribute("data-side", "front");
    expect(screen.getByTestId("add-back-tile")).toBeInTheDocument();
  });

  it("a color change clears both sides and re-fetches front first, then back", async () => {
    renderHero({ backEnabled: true });
    expand();
    await pickBack();
    await waitFor(() => expect(backMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        within(screen.getByTestId("side-tile")).getByTestId("side-mockup-exact")
      ).toBeInTheDocument()
    );

    const front = deferred<{ mockupUrl: string }>();
    frontMock.mockReturnValue(front.promise);
    fireEvent.click(screen.getByTitle("White"));

    await waitFor(() =>
      expect(frontMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ colorName: "White" })
      )
    );
    // The stale Black back mockup is gone from the tile at once, and the
    // White back is not requested until the White front settles.
    expect(
      within(screen.getByTestId("side-tile")).queryByTestId("side-mockup-exact")
    ).toBeNull();
    expect(backMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      front.resolve({ mockupUrl: "https://r2/front-white.jpg" });
    });
    await waitFor(() => expect(backMock).toHaveBeenCalledTimes(2));
    expect(backMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ backImageId: "back-1", colorName: "White" })
    );
  });
});
