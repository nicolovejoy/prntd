/**
 * Server-only data loader for `/checkout` (#135 slice 2). NOT a `"use
 * server"` action — a client secret is a bearer credential for finishing
 * someone's payment, and an action endpoint is callable directly from the
 * browser with arbitrary args, so this stays reachable only from the page's
 * own server-side render.
 *
 * `loadEmbeddedCheckout` resolves what `/checkout?session=<id>` should show
 * for a signed-in viewer, checking cheapest-first: DB ownership and status
 * before ever calling Stripe. `summary` (the review block) carries no money —
 * Stripe's own embedded form is the one source of truth for the total once a
 * promo code can be applied inside it.
 */
import { eq, asc, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  order as orderTable,
  orderItem as orderItemTable,
  design as designTable,
} from "@/lib/db/schema";
import { stripe } from "@/lib/stripe";
import { embeddedCheckoutPageConfig } from "@/lib/embedded-checkout";
import {
  STRIPE_SESSION_READ_TIMEOUT_MS,
  describeStripeError,
} from "@/lib/checkout-session-status";
import { resolveOrderLines, type OrderLine } from "@/lib/order-lines";
import { resolveOrderLineIdentities } from "@/lib/order-line-identity";
import { getBlank, getColorHex } from "@/lib/blanks";
import { mockupCacheKey } from "@/lib/mockup-cache";
import { withTimeout } from "@/lib/timeout";
import { lineHiddenArt } from "@/lib/line-hidden-art";

export type CheckoutLineSummary = {
  productName: string | null;
  color: string;
  size: string;
  quantity: number;
  frontImageUrl: string | null;
  backImageUrl: string | null;
  /** Shirt color hex, for the instant-layer fallback when no mockup is cached. */
  colorHex: string;
  /** Cached front-placement Printful mockup, or null when nothing is cached
   * for this exact (product, color, front image) yet — the review block
   * falls back to plain artwork rather than triggering a render. */
  mockupUrl: string | null;
};

export type EmbeddedCheckoutResult =
  | { kind: "not-found" }
  /** The buyer is done with Stripe: the order is no longer pending, or the
   * session is `complete` (paid, or a delayed payment still settling).
   * /checkout sends them to /order/confirm, which tells those apart. */
  | { kind: "complete" }
  | { kind: "expired" }
  | { kind: "hosted"; url: string }
  | { kind: "unavailable" }
  | {
      kind: "ready";
      clientSecret: string;
      publishableKey: string;
      summary: CheckoutLineSummary[];
    };

async function loadOrderLines(orderId: string): Promise<OrderLine[]> {
  const items = await db
    .select({
      designId: orderItemTable.designId,
      productId: orderItemTable.productId,
      size: orderItemTable.size,
      color: orderItemTable.color,
      quantity: orderItemTable.quantity,
      placements: orderItemTable.placements,
      itemPrice: orderItemTable.itemPrice,
      printfulCost: orderItemTable.printfulCost,
    })
    .from(orderItemTable)
    .where(eq(orderItemTable.orderId, orderId))
    .orderBy(asc(orderItemTable.createdAt));

  return resolveOrderLines(items);
}

