/**
 * /preview shows the shirt as an object (#167): front hero + back tile,
 * tap to swap prominence, the back mockup fetched only after the front's
 * fetch settles, and a back failure visible in the tile with its own retry.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";

// Set per test; the page reads it through the mocked useSearchParams.
let params = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => params,
}));

vi.mock("../../design/actions", () => ({
  getDesign: vi.fn(async () => ({
    primaryImageId: "img-primary",
    backgroundColor: null,
    mockupUrls: null,
  })),
}));

vi.mock("../../order/actions", () => ({
  calculatePrice: vi.fn(async () => ({
    baseCost: 10,
    generationCost: 0,
    total: 19.43,
  })),
  createCheckoutSession: vi.fn(),
}));

vi.mock("../../cart/actions", () => ({
  addToCart: vi.fn(),
  isCartEnabled: vi.fn(async () => false),
}));

// ensureGuestSession → auth-client → better-auth pulls optional otel deps
// that don't resolve under vitest; mock the module.
vi.mock("@/lib/ensure-guest-session", () => ({
  ensureGuestSession: vi.fn(async () => {}),
}));

// Lazily referenced from the factory (hoisted above these declarations).
const generateMockup = vi.fn();
const getOrCreatePlacementRender = vi.fn();

vi.mock("../actions", () => ({
  isMultiPlacementEnabled: vi.fn(async () => true),
  getOrCreatePlacementRender: (...args: unknown[]) =>
    getOrCreatePlacementRender(...args),
  generateMockup: (...args: unknown[]) => generateMockup(...args),
  ensureMockupsPrefetched: vi.fn(async () => ({ kicked: false })),
  getBackDesignSources: vi.fn(async () => ({
    groups: [
      {
        id: "this-design",
        label: "This design",
        images: [{ id: "img-back", imageUrl: "https://img.example/back.png" }],
      },
    ],
  })),
  getLastPurchaseDefaults: vi.fn(async () => null),
}));

import PreviewPage from "../page";

const WITH_BACK = "id=d1&product=bella-canvas-3001&color=Black&back=img-back";
const NO_BACK = "id=d1&product=bella-canvas-3001&color=Black";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** generateMockup calls for one placement (5th positional arg). */
function mockupCallsFor(placement: "front" | "back") {
  return generateMockup.mock.calls.filter((c) => c[4] === placement);
}

/** The instant-layer artwork <img> inside a side panel (alt="" → no role). */
function instantArtwork(panel: HTMLElement) {
  return panel.querySelector<HTMLImageElement>(
    '[data-testid="side-mockup-instant"] img'
  );
}

