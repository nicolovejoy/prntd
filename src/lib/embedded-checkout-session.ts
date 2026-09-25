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
import { embeddedCheckoutConfig } from "@/lib/embedded-checkout";
import {
  STRIPE_SESSION_READ_TIMEOUT_MS,
  describeStripeError,
} from "@/lib/checkout-session-status";
import { resolveOrderLines } from "@/lib/order-lines";
import { resolveOrderLineIdentities } from "@/lib/order-line-identity";
import { getBlank, getColorHex } from "@/lib/blanks";
import { mockupCacheKey } from "@/lib/mockup-cache";
import { withTimeout } from "@/lib/timeout";

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
  | { kind: "paid" }
  | { kind: "expired" }
  | { kind: "hosted"; url: string }
  | { kind: "unavailable" }
  | {
      kind: "ready";
      clientSecret: string;
      publishableKey: string;
      summary: CheckoutLineSummary[];
    };

async function loadCheckoutSummary(
  orderId: string
): Promise<CheckoutLineSummary[]> {
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

  const lines = resolveOrderLines(items);
  const identities = await resolveOrderLineIdentities(
    db,
    lines.map((l) => ({ designId: l.designId, placements: l.placements }))
  );

  const designIds = [...new Set(lines.map((l) => l.designId))];
  const designRows = designIds.length
    ? await db
        .select({ id: designTable.id, mockupUrls: designTable.mockupUrls })
        .from(designTable)
        .where(inArray(designTable.id, designIds))
    : [];
  const mockupUrlsByDesignId = new Map(
    designRows.map((d) => [d.id, d.mockupUrls ?? {}])
  );

  return lines.map((line, i) => {
    const frontImageId = line.placements.front ?? null;
    const colorHex = getColorHex(line.blankId, line.color);
    const cachedMockups = mockupUrlsByDesignId.get(line.designId) ?? {};
    const cacheKey = frontImageId
      ? mockupCacheKey({
          productId: line.blankId,
          placementId: "front",
          sourceImageId: frontImageId,
          colorName: line.color,
          scaleKey: 100,
        })
      : null;
    return {
      productName: getBlank(line.blankId)?.name ?? null,
      color: line.color,
      size: line.size,
      quantity: line.quantity,
      frontImageUrl: identities[i].imageUrl,
      backImageUrl: identities[i].backImageUrl,
      colorHex,
      mockupUrl: cacheKey ? cachedMockups[cacheKey] ?? null : null,
    };
  });
}

/**
 * Order of checks (cheapest first, and no Stripe call unless the DB already
 * agrees the session might still be open): ownership → status/abandoned →
 * key config → `stripe.checkout.sessions.retrieve` → session status/ui_mode.
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
    return { kind: "paid" };
  }
  if (found.abandonedAt) {
    return { kind: "expired" };
  }

  const config = embeddedCheckoutConfig();
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

  if (session.status === "complete") return { kind: "paid" };
  if (session.status === "expired") return { kind: "expired" };
  if (session.status !== "open") return { kind: "unavailable" };

  if (session.ui_mode !== "embedded") {
    if (session.url) return { kind: "hosted", url: session.url };
    return { kind: "unavailable" };
  }

  if (!session.client_secret) return { kind: "unavailable" };

  const summary = await loadCheckoutSummary(found.id);
  return {
    kind: "ready",
    clientSecret: session.client_secret,
    publishableKey: config.publishableKey,
    summary,
  };
}