async function loadCheckoutSummary(
  lines: OrderLine[]
): Promise<CheckoutLineSummary[]> {
  const identities = await resolveOrderLineIdentities(
    db,
    lines.map((l) => ({ designId: l.designId, placements: l.placements }))
  );

  const designIds = [...new Set(lines.map((l) => l.designId))];
  const designRows = designIds.length
    ? await db
        .select({
          id: designTable.id,
          mockupUrls: designTable.mockupUrls,
          primaryImageId: designTable.primaryImageId,
        })
        .from(designTable)
        .where(inArray(designTable.id, designIds))
    : [];
  const designById = new Map(designRows.map((d) => [d.id, d]));

  return lines.map((line, i) => {
    const frontImageId = line.placements.front ?? null;
    const colorHex = getColorHex(line.blankId, line.color);
    const design = designById.get(line.designId);
    const cachedMockups = design?.mockupUrls ?? {};
    const keyParts = {
      productId: line.blankId,
      placementId: "front",
      colorName: line.color,
      scaleKey: 100,
    };
    // The image detail page and a pinned front cache under a key that carries
    // the source image id. /preview and the mockup prefetch cache the default
    // front, the design's primary image, under a key with no source segment.
    // That entry is this line's artwork only when the line's front is the
    // design's current primary image; for any other front it may show
    // different artwork, so it is not used.
    const sourceKeyed = frontImageId
      ? cachedMockups[
          mockupCacheKey({ ...keyParts, sourceImageId: frontImageId })
        ]
      : undefined;
    const sourceLess =
      frontImageId && frontImageId === design?.primaryImageId
        ? cachedMockups[mockupCacheKey(keyParts)]
        : undefined;
    return {
      productName: getBlank(line.blankId)?.name ?? null,
      color: line.color,
      size: line.size,
      quantity: line.quantity,
      frontImageUrl: identities[i].imageUrl,
      backImageUrl: identities[i].backImageUrl,
      colorHex,
      mockupUrl: sourceKeyed ?? sourceLess ?? null,
    };
  });
}

/**
 * Order of checks (cheapest first, and no Stripe call unless the DB already
 * agrees the session might still be open): ownership → status/abandoned →
 * key config → `stripe.checkout.sessions.retrieve` → session status →
 * hidden artwork → ui_mode.
 *
 * The hidden-artwork check (#310 item 7) returns `expired` when any line shows
 * artwork an admin has since hidden. It runs after Stripe says the session is
 * `open` because the expired screen says "Nothing was charged.", which is only
 * known once the session is open: a `complete` session must still return
 * `complete`, so a buyer who paid reaches /order/confirm, hidden or not. It
 * runs before the ui_mode branch so a hidden line is not sent to Stripe's
 * hosted page either. The order row stays `pending` and the Stripe session is
 * not expired; a buyer who already has the payment form open can still pay.
 */
export async function loadEmbeddedCheckout(params: {
  sessionId: string;
  viewerId: string;
}): Promise<EmbeddedCheckoutResult> {
  const found = await db.query.order.findFirst({
    where: eq(orderTable.stripeSessionId, params.sessionId),
  });
  if (!found || found.userId !== params.viewerId) {
    return { kind: "not-found" };
  }

  if (found.status !== "pending") {
    return { kind: "complete" };
  }
  // Known mismatch: an order abandoned by a failed delayed payment (session
  // `complete`, `abandoned_at` set) also lands here, so /checkout says "This
  // checkout expired. Nothing was charged." where /order/confirm says the
  // payment failed. Telling them apart needs a Stripe read or a new column,
  // and this check deliberately runs before any Stripe call.
  if (found.abandonedAt) {
    return { kind: "expired" };
  }

  const config = embeddedCheckoutPageConfig();
  if (!config.enabled) {
    return { kind: "unavailable" };
  }

  let session;
  try {
    session = await withTimeout(
      "loadEmbeddedCheckout",
      STRIPE_SESSION_READ_TIMEOUT_MS,
      () => stripe.checkout.sessions.retrieve(params.sessionId)
    );
  } catch (err) {
    console.error(`loadEmbeddedCheckout failed: ${describeStripeError(err)}`);
    return { kind: "unavailable" };
  }

  if (session.status === "complete") return { kind: "complete" };
  if (session.status === "expired") return { kind: "expired" };
  if (session.status !== "open") return { kind: "unavailable" };

  const lines = await loadOrderLines(found.id);
  const hiddenArt = await Promise.all(
    lines.map((l) =>
      lineHiddenArt({ designId: l.designId, placements: l.placements })
    )
  );
  if (hiddenArt.some((a) => a.front || a.back)) return { kind: "expired" };

  if (session.ui_mode !== "embedded") {
    if (session.url) return { kind: "hosted", url: session.url };
    return { kind: "unavailable" };
  }

  if (!session.client_secret) return { kind: "unavailable" };

  const summary = await loadCheckoutSummary(lines);
  return {
    kind: "ready",
    clientSecret: session.client_secret,
    publishableKey: config.publishableKey,
    summary,
  };
}
