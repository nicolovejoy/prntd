/**
 * EmbeddedCheckoutForm mounts Stripe's client-side loader — @stripe/stripe-js
 * and @stripe/react-stripe-js are mocked so this only exercises our wiring
 * (the client secret reaching the provider, and the failure fallback), not
 * Stripe's actual iframe.
 *
 * Each test uses a distinct publishableKey: the component caches one
 * loadStripe() promise per key at module scope (intentionally, so a re-mount
 * doesn't re-inject js.stripe.com), which would otherwise let one test's
 * cached promise leak into the next.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmbeddedCheckoutForm } from "../embedded-checkout-form";

const h = vi.hoisted(() => ({
  loadStripe: vi.fn(),
}));

vi.mock("@stripe/stripe-js", () => ({
  loadStripe: (...args: unknown[]) => h.loadStripe(...args),
}));

vi.mock("@stripe/react-stripe-js", () => ({
  EmbeddedCheckoutProvider: (props: {
    options: { clientSecret: string };
    children: React.ReactNode;
  }) => (
    <div data-testid="provider-mock" data-secret={props.options.clientSecret}>
      {props.children}
    </div>
  ),
  EmbeddedCheckout: () => <div data-testid="embedded-checkout-mock" />,
}));

beforeEach(() => {
  h.loadStripe.mockReset();
});

describe("EmbeddedCheckoutForm", () => {
  it("mounts the provider with the given client secret once Stripe loads", async () => {
    h.loadStripe.mockResolvedValue({ fakeStripeInstance: true });

    render(
      <EmbeddedCheckoutForm
        publishableKey="pk_test_success_1"
        clientSecret="cs_secret_1"
      />
    );

    const provider = await screen.findByTestId("provider-mock");
    expect(provider).toHaveAttribute("data-secret", "cs_secret_1");
    expect(screen.getByTestId("embedded-checkout-mock")).toBeInTheDocument();
  });

  it("shows a retry when the Stripe.js loader rejects", async () => {
    h.loadStripe.mockRejectedValue(new Error("network blocked"));

    render(
      <EmbeddedCheckoutForm
        publishableKey="pk_test_reject_1"
        clientSecret="cs_secret_2"
      />
    );

    expect(
      await screen.findByText("The payment form didn't load.")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Try again" })
    ).toBeInTheDocument();
    expect(screen.queryByTestId("provider-mock")).not.toBeInTheDocument();
  });

  it("shows a retry when the Stripe.js loader resolves null", async () => {
    h.loadStripe.mockResolvedValue(null);

    render(
      <EmbeddedCheckoutForm
        publishableKey="pk_test_null_1"
        clientSecret="cs_secret_3"
      />
    );

    expect(
      await screen.findByText("The payment form didn't load.")
    ).toBeInTheDocument();
  });

  it("Try again reloads the page", async () => {
    h.loadStripe.mockRejectedValue(new Error("network blocked"));
    const reload = vi.fn();
    delete (window as unknown as { location?: unknown }).location;
    (window as unknown as { location: { reload: () => void } }).location = {
      reload,
    };

    render(
      <EmbeddedCheckoutForm
        publishableKey="pk_test_reload_1"
        clientSecret="cs_secret_4"
      />
    );

    const button = await screen.findByRole("button", { name: "Try again" });
    button.click();

    expect(reload).toHaveBeenCalledTimes(1);
  });
});
