import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth, isAnonymousUser } from "@/lib/auth";
import { embeddedCheckoutFlag } from "@/lib/flags";
import { embeddedCheckoutPath, safeCheckoutReturnPath } from "@/lib/embedded-checkout";
import {
  loadEmbeddedCheckout,
  type CheckoutLineSummary,
} from "@/lib/embedded-checkout-session";
import { mockupBackdrop } from "@/lib/instant-preview";
import { EmbeddedCheckoutForm } from "./embedded-checkout-form";

export const metadata: Metadata = {
  title: "Checkout",
  robots: { index: false },
};

type Search = Promise<Record<string, string | string[] | undefined>>;

// Stripe's own Checkout Session id shape — same test/live split as the
// publishable/secret key prefixes this page's config depends on.
const SESSION_ID_RE = /^cs_(test|live)_[A-Za-z0-9]+$/;

/**
 * Stripe Embedded Checkout, mounted on our own origin (#135 slice 2). Never
 * renders a price of its own — Stripe's embedded form is the one place that
 * shows line items, shipping and the total, since a promo code applied
 * inside it would make a number of ours go stale instantly.
 */
export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Search;
}) {
  // Await searchParams BEFORE the flag check. Reading searchParams is the
  // request-time API that opts this page out of static prerendering (see
  // node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md).
  // If the flag check ran first, `next build` with the flag off would never
  // reach this await, and Next would prerender a static 404 for /checkout —
  // one a later runtime flag flip (or `next start` after a flag-off build)
  // could never un-404, since a static page ignores request-time env reads.
  const params = await searchParams;

  if (!embeddedCheckoutFlag()) notFound();
  const rawSession = params.session;
  const sessionId = typeof rawSession === "string" ? rawSession : null;
  if (!sessionId || !SESSION_ID_RE.test(sessionId)) notFound();

  const rawFrom = params.from;
  const from = typeof rawFrom === "string" ? rawFrom : undefined;
  const backHref = safeCheckoutReturnPath(from);
  // The current /checkout URL, re-derived through the same safe-path builder
  // that created it — used both for the sign-in round trip and for "Try
  // again", so neither can be pointed anywhere `from` wasn't already allowed
  // to point.
  const selfHref = embeddedCheckoutPath(sessionId, from ?? "");

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || isAnonymousUser(session.user)) {
    redirect(`/sign-in?next=${encodeURIComponent(selfHref)}`);
  }

  const result = await loadEmbeddedCheckout({
    sessionId,
    viewerId: session.user.id,
  });

  if (result.kind === "not-found") notFound();
  if (result.kind === "paid") {
    redirect(`/order/confirm?session_id=${encodeURIComponent(sessionId)}`);
  }
  if (result.kind === "hosted") redirect(result.url);

  if (result.kind === "expired") {
    return (
      <StatusScreen
        heading="This checkout expired."
        body="Nothing was charged."
        backHref={backHref}
      />
    );
  }

  if (result.kind === "unavailable") {
    // Deliberately doesn't say nothing was charged: a Stripe error means we
    // don't know the session's state — it may have completed with the
    // webhook still in flight.
    return (
      <StatusScreen
        heading="Checkout isn't available right now."
        body="Try again in a moment."
        backHref={backHref}
        retryHref={selfHref}
      />
    );
  }

  return (
    <div className="min-h-screen flex flex-col px-4">
      <div className="max-w-3xl w-full mx-auto py-6 md:py-10 space-y-6">
        <Link
          href={backHref}
          className="inline-flex min-h-11 items-center text-sm underline underline-offset-[3px]"
        >
          ← Back
        </Link>

        <div className="grid gap-8 md:grid-cols-2">
          <ReviewBlock summary={result.summary} />
          <EmbeddedCheckoutForm
            publishableKey={result.publishableKey}
            clientSecret={result.clientSecret}
            backHref={backHref}
          />
        </div>
      </div>
    </div>
  );
}

function StatusScreen({
  heading,
  body,
  backHref,
  retryHref,
}: {
  heading: string;
  body: string;
  backHref: string;
  retryHref?: string;
}) {
  return (
    <div className="min-h-screen flex flex-col px-4">
      <div className="flex-1 flex flex-col items-center justify-center">
        <div className="max-w-md w-full space-y-6 text-center">
          <h1 className="font-mono text-[13px] leading-5 tracking-[0.08em] uppercase">
            {heading}
          </h1>
          <p className="text-text-muted">{body}</p>
          <div className="flex flex-col gap-3">
            {retryHref && (
              <Link
                href={retryHref}
                className="min-h-11 inline-flex items-center justify-center border border-foreground text-sm"
              >
                Try again
              </Link>
            )}
            <Link
              href={backHref}
              className="min-h-11 inline-flex items-center justify-center text-sm underline underline-offset-[3px]"
            >
              ← Back
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The review block: what's about to be paid for, no prices. Mockup when one
 * is already cached for this exact (product, color, front image) — the same
 * cache `getListingMockup`/`/preview` write to — else the artwork centered on
 * a flat panel of the shirt color, so the box is never empty even before any
 * mockup has ever been rendered for this combination.
 */
function ReviewBlock({ summary }: { summary: CheckoutLineSummary[] }) {
  return (
    <div className="space-y-4">
      {summary.map((line, i) => (
        <div key={i} className="border-t border-border pt-4 space-y-2">
          <div className="flex items-center gap-3 md:flex-col md:items-stretch md:gap-2">
            <div
              data-testid="checkout-preview"
              className="relative w-24 h-24 md:w-full md:h-auto md:aspect-square border border-border overflow-hidden flex-shrink-0"
              style={{ backgroundColor: line.colorHex }}
            >
              {line.mockupUrl ? (
                <div
                  className="absolute inset-0"
                  style={{ backgroundColor: mockupBackdrop(line.colorHex) }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={line.mockupUrl}
                    alt=""
                    className="w-full h-full object-contain mix-blend-multiply"
                  />
                </div>
              ) : (
                line.frontImageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={line.frontImageUrl}
                    alt=""
                    className="absolute inset-0 w-full h-full object-contain p-1.5"
                  />
                )
              )}
            </div>
            <div className="min-w-0">
              <p className="text-sm">
                {line.productName ?? "Shirt"}
                {line.quantity > 1 && ` ×${line.quantity}`}
              </p>
              <p className="font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted">
                {line.color} / {line.size}
              </p>
            </div>
          </div>

          {line.backImageUrl && (
            <div className="flex items-center gap-2 pl-1">
              <div
                className="w-10 h-10 border border-border overflow-hidden flex-shrink-0"
                style={{ backgroundColor: line.colorHex }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={line.backImageUrl}
                  alt=""
                  className="w-full h-full object-contain p-1"
                />
              </div>
              <span className="font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted">
                Back design
              </span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
