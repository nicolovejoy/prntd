export const ORDER_CLASSIFICATIONS = [
  "customer",
  "sample",
  "test",
  "owner-use",
] as const;

export type OrderClassification = (typeof ORDER_CLASSIFICATIONS)[number];

export const CLASSIFICATION_INFO: Record<
  OrderClassification,
  {
    label: string;
    description: string;
    countsAsRevenue: boolean;
    accountingNote: string;
  }
> = {
  customer: {
    label: "Customer",
    description: "Real third-party paid order",
    countsAsRevenue: true,
    accountingNote: "Revenue + COGS + Stripe fees",
  },
  sample: {
    label: "Sample",
    description: "Founder order to check print quality, photograph product, or evaluate a design",
    countsAsRevenue: false,
    accountingNote: "COGS as business expense (no revenue recognized)",
  },
  test: {
    label: "Test",
    description: "System/pipeline verification, bogus gateway, immediately canceled",
    countsAsRevenue: false,
    accountingNote: "No financial impact (exclude from reports)",
  },
  "owner-use": {
    label: "Owner Use",
    description: "Founder bought product for personal use",
    countsAsRevenue: false,
    accountingNote: "Owner's draw (not a business expense, not revenue)",
  },
};

export const FUTURE_CLASSIFICATIONS = [
  "gift",
  "comp",
  "replacement",
  "return",
  "exchange",
  "wholesale",
] as const;