beforeEach(() => {
  generateMockup.mockReset();
  getOrCreatePlacementRender.mockReset();
  getOrCreatePlacementRender.mockImplementation(
    async (_d: string, _p: string, placement = "front", source?: string) => ({
      id: `render-${placement}`,
      imageUrl: `https://img.example/${placement}-${source ?? "primary"}.png`,
      aspectRatio: "1:1",
    })
  );
  generateMockup.mockImplementation(
    async (_d: string, _c: string, _p: string, _s: number, placement = "front") => ({
      mockupUrl: `https://mock.example/${placement}.jpg`,
    })
  );
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("/preview sides (#167)", () => {
  it("with a back: front is the hero, back the tile; tapping the tile swaps them", async () => {
    params = new URLSearchParams(WITH_BACK);
    render(<PreviewPage />);

    const hero = await screen.findByTestId("side-hero");
    expect(hero).toHaveAttribute("data-side", "front");
    // The tile appears once the multi-placement flag resolves.
    const tile = await screen.findByTestId("side-tile");
    expect(tile).toHaveAttribute("data-side", "back");
    expect(screen.queryByTestId("add-back-tile")).not.toBeInTheDocument();

    fireEvent.click(within(tile).getByRole("button", { name: "Show back large" }));

    expect(screen.getByTestId("side-hero")).toHaveAttribute("data-side", "back");
    const swapped = screen.getByTestId("side-tile");
    expect(swapped).toHaveAttribute("data-side", "front");
    expect(
      within(swapped).getByRole("button", { name: "Show front large" })
    ).toBeInTheDocument();

    // And back again.
    fireEvent.click(within(swapped).getByRole("button", { name: "Show front large" }));
    expect(screen.getByTestId("side-hero")).toHaveAttribute("data-side", "front");
    expect(screen.getByTestId("side-tile")).toHaveAttribute("data-side", "back");
  });

  it("requests the back mockup only after the front's mockup fetch settles", async () => {
    params = new URLSearchParams(WITH_BACK);
    const front = deferred<{ mockupUrl: string }>();
    generateMockup.mockImplementation(
      (_d: string, _c: string, _p: string, _s: number, placement = "front") =>
        placement === "front"
          ? front.promise
          : Promise.resolve({ mockupUrl: "https://mock.example/back.jpg" })
    );
    render(<PreviewPage />);

    const tile = await screen.findByTestId("side-tile");
    // Front fetch is in flight...
    await waitFor(() => expect(mockupCallsFor("front")).toHaveLength(1));
    // ...and the back's placement render has resolved (its artwork is on the
    // tile), so the only thing holding the back fetch is the front.
    await waitFor(() =>
      expect(instantArtwork(tile)?.src).toBe(
        "https://img.example/back-img-back.png"
      )
    );
    expect(mockupCallsFor("back")).toHaveLength(0);

    front.resolve({ mockupUrl: "https://mock.example/front.jpg" });

    await waitFor(() => expect(mockupCallsFor("back")).toHaveLength(1));
    expect(mockupCallsFor("front")).toHaveLength(1);
    // The back call carries its picked source.
    expect(mockupCallsFor("back")[0][5]).toBe("img-back");
  });

  it("a failed back mockup shows an alert with retry in the tile, not the hero", async () => {
    params = new URLSearchParams(WITH_BACK);
    vi.spyOn(console, "error").mockImplementation(() => {});
    generateMockup.mockImplementation(
      async (_d: string, _c: string, _p: string, _s: number, placement = "front") => {
        if (placement === "back") throw new Error("printful down");
        return { mockupUrl: "https://mock.example/front.jpg" };
      }
    );
    render(<PreviewPage />);

    const tile = await screen.findByTestId("side-tile");
    const retry = await within(tile).findByRole("button", { name: "Retry preview" });
    expect(within(tile).getByRole("alert")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("side-hero")).queryByRole("alert")
    ).not.toBeInTheDocument();
    // The error blocks the auto-fire: exactly one attempt so far, no loop.
    expect(mockupCallsFor("back")).toHaveLength(1);

    fireEvent.click(retry);

    await waitFor(() => expect(mockupCallsFor("back")).toHaveLength(2));
    expect(mockupCallsFor("back")[1][4]).toBe("back");
  });

  it("without a back: the add-back tile opens the back picker; Cancel closes it", async () => {
    params = new URLSearchParams(NO_BACK);
    render(<PreviewPage />);

    await screen.findByTestId("side-hero");
    const addBack = await screen.findByTestId("add-back-tile");
    expect(addBack).toHaveTextContent("Add a back design (+$8.00)");
    expect(screen.queryByTestId("side-tile")).not.toBeInTheDocument();

    fireEvent.click(addBack);

    expect(
      await screen.findByText("Pick an image to print on the back.")
    ).toBeInTheDocument();
    expect(screen.queryByTestId("side-hero")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(
      screen.queryByText("Pick an image to print on the back.")
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("side-hero")).toHaveAttribute("data-side", "front");
    expect(screen.getByTestId("add-back-tile")).toBeInTheDocument();
    // No back was picked, so nothing was fetched for it.
    expect(mockupCallsFor("back")).toHaveLength(0);
  });
});
