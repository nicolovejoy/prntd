export type OrderStatus =
  | "pending"
  | "paid"
  | "submitted"
  | "shipped"
  | "delivered"
  | "canceled";

export const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ["paid"],
  paid: ["submitted"],
  submitted: ["shipped", "canceled"],
  shipped: ["delivered"],
  delivered: [],
  canceled: [],
};

export function canTransition(from: string, to: string): boolean {
  const allowed = VALID_TRANSITIONS[from as OrderStatus];
  if (!allowed) return false;
  return allowed.includes(to as OrderStatus);
}

export function assertTransition(from: string, to: string): void {
  if (!canTransition(from, to)) {
    throw new Error(
      `Invalid order transition: ${from} → ${to}`
    );
  }
}

/**
 * Whether an admin may archive this order. Anything already submitted to
 * Printful (an id or tracking exists) or past it (shipped/delivered) must stay
 * visible — archiving is for pre-fulfillment dead ends (abandoned pending,
 * canceled-before-submit, test noise).
 */
export function canArchiveOrder(order: {
  status: string;
  trackingNumber: string | null;
  printfulOrderId: string | null;
}): boolean {
  return !(
    order.status === "shipped" ||
    order.status === "delivered" ||
    Boolean(order.trackingNumber) ||
    Boolean(order.printfulOrderId)
  );
}
