import { eq } from "drizzle-orm";
import { order as orderTable, user as userTable, design as designTable } from "@/lib/db/schema";
import type { db as appDb } from "@/lib/db";
import type { sendOrderConfirmation, sendOwnerOrderAlert } from "@/lib/email";
import { getProduct, getColorHex } from "@/lib/products";
import { resolveOrderEmailImages, type EmailImage } from "@/lib/email-images";

export type OrderEmailPayload = {
  email: string;
  size: string;
  color: string;
  totalPrice: number;
  productId: string;
  productName: string;
  discountCode: string | null;
  displayName: string | null;
  images: EmailImage[];
};

export type OrderEmailDeps = {
  loadOrderForEmail: (orderId: string) => Promise<OrderEmailPayload | null>;
  sendOrderConfirmation: typeof sendOrderConfirmation;
  sendOwnerOrderAlert: typeof sendOwnerOrderAlert;
};

/**
 * Resolve the hero image(s) for an order's emails: the cached Printful mockup
 * when available, else the design artwork on a shirt-color backdrop. Back image
 * only when the order pinned a `back` placement (#25). Shared by the order
 * confirmation/owner alert path and the shipping notification.
 */
export async function resolveHeroImages(row: {
  productId: string;
  color: string;
  designId: string;
  placements: Record<string, string> | null;
  mockupUrls: Record<string, string> | null;
}): Promise<EmailImage[]> {
  // Lazy import: @/lib/design-images instantiates the libSQL client at module
  // load. Keeping it out of the top level lets sendPostOrderEmails (and its
  // tests) import this module without a live DATABASE_URL.
  const { getDesignDisplayImageUrl, getDesignImageById } = await import("@/lib/design-images");
  const backSourceId = row.placements?.back ?? null;
  const [frontArtworkUrl, backArtworkUrl] = await Promise.all([
    getDesignDisplayImageUrl(row.designId),
    backSourceId ? getDesignImageById(backSourceId).then((i) => i?.imageUrl ?? null) : Promise.resolve(null),
  ]);
  return resolveOrderEmailImages({
    productId: row.productId,
    color: row.color,
    placements: row.placements,
    mockupUrls: row.mockupUrls,
    frontArtworkUrl,
    backArtworkUrl,
    backdropHex: getColorHex(row.productId, row.color),
  });
}

/**
 * Send post-order emails (customer confirmation + owner alert) for a freshly
 * paid order. Fire-and-forget: errors are logged but never thrown so callers
 * (webhook handler, recover action) don't fail the request because Resend hiccupped.
 */
export async function sendPostOrderEmails(
  orderId: string,
  deps: OrderEmailDeps
): Promise<void> {
  let payload: OrderEmailPayload | null;
  try {
    payload = await deps.loadOrderForEmail(orderId);
  } catch (err) {
    console.error(`sendPostOrderEmails: lookup failed for order ${orderId}:`, err);
    return;
  }

  if (!payload) {
    console.warn(`sendPostOrderEmails: order ${orderId} not found, skipping`);
    return;
  }

  try {
    await deps.sendOrderConfirmation({
      to: payload.email,
      orderId,
      size: payload.size,
      color: payload.color,
      total: payload.totalPrice,
      productName: payload.productName,
      displayName: payload.displayName,
      images: payload.images,
    });
    console.log(`Order ${orderId}: confirmation email sent to ${payload.email}`);
  } catch (err) {
    console.error(`sendPostOrderEmails: confirmation failed for ${orderId}:`, err);
  }

  try {
    await deps.sendOwnerOrderAlert({
      orderId,
      customerEmail: payload.email,
      size: payload.size,
      color: payload.color,
      total: payload.totalPrice,
      discountCode: payload.discountCode,
      displayName: payload.displayName,
      images: payload.images,
    });
  } catch (err) {
    console.error(`sendPostOrderEmails: owner alert failed for ${orderId}:`, err);
  }
}

/**
 * Default loader that reads the order joined with the user from the production DB.
 * Used by both the Stripe webhook route and the admin recover action.
 *
 * Email senders are passed in by the caller (not imported here) so this module
 * stays test-friendly — importing @/lib/email instantiates Resend at module load.
 */
export function createDefaultOrderEmailDeps(
  db: typeof appDb,
  senders: Pick<OrderEmailDeps, "sendOrderConfirmation" | "sendOwnerOrderAlert">
): OrderEmailDeps {
  return {
    loadOrderForEmail: async (orderId) => {
      const rows = await db
        .select({
          email: userTable.email,
          size: orderTable.size,
          color: orderTable.color,
          totalPrice: orderTable.totalPrice,
          productId: orderTable.productId,
          discountCode: orderTable.discountCode,
          displayName: orderTable.displayName,
          designId: orderTable.designId,
          placements: orderTable.placements,
          mockupUrls: designTable.mockupUrls,
        })
        .from(orderTable)
        .innerJoin(userTable, eq(orderTable.userId, userTable.id))
        .leftJoin(designTable, eq(orderTable.designId, designTable.id))
        .where(eq(orderTable.id, orderId));
      const row = rows[0];
      if (!row) return null;
      // Resolve product name from the catalog. Falls back to a generic
      // "product" label if a historical order references an id we no
      // longer carry — emails should never break on a missing product.
      const product = getProduct(row.productId);
      const images = await resolveHeroImages({
        productId: row.productId,
        color: row.color,
        designId: row.designId,
        placements: row.placements ?? null,
        mockupUrls: row.mockupUrls ?? null,
      });

      return {
        ...row,
        productName: product?.name ?? "product",
        images,
      };
    },
    sendOrderConfirmation: senders.sendOrderConfirmation,
    sendOwnerOrderAlert: senders.sendOwnerOrderAlert,
  };
}
