/**
 * /checkout is an async server component: it reads searchParams, gates on
 * the flag + session param + auth, then calls loadEmbeddedCheckout and
 * renders per its result. These tests call the exported async function
 * directly (the `confirm-page.test.tsx` pattern) and mock the loader, auth,
 * next/navigation and the client form component.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import CheckoutPage from "../page";
import { embeddedCheckoutPath } from "@/lib/embedded-checkout";

const h = vi.hoisted(() => ({
  loadEmbeddedCheckout: vi.fn(),
  session: null as unknown,
}));

vi.mock("@/lib/embedded-checkout-session", () => ({
  loadEmbeddedCheckout: (...args: unknown[]) => h.loadEmbeddedCheckout(...args),
}));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => h.session } },
  isAnonymousUser: (u: { isAnonymous?: boolean } | undefined) =>
    Boolean(u?.isAnonymous),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

vi.mock("../embedded-checkout-form", () => ({
  EmbeddedCheckoutForm: (props: {
    publishableKey: string;
    clientSecret: string;
  }) => (
    <div
      data-testid="embedded-checkout-form-mock"
      data-secret={props.clientSecret}
      data-key={props.publishableKey}
    />
  ),
}));

const VALID_SESSION = "cs_test_abc123";

function renderCheckout(
  searchParams: Record<string, string | string[] | undefined>
) {
  return CheckoutPage({ searchParams: Promise.resolve(searchParams) });
}

beforeEach(() => {
  vi.stubEnv("EMBEDDED_CHECKOUT_ENABLED", "true");
  h.session = { user: { id: "buyer", isAnonymous: false } };
  h.loadEmbeddedCheckout.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("CheckoutPage", () => {
  it("404s when the flag is off (invariant 1)", async () => {
    vi.stubEnv("EMBEDDED_CHECKOUT_ENABLED", "false");

    await expect(
      renderCheckout({ session: VALID_SESSION })
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(h.loadEmbeddedCheckout).not.toHaveBeenCalled();
  });

  it("awaits searchParams before checking the flag, so the page is dynamic even on the flag-off branch", async () => {
    vi.stubEnv("EMBEDDED_CHECKOUT_ENABLED", "false");
    let thenCalled = false;
    // A thenable, not a real Promise.resolve() — records whether `.then` was
    // actually invoked (i.e. searchParams was awaited) before notFound fires.
    // If the flag check ran first, this callback would never run.
    const searchParams = {
      then(
        resolve: (value: Record<string, string | string[] | undefined>) => void
      ) {
        thenCalled = true;
        resolve({ session: VALID_SESSION });
      },
    } as unknown as Promise<Record<string, string | string[] | undefined>>;

    await expect(
      CheckoutPage({ searchParams })
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(thenCalled).toBe(true);
  });

  it("404s on a malformed session param", async () => {
    await expect(
      renderCheckout({ session: "not-a-real-session-id" })
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("404s when the session param is missing", async () => {
    await expect(renderCheckout({})).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("404s when the session param is an array", async () => {
    await expect(
      renderCheckout({ session: [VALID_SESSION, "x"] })
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("redirects an anonymous session to sign-in with an encoded next", async () => {
    h.session = { user: { id: "anon", isAnonymous: true } };
    const expectedNext = embeddedCheckoutPath(VALID_SESSION, "/d/img-1");

    await expect(
      renderCheckout({ session: VALID_SESSION, from: "/d/img-1" })
    ).rejects.toThrow(
      `NEXT_REDIRECT:/sign-in?next=${encodeURIComponent(expectedNext)}`
    );
    expect(h.loadEmbeddedCheckout).not.toHaveBeenCalled();
  });

  it("redirects a signed-out visitor to sign-in", async () => {
    h.session = null;
    const expectedNext = embeddedCheckoutPath(VALID_SESSION, "");

    await expect(renderCheckout({ session: VALID_SESSION })).rejects.toThrow(
      `NEXT_REDIRECT:/sign-in?next=${encodeURIComponent(expectedNext)}`
    );
  });

  it("redirects to /order/confirm when the loader says paid", async () => {
    h.loadEmbeddedCheckout.mockResolvedValue({ kind: "paid" });

    await expect(renderCheckout({ session: VALID_SESSION })).rejects.toThrow(
      `NEXT_REDIRECT:/order/confirm?session_id=${encodeURIComponent(VALID_SESSION)}`
    );
  });

  it("redirects to the hosted url when the loader says hosted", async () => {
    h.loadEmbeddedCheckout.mockResolvedValue({
      kind: "hosted",
      url: "https://checkout.stripe.com/pay/cs_test_abc123",
    });

    await expect(renderCheckout({ session: VALID_SESSION })).rejects.toThrow(
      "NEXT_REDIRECT:https://checkout.stripe.com/pay/cs_test_abc123"
    );
  });

  it("404s when the loader says not-found", async () => {
    h.loadEmbeddedCheckout.mockResolvedValue({ kind: "not-found" });

    await expect(renderCheckout({ session: VALID_SESSION })).rejects.toThrow(
      "NEXT_NOT_FOUND"
    );
  });

  it("shows expired copy and a back link to the safe from", async () => {
    h.loadEmbeddedCheckout.mockResolvedValue({ kind: "expired" });

    render(
      await renderCheckout({ session: VALID_SESSION, from: "/d/img-1" })
    );

    expect(screen.getByText("This checkout expired.")).toBeInTheDocument();
    expect(screen.getByText("Nothing was charged.")).toBeInTheDocument();
    const back = screen.getByRole("link", { name: "← Back" });
    expect(back).toHaveAttribute("href", "/d/img-1");
  });

  it("shows unavailable copy with a Try again link and never says nothing was charged", async () => {
    h.loadEmbeddedCheckout.mockResolvedValue({ kind: "unavailable" });

    render(await renderCheckout({ session: VALID_SESSION }));

    expect(
      screen.getByText("Checkout isn't available right now.")
    ).toBeInTheDocument();
    expect(screen.getByText("Try again in a moment.")).toBeInTheDocument();
    expect(screen.queryByText(/nothing was charged/i)).not.toBeInTheDocument();

    const tryAgain = screen.getByRole("link", { name: "Try again" });
    expect(tryAgain).toHaveAttribute(
      "href",
      embeddedCheckoutPath(VALID_SESSION, "")
    );
  });

  it("falls back the back link to /shop when from is unsafe", async () => {
    h.loadEmbeddedCheckout.mockResolvedValue({ kind: "expired" });

    render(
      await renderCheckout({ session: VALID_SESSION, from: "//evil.com" })
    );

    const back = screen.getByRole("link", { name: "← Back" });
    expect(back).toHaveAttribute("href", "/shop");
  });

  it("renders the form + review block + back link on ready, with no $ anywhere", async () => {
    h.loadEmbeddedCheckout.mockResolvedValue({
      kind: "ready",
      clientSecret: "cs_secret_abc",
      publishableKey: "pk_test_abc123",
      summary: [
        {
          productName: "Classic Tee",
          color: "Black",
          size: "M",
          quantity: 1,
          frontImageUrl: "https://img.example/front.png",
          backImageUrl: null,
          colorHex: "#0c0c0c",
          mockupUrl: null,
        },
      ],
    });

    const { container } = render(
      await renderCheckout({ session: VALID_SESSION, from: "/d/img-1" })
    );

    const form = screen.getByTestId("embedded-checkout-form-mock");
    expect(form).toHaveAttribute("data-secret", "cs_secret_abc");
    expect(form).toHaveAttribute("data-key", "pk_test_abc123");
    expect(screen.getByText("Classic Tee")).toBeInTheDocument();
    expect(screen.getByText("Black / M")).toBeInTheDocument();
    const back = screen.getByRole("link", { name: "← Back" });
    expect(back).toHaveAttribute("href", "/d/img-1");
    expect(container.textContent).not.toContain("$");
    expect(screen.getByTestId("checkout-preview").className).toContain(
      "md:aspect-square"
    );
  });

  it("renders a back-design row only when the line has one", async () => {
    h.loadEmbeddedCheckout.mockResolvedValue({
      kind: "ready",
      clientSecret: "cs_secret_abc",
      publishableKey: "pk_test_abc123",
      summary: [
        {
          productName: "Classic Tee",
          color: "White",
          size: "L",
          quantity: 1,
          frontImageUrl: "https://img.example/front.png",
          backImageUrl: "https://img.example/back.png",
          colorHex: "#ffffff",
          mockupUrl: null,
        },
      ],
    });

    render(await renderCheckout({ session: VALID_SESSION }));

    expect(screen.getByText("Back design")).toBeInTheDocument();
  });
});
