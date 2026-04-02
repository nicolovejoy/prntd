import { ledgerEntry } from "@/lib/db/schema";

const STRIPE_FEE_RATE = 0.029;
const STRIPE_FEE_FIXED = 0.30;

type DbInstance = {
  insert: (...args: any[]) => any;
  query: { ledgerEntry: { findMany: (...args: any[]) => any } };
};

export function calculateStripeFee(amount: number): number {
  return Math.round((amount * STRIPE_FEE_RATE + STRIPE_FEE_FIXED) * 100) / 100;
}

export async function recordSale(
  orderId: string,
  amount: number,
  description: string,
  db: DbInstance
) {
  const stripeFee = calculateStripeFee(amount);

  await db.insert(ledgerEntry).values([
    {
      orderId,
      type: "sale",
      amount,
      description,
      metadata: { gross: amount, stripeFee },
    },
    {
      orderId,
      type: "stripe_fee",
      amount: -stripeFee,
      description: `Stripe processing fee (2.9% + $0.30)`,
      metadata: { rate: STRIPE_FEE_RATE, fixed: STRIPE_FEE_FIXED },
    },
  ]);
}

export async function recordCOGS(
  orderId: string,
  printfulCost: number,
  description: string,
  db: DbInstance
) {
  await db.insert(ledgerEntry).values({
    orderId,
    type: "cogs",
    amount: -printfulCost,
    description,
  });
}

export async function recordCancellation(
  orderId: string,
  originalAmount: number,
  description: string,
  db: DbInstance
) {
  await db.insert(ledgerEntry).values({
    orderId,
    type: "refund",
    amount: -originalAmount,
    description,
    metadata: { note: "Order canceled before fulfillment, refund pending" },
  });
}
