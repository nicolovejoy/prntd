"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout,
} from "@stripe/react-stripe-js";

export type EmbeddedCheckoutFormProps = {
  publishableKey: string;
  clientSecret: string;
  /** Where the page's own "← Back" link points — an embedded session has no
   * hosted Stripe URL to fall back to, so both failure notices offer this as
   * a way out alongside Reload. */
  backHref: string;
};

/**
 * How long to wait, after mount, for Stripe's iframe to appear inside the
 * container before showing the stall notice. `EmbeddedCheckoutProvider`
 * doesn't surface a rejection from `initEmbeddedCheckout` (e.g. a
 * publishable key from a different Stripe account than the secret key), so
 * this is the only signal that the form never mounted.
 */
export const FORM_MOUNT_TIMEOUT_MS = 15000;

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
 * mounts. This component handles two separate failure shapes on top of
 * that: the loader script itself failing (network blocked, a bad
 * publishable key) shows a plain retry in place of the whole form; and the
 * loader succeeding but the iframe never appearing (e.g. a publishable key
 * from a different Stripe account than the secret key — the mismatch
 * `EmbeddedCheckoutProvider` doesn't surface as a rejection) shows a stall
 * notice under the still-mounted form, since a slow network may yet
 * deliver the iframe. Both failure notices also offer `backHref` alongside
 * Reload — an embedded session has no hosted Stripe URL to bounce a stuck
 * buyer to, so leaving the page is otherwise a dead end.
 */
export function EmbeddedCheckoutForm({
  publishableKey,
  clientSecret,
  backHref,
}: EmbeddedCheckoutFormProps) {
  const [stripePromise] = useState<Promise<Stripe | null> | null>(() =>
    typeof window === "undefined" ? null : getStripePromise(publishableKey)
  );
  const [loadFailed, setLoadFailed] = useState(false);
  const [mountStalled, setMountStalled] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!stripePromise) return;
    const timer = setTimeout(() => {
      const hasIframe = containerRef.current?.querySelector("iframe");
      if (!hasIframe) setMountStalled(true);
    }, FORM_MOUNT_TIMEOUT_MS);

    // Once the stall notice is showing, it needs a way to go away again: a
    // slow iframe can still arrive after the 15s watchdog fires. Started
    // alongside the watchdog (not just after it fires) so a late-arriving
    // iframe clears the notice as soon as it appears, whether that's before
    // or after the timeout — which also makes the timeout itself moot for a
    // form that does eventually mount.
    const container = containerRef.current;
    let observer: MutationObserver | null = null;
    if (container) {
      observer = new MutationObserver(() => {
        if (container.querySelector("iframe")) setMountStalled(false);
      });
      observer.observe(container, { childList: true, subtree: true });
    }

    return () => {
      clearTimeout(timer);
      observer?.disconnect();
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
        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="min-h-11 px-4 border border-foreground text-sm text-foreground"
          >
            Try again
          </button>
          <Link
            href={backHref}
            className="inline-flex min-h-11 items-center text-sm underline underline-offset-[3px]"
          >
            ← Back
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div data-testid="embedded-checkout" ref={containerRef}>
        <EmbeddedCheckoutProvider
          stripe={stripePromise}
          options={{ clientSecret }}
        >
          <EmbeddedCheckout />
        </EmbeddedCheckoutProvider>
      </div>
      {mountStalled && (
        <div className="mt-3 text-center space-y-2">
          <p className="text-sm text-text-muted">
            The payment form is taking a while.
          </p>
          <div className="flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="min-h-11 px-4 border border-foreground text-sm text-foreground"
            >
              Reload
            </button>
            <Link
              href={backHref}
              className="inline-flex min-h-11 items-center text-sm underline underline-offset-[3px]"
            >
              ← Back
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
