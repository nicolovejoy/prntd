"use client";

import { useEffect, useState } from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout,
} from "@stripe/react-stripe-js";

export type EmbeddedCheckoutFormProps = {
  publishableKey: string;
  clientSecret: string;
};

/**
 * One `loadStripe()` promise per publishable key, cached at module level —
 * Stripe's own guidance, since calling `loadStripe` again re-injects
 * js.stripe.com. Created lazily, on the client only: the server has no
 * `window` for stripe-js to attach a script tag to, so a `typeof window`
 * guard keeps this from running during SSR, and the page's server render
 * always produces the same empty container.
 */
const stripePromises = new Map<string, Promise<Stripe | null>>();

function getStripePromise(key: string): Promise<Stripe | null> {
  let cached = stripePromises.get(key);
  if (!cached) {
    cached = loadStripe(key);
    stripePromises.set(key, cached);
  }
  return cached;
}

/**
 * Mounts Stripe's embedded payment form for an already-open checkout
 * session (#135 slice 2). A broken checkout SESSION (expired, wrong state)
 * is the `/checkout` page's job, resolved before this component ever
 * mounts — this only handles the loader script itself failing (network
 * blocked, a bad publishable key), which shows a plain retry instead of a
 * blank panel.
 */
export function EmbeddedCheckoutForm({
  publishableKey,
  clientSecret,
}: EmbeddedCheckoutFormProps) {
  const [stripePromise] = useState<Promise<Stripe | null> | null>(() =>
    typeof window === "undefined" ? null : getStripePromise(publishableKey)
  );
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (!stripePromise) return;
    let cancelled = false;
    stripePromise.then(
      (stripe) => {
        if (!cancelled && stripe === null) setLoadFailed(true);
      },
      () => {
        if (!cancelled) setLoadFailed(true);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [stripePromise]);

  if (loadFailed) {
    return (
      <div
        data-testid="embedded-checkout"
        className="border border-border p-6 text-center space-y-3"
      >
        <p className="text-sm text-text-muted">
          The payment form didn&apos;t load.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="min-h-11 px-4 border border-foreground text-sm text-foreground"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div data-testid="embedded-checkout">
      <EmbeddedCheckoutProvider
        stripe={stripePromise}
        options={{ clientSecret }}
      >
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  );
}
