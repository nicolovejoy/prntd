import Link from "next/link";
import { getOrderBySession } from "./actions";
import { Button } from "@/components/ui";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { breadcrumbTrail } from "@/lib/nav";
import { getColorHex } from "@/lib/blanks";
import { appErrorLogLine, shapeAppError } from "@/lib/app-error";
import { embeddedCheckoutFlag } from "@/lib/flags";
import {
  getCheckoutSessionState,
  resolveConfirmView,
  type ConfirmView,
} from "@/lib/checkout-session-status";

type Search = Promise<Record<string, string | string[] | undefined>>;

/**
 * The order row (and its stripeSessionId) is written before the customer is
 * redirected to Stripe, so by the time Stripe sends them back here the row
 * already exists — there is no race with the webhook to guard against, and
 * this page never renders a field the webhook writes (ruling P3). That is
 * what lets this be a plain awaited server read with no retry/poll island.
 * `/orders` hides young pending rows (src/lib/user-orders.ts,
 * `STALE_PENDING_MS`), so the "View orders" link below can briefly not show
 * an order that was just paid here.
 *
 * #135 slice 2: when `EMBEDDED_CHECKOUT_ENABLED` is on and the order is still
 * `pending` — the buyer bounced back here without finishing an open Embedded
 * Checkout, or their session expired — this page makes one extra Stripe read
 * (`getCheckoutSessionState`) to tell "still open, come back and finish"
 * apart from "expired, nothing was charged" and from a genuine webhook lag.
 * Flag off, or the order isn't `pending`, means zero Stripe calls — the page
 * stays the plain DB read it always was.
 */
export default async function ConfirmPage({ searchParams }: { searchParams: Search }) {
  const raw = (await searchParams).session_id;
  const sessionId = typeof raw === "string" && raw ? raw : null;

  let order = null;
  let loadFailed = false;
  if (sessionId) {
    try {
      order = await getOrderBySession(sessionId);
    } catch (err) {
      loadFailed = true;
      // Structured line so `vercel logs | grep app_error` finds this the same
      // way it finds instrumentation.ts's onRequestError captures — but we do
      // NOT write an app_error DB row here (shapeAppError only). The likeliest
      // cause of this catch firing is the database being unreachable, which
      // is exactly what a row write would need; a page render must not spend
      // a DB timeout trying to log to the DB that just failed.
      console.error(appErrorLogLine(shapeAppError(err, { path: "/order/confirm", method: "GET" })));
    }
  }

  if (loadFailed) {
    return (
      <div className="min-h-screen flex flex-col px-4">
        <Breadcrumbs
          trail={breadcrumbTrail("/order/confirm")}
          current="Confirmed"
          className="py-4"
        />
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="max-w-md w-full space-y-6 text-center">
            <h1 className="font-mono text-[13px] leading-5 tracking-[0.08em] uppercase">
              Order confirmed.
            </h1>
            <p className="text-text-muted">
              The receipt couldn&apos;t be loaded. Your payment went through. The order
              appears under Orders once it&apos;s confirmed.
            </p>
            <Link href="/orders">
              <Button size="lg" className="w-full">View orders</Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-text-muted">Order not found.</p>
          <Link
            href="/design"
            className="mt-4 min-h-11 inline-flex items-center justify-center text-sm underline underline-offset-[3px]"
          >
            Start a new design
          </Link>
        </div>
      </div>
    );
  }

  let view: ConfirmView = { kind: "confirmed" };
  if (sessionId && embeddedCheckoutFlag() && order.status === "pending") {
    const stripeState = await getCheckoutSessionState(sessionId);
    view = resolveConfirmView({
      orderStatus: order.status,
      stripe: stripeState,
      embeddedEnabled: embeddedCheckoutFlag(),
      sessionId,
    });
  }

  if (view.kind === "incomplete" || view.kind === "expired") {
    const heading =
      view.kind === "incomplete" ? "Payment not completed." : "This checkout expired.";
    return (
      <div className="min-h-screen flex flex-col px-4">
        <Breadcrumbs
          trail={breadcrumbTrail("/order/confirm")}
          current="Confirmed"
          className="py-4"
        />
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="max-w-md w-full space-y-6 text-center">
            <h1 className="font-mono text-[13px] leading-5 tracking-[0.08em] uppercase">
              {heading}
            </h1>
            <p className="text-text-muted">Nothing was charged.</p>
            <div className="flex flex-col gap-3">
              {view.kind === "incomplete" && view.resumeHref && (
                <Link href={view.resumeHref}>
                  <Button size="lg" className="w-full">
                    Return to checkout
                  </Button>
                </Link>
              )}
              <Link
                href="/shop"
                className="min-h-11 inline-flex items-center justify-center text-sm underline underline-offset-[3px]"
              >
                Back to Shop
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col px-4">
      <Breadcrumbs
        trail={breadcrumbTrail("/order/confirm")}
        current="Confirmed"
        className="py-4"
      />
      <div className="flex-1 flex flex-col items-center justify-center">
        <div className="max-w-md w-full space-y-6">
          <h1 className="font-mono text-[13px] leading-5 tracking-[0.08em] uppercase text-center">
            Order confirmed.
          </h1>

          <div className="border-t border-border text-sm">
            <div className="flex justify-between border-b border-border py-3">
              <span className="font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted">
                Order ID
              </span>
              <span className="font-mono">{order.id.slice(0, 8)}</span>
            </div>
            {order.lines.map((line, i) => (
              <div
                key={i}
                className="flex items-center justify-between gap-3 border-b border-border py-3"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {line.imageUrl && (
                    <div className="flex gap-1 flex-shrink-0">
                      <div className="flex flex-col items-center gap-0.5">
                        <div
                          className="w-12 h-12 border border-border p-1 overflow-hidden"
                          style={{ backgroundColor: getColorHex(line.blankId, line.color) }}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={line.imageUrl}
                            alt="Front design"
                            className="w-full h-full object-contain"
                          />
                        </div>
                        {line.backImageUrl && (
                          <span className="font-mono text-[10px] uppercase tracking-wide text-text-faint">
                            Front
                          </span>
                        )}
                      </div>
                      {line.backImageUrl && (
                        <div className="flex flex-col items-center gap-0.5">
                          <div
                            className="w-12 h-12 border border-border p-1 overflow-hidden"
                            style={{ backgroundColor: getColorHex(line.blankId, line.color) }}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={line.backImageUrl}
                              alt="Back design"
                              className="w-full h-full object-contain"
                            />
                          </div>
                          <span className="font-mono text-[10px] uppercase tracking-wide text-text-faint">
                            Back
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                  <span className="text-text-muted truncate">
                    {order.lines.length > 1 ? `Item ${i + 1}` : "Item"}
                  </span>
                </div>
                <span className="text-right text-sm">
                  {line.size} / {line.color}
                  {line.quantity > 1 && ` ×${line.quantity}`}
                </span>
              </div>
            ))}
            <div className="flex justify-between items-center py-3">
              <span className="font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted">
                Total paid
              </span>
              <span className="font-mono text-base font-medium">
                ${order.totalPrice.toFixed(2)}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <Link href="/orders">
              <Button size="lg" className="w-full">View orders</Button>
            </Link>
            <Link
              href="/design"
              className="min-h-11 inline-flex items-center justify-center text-sm underline underline-offset-[3px]"
            >
              Start another design
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
