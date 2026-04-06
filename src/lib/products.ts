/**
 * Product catalog — config-driven definitions for all products.
 *
 * To add a new product:
 * 1. Run the variant discovery script to get Printful variant IDs
 * 2. Add a new entry to PRODUCTS below
 * 3. That's it — preview, order, and checkout flows pick it up automatically
 */

export type ProductColor = {
  name: string;
  value: string; // hex
};

export type MockupPosition = {
  area_width: number;
  area_height: number;
  width: number;
  height: number;
  top: number;
  left: number;
};

export type Product = {
  id: string;
  name: string;
  description: string;
  printfulProductId: number;
  /** Base cost by size. Use "*" as default for all sizes. */
  baseCost: Record<string, number>;
  premiumUpcharge: number;
  sizes: string[];
  colors: ProductColor[];
  variants: Record<string, Record<string, number>>; // color → size → variantId
  mockupPosition: MockupPosition;
};

export const PRODUCTS: Product[] = [
  {
    id: "bella-canvas-3001",
    name: "Classic Tee",
    description: "Unisex classic fit",
    printfulProductId: 71,
    baseCost: { "*": 12.95 },
    premiumUpcharge: 5.0,
    sizes: ["S", "M", "L", "XL", "2XL"],
    colors: [
      { name: "White", value: "#ffffff" },
      { name: "Black", value: "#0c0c0c" },
      { name: "Dark Grey", value: "#2A2929" },
      { name: "Natural", value: "#fef1d1" },
      { name: "Tan", value: "#ddb792" },
      { name: "Soft Cream", value: "#e7d4c0" },
      { name: "Pebble", value: "#9a8479" },
      { name: "Heather Dust", value: "#e5d9c9" },
      { name: "Vintage White", value: "#fcf4e8" },
      { name: "Aqua", value: "#008db5" },
      { name: "Burnt Orange", value: "#ed8043" },
      { name: "Mustard", value: "#eda027" },
      { name: "Sage", value: "#9eab96" },
    ],
    variants: {
      White: { S: 4011, M: 4012, L: 4013, XL: 4014, "2XL": 4015 },
      Black: { S: 4016, M: 4017, L: 4018, XL: 4019, "2XL": 4020 },
      "Dark Grey": { S: 21578, M: 21579, L: 21580, XL: 21581, "2XL": 21582 },
      Natural: { S: 14682, M: 14683, L: 14684, XL: 14685, "2XL": 14686 },
      Tan: { S: 14674, M: 14675, L: 14676, XL: 14677, "2XL": 14678 },
      "Soft Cream": { S: 4151, M: 4152, L: 4153, XL: 4154, "2XL": 4155 },
      Pebble: { S: 4131, M: 4132, L: 4133, XL: 4134, "2XL": 4135 },
      "Heather Dust": { S: 10360, M: 10361, L: 10362, XL: 10363, "2XL": 10364 },
      "Vintage White": { S: 14714, M: 14715, L: 14716, XL: 14717, "2XL": 14718 },
      Aqua: { S: 4021, M: 4022, L: 4023, XL: 4024, "2XL": 4025 },
      "Burnt Orange": { S: 4051, M: 4052, L: 4053, XL: 4054, "2XL": 4055 },
      Mustard: { S: 10376, M: 10377, L: 10378, XL: 10379, "2XL": 10380 },
      Sage: { S: 22050, M: 22051, L: 22052, XL: 22053, "2XL": 22054 },
    },
    mockupPosition: {
      area_width: 1800,
      area_height: 2400,
      width: 1800,
      height: 1800,
      top: 300,
      left: 0,
    },
  },
  {
    id: "cotton-heritage-mc1087",
    name: "Box Tee",
    description: "Oversized box fit, drop shoulder",
    printfulProductId: 917,
    baseCost: {
      S: 17.45, M: 17.45, L: 17.45, XL: 17.45,
      "2XL": 19.45, "3XL": 21.45, "4XL": 23.45,
    },
    premiumUpcharge: 5.0,
    sizes: ["S", "M", "L", "XL", "2XL", "3XL", "4XL"],
    colors: [
      // Placeholder hex values — will refine after variant discovery
      { name: "White", value: "#ffffff" },
      { name: "Black", value: "#0c0c0c" },
      { name: "Navy Blazer", value: "#202d4c" },
      { name: "Vintage Black", value: "#3a3a3a" },
      { name: "Vintage White", value: "#f5f0e8" },
    ],
    variants: {
      Black: { S: 23577, M: 23578, L: 23579, XL: 23580, "2XL": 23581, "3XL": 23582, "4XL": 23583 },
      "Navy Blazer": { S: 23584, M: 23585, L: 23586, XL: 23587, "2XL": 23588, "3XL": 23589, "4XL": 23590 },
      "Vintage Black": { S: 23591, M: 23592, L: 23593, XL: 23594, "2XL": 23595, "3XL": 23596, "4XL": 23597 },
      "Vintage White": { S: 23598, M: 23599, L: 23600, XL: 23601, "2XL": 23602, "3XL": 23603, "4XL": 23604 },
      White: { S: 23605, M: 23606, L: 23607, XL: 23608, "2XL": 23609, "3XL": 23610, "4XL": 23611 },
    },
    mockupPosition: {
      area_width: 1800,
      area_height: 2400,
      width: 1800,
      height: 1800,
      top: 300,
      left: 0,
    },
  },
];

export const DEFAULT_PRODUCT_ID = "bella-canvas-3001";

export function getProduct(id: string): Product | undefined {
  return PRODUCTS.find((p) => p.id === id);
}

export function getProductOrThrow(id: string): Product {
  const product = getProduct(id);
  if (!product) throw new Error(`Unknown product: ${id}`);
  return product;
}

/** Look up the base cost for a specific size (handles per-size and flat pricing). */
export function getBaseCost(product: Product, size: string): number {
  return product.baseCost[size] ?? product.baseCost["*"] ?? 0;
}

/** Look up a Printful variant ID for a product/color/size combo. */
export function getVariantId(
  product: Product,
  color: string,
  size: string
): number | undefined {
  return product.variants[color]?.[size];
}
