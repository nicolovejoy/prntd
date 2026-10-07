// Not a "use server" module on purpose (#251). createStripeCheckoutForOrder
// trusts every input (userId, itemPrice, placements, store attribution), so
// exporting it from a "use server" file would make it a publicly callable
// Server Action. Callers own auth, pricing and image guards.
import { db } from "@/lib/db";
import { order as orderTable, orderItem as orderItemTable } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { stripe } from "@/lib/stripe";
import { computeOrderTotal } from "@/lib/pricing";
import { buildCheckoutSessionParams } from "@/lib/checkout";
import { embeddedCheckoutPath } from "@/lib/embedded-checkout";
import { resolveOrderVariant } from "@/lib/blanks";

/**
 * Marks a checkout that never got a Stripe session as abandoned (#289). The
 * order and its lines are inserted before Stripe is called, so a Stripe error
 * would otherwise leave a `pending` order with no session id behind. This sets
 * the same `abandoned_at` that `checkout.session.expired` sets; the rows stay,
 * so a webhook for a session that was paid anyway can still claim the order.
 *
 * Conditional like `handleStripeCheckoutExpired`: only a still-pending,
 * not-yet-abandoned order with no session id is touched. Never throws: it
 * runs inside a catch block, and a failure here must not replace the Stripe
 * error the caller is about to re-throw.
 */
export async function abandonSessionlessOrder(orderId: string): Promise<void> {
  try {
    await db
      .update(orderTable)
      .set({ abandonedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(orderTable.id, orderId),
          eq(orderTable.status, "pending"),
          isNull(orderTable.abandonedAt),
          isNull(orderTable.stripeSessionId)
        )
      );
  } catch (err) {
    console.error(
      `Order ${orderId}: could not mark abandoned after a Stripe error (non-fatal):`,
      err instanceof Error ? err.message : String(err)
    );
  }
}

/**
 * Shared order-creation + Stripe-checkout step for the single-item purchase
 * flows: design-your-own (`createCheckoutSession`, order/actions.ts) and
 * buy-existing (`buyPublishedDesign`, d/actions.ts). The cart builds its own session in `checkoutCart`. Inserts the order row,
 * creates the Stripe session with `buildCheckoutSessionParams`, persists
 * the session id, and returns the redirect URL. Callers own auth, pricing, image-pinning
 * and the cancel URL; this owns the parts that would otherwise drift. If
 * creating the Stripe session throws (including building its params), the
 * order is marked abandoned (`abandonSessionlessOrder`) and the error is
 * re-thrown unchanged.
 */
export async function createStripeCheckoutForOrder(params: {
  userId: string;
  designId: string;
  productId: string;
  size: string;
  color: string;
  /** Product price (computePrice total). Shipping is added here. */
  itemPrice: number;
  /** placement id → source design_image id. `front` is the pinned primary;
   * `back` (#25) is present only for multi-placement orders. */
  placements: Record<string, string> | null;
  checkoutImageUrl: string | null;
  cancelUrl: string;
  /** Composition attribution: the `product` row bought — the published
   * image's Shop composition. Null for design-your-own. See the schema
   * comment on `order`. */
  storeProductId?: string | null;
  /** Present only when the caller has resolved its embedded config
   * (`embeddedCheckoutConfig()` for the image detail page,
   * `previewEmbeddedCheckoutConfig()` for /preview) to enabled (#135 slices
   * 2-3): the session mounts on our own /checkout page
   * instead of Stripe's hosted page. `backPath` is where /checkout's back
   * link goes; `cancelUrl` above is ignored in this mode (buildCheckoutSessionParams
   * doesn't take a cancel_url for an embedded session). `returnOrigin` is the
   * origin Stripe's `return_url` is built from — the caller resolves it via
   * `resolveReturnOrigin` so a preview deployment's session returns to that
   * same preview instead of always landing on `NEXT_PUBLIC_APP_URL`; hosted
   * checkout keeps using `NEXT_PUBLIC_APP_URL` unconditionally, since the
   * buyer already leaves our origin in that mode. */
  embedded?: { backPath: string; returnOrigin: string };
}): Promise<{ url: string | null }> {
  // Validate product/size/color before taking money — rejects an
  // unknown/discontinued product or a combo with no fulfillable variant.
  const { product } = resolveOrderVariant({
    productId: params.productId,
    size: params.size,
    color: params.color,
  });
  const productName = product.name;

  // Split the charge: product (the line item promos discount) + shipping
  // (a separate Stripe line, excluded from % promos). Persist both plus the
  // grand total; the webhook later reconciles totalPrice to the actual amount
  // charged (after any discount) from Stripe.
  const { item, shipping, total } = computeOrderTotal(params.itemPrice);

  // Phase 1b/1c: the order_item row is the only record of what was bought —
  // the header carries order-level money and linkage only. Order + item commit
  // together; the id is pre-generated so both inserts build before the batch
  // (the checkoutCart pattern). Single line, quantity 1; itemPrice is the
  // product line (shipping is order-level, not per item).
  const orderId = crypto.randomUUID();
  await db.batch([
    db.insert(orderTable).values({
      id: orderId,
      userId: params.userId,
      designId: params.designId,
      totalPrice: total,
      itemPrice: item,
      shippingPrice: shipping,
      storeProductId: params.storeProductId ?? null,
    }),
    db.insert(orderItemTable).values({
      orderId,
      designId: params.designId,
      productId: params.productId,
      size: params.size,
      color: params.color,
      placements: params.placements,
      quantity: 1,
      itemPrice: item,
    }),
  ]);

  let checkoutSession: Awaited<ReturnType<typeof stripe.checkout.sessions.create>>;
  try {
    checkoutSession = await stripe.checkout.sessions.create(
      buildCheckoutSessionParams({
        orderId,
        designId: params.designId,
        productName,
        color: params.color,
        size: params.size,
        itemPrice: item,
        shippingPrice: shipping,
        imageUrl: params.checkoutImageUrl,
        cancelUrl: params.cancelUrl,
        appUrl: params.embedded
          ? params.embedded.returnOrigin
          : process.env.NEXT_PUBLIC_APP_URL!,
        uiMode: params.embedded ? "embedded" : "hosted",
      })
    );
  } catch (err) {
    await abandonSessionlessOrder(orderId);
    throw err;
  }

  await db
    .update(orderTable)
    .set({ stripeSessionId: checkoutSession.id })
    .where(eq(orderTable.id, orderId));

  if (params.embedded) {
    return {
      url: embeddedCheckoutPath(checkoutSession.id, params.embedded.backPath),
    };
  }

  return { url: checkoutSession.url };
}
