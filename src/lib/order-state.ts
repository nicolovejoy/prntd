export type OrderStatus =
  | "pending"
  | "paid"
  | "submitted"
  | "shipped"
  | "delivered";

export const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ["paid"],
  paid: ["submitted"],
  submitted: ["shipped"],
  shipped: ["delivered"],
  delivered: [],
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
