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
  type: "shirt" | "phone-case";
  printfulProductId: number;
  /** Base cost by size. Use "*" as default for all sizes. */
  baseCost: Record<string, number>;
  sizes: string[];
  /** Label for the size selector. Defaults to "Size" if omitted. */
  sizeLabel?: string;
  colors: ProductColor[];
  variants: Record<string, Record<string, number>>; // color → size → variantId
  mockupPosition: MockupPosition;
  /** Physical print area dimensions in inches, for display. */
  printArea: { width: number; height: number };
};

export const PRODUCTS: Product[] = [
  {
    id: "bella-canvas-3001",
    name: "Classic Tee",
    description: "Unisex classic fit",
    type: "shirt",
    printfulProductId: 71,
    baseCost: { "*": 12.95 },
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
    printArea: { width: 12, height: 16 },
  },
  {
    id: "cotton-heritage-mc1087",
    name: "Box Tee",
    description: "Oversized box fit, drop shoulder",
    type: "shirt",
    printfulProductId: 917,
    baseCost: {
      S: 17.45, M: 17.45, L: 17.45, XL: 17.45,
      "2XL": 19.45, "3XL": 21.45, "4XL": 23.45,
    },
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
    printArea: { width: 12, height: 16 },
  },
  {
    id: "bella-canvas-6400",
    name: "Women's Relaxed Tee",
    description: "Women's relaxed fit",
    type: "shirt",
    printfulProductId: 360,
    baseCost: {
      S: 13.69, M: 13.69, L: 13.69, XL: 13.69, "2XL": 15.69, "3XL": 17.69,
    },
    sizes: ["S", "M", "L", "XL", "2XL", "3XL"],
    colors: [
      { name: "White", value: "#ffffff" },
      { name: "Black", value: "#0c0c0c" },
      { name: "Natural", value: "#fef1d1" },
      { name: "Vintage White", value: "#fcf4e8" },
      { name: "Athletic Heather", value: "#c8c8c8" },
      { name: "Dark Grey Heather", value: "#4a4a4a" },
      { name: "Navy", value: "#1c2340" },
      { name: "Maroon", value: "#5c1a2a" },
      { name: "Forest Green", value: "#2d4a2e" },
      { name: "Military Green", value: "#5e6e4a" },
      { name: "Sage", value: "#9eab96" },
      { name: "Leaf", value: "#5b8c3e" },
      { name: "Mauve", value: "#c9a0b0" },
      { name: "Heather Mauve", value: "#b98da0" },
      { name: "Pink", value: "#f4c2c2" },
      { name: "Light Violet", value: "#c5a3cf" },
      { name: "Heather Blue Lagoon", value: "#5a9eaf" },
      { name: "Heather Deep Teal", value: "#3a6e6e" },
      { name: "Heather Navy", value: "#3a4a6e" },
      { name: "Heather True Royal", value: "#4169aa" },
      { name: "Heather Red", value: "#b84a4a" },
      { name: "Heather Stone", value: "#b8aa96" },
    ],
    variants: {
      White: { S: 10252, M: 10253, L: 10254, XL: 10255, "2XL": 10256, "3XL": 10257 },
      Black: { S: 10187, M: 10188, L: 10189, XL: 10190, "2XL": 10191, "3XL": 10192 },
      Natural: { S: 46501, M: 46502, L: 46503, XL: 46504, "2XL": 46505, "3XL": 46506 },
      "Vintage White": { S: 46513, M: 46514, L: 46515, XL: 46516, "2XL": 46517, "3XL": 46518 },
      "Athletic Heather": { S: 10176, M: 10177, L: 10178, XL: 10179, "2XL": 10180, "3XL": 10181 },
      "Dark Grey Heather": { S: 10193, M: 10194, L: 10195, XL: 10196, "2XL": 10197, "3XL": 10198 },
      Navy: { S: 10235, M: 10236, L: 10237, XL: 10238, "2XL": 10239, "3XL": 10240 },
      Maroon: { S: 10230, M: 10231, L: 10232, XL: 10233, "2XL": 10234, "3XL": 46519 },
      "Forest Green": { S: 46520, M: 46521, L: 46522, XL: 46523, "2XL": 46524, "3XL": 46525 },
      "Military Green": { S: 46532, M: 46533, L: 46534, XL: 46535, "2XL": 46536, "3XL": 46537 },
      Sage: { S: 46526, M: 46527, L: 46528, XL: 46529, "2XL": 46530, "3XL": 46531 },
      Leaf: { S: 10225, M: 10226, L: 10227, XL: 10228, "2XL": 10229, "3XL": 14285 },
      Mauve: { S: 46507, M: 46508, L: 46509, XL: 46510, "2XL": 46511, "3XL": 46512 },
      "Heather Mauve": { S: 10205, M: 10206, L: 10207, XL: 10208, "2XL": 10209, "3XL": 13424 },
      Pink: { S: 10241, M: 10242, L: 10243, XL: 10244, "2XL": 10245, "3XL": 14158 },
      "Light Violet": { S: 46538, M: 46539, L: 46540, XL: 46541, "2XL": 46542, "3XL": 46543 },
      "Heather Blue Lagoon": { S: 14258, M: 14259, L: 14260, XL: 14261, "2XL": 14262, "3XL": 14286 },
      "Heather Deep Teal": { S: 46550, M: 46551, L: 46552, XL: 46553, "2XL": 46554, "3XL": 46555 },
      "Heather Navy": { S: 46544, M: 46545, L: 46546, XL: 46547, "2XL": 46548, "3XL": 46549 },
      "Heather True Royal": { S: 46556, M: 46557, L: 46558, XL: 46559, "2XL": 46560, "3XL": 46561 },
      "Heather Red": { S: 14268, M: 14269, L: 14270, XL: 14271, "2XL": 14272, "3XL": 14288 },
      "Heather Stone": { S: 14273, M: 14274, L: 14275, XL: 14276, "2XL": 14277, "3XL": 14289 },
    },
    mockupPosition: {
      area_width: 1500,
      area_height: 1800,
      width: 1138,
      height: 1368,
      top: 372,
      left: 930,
    },
    printArea: { width: 10, height: 12 },
  },
  {
    id: "clear-case-iphone",
    name: "Clear iPhone Case",
    description: "Clear snap-on case, glossy finish",
    type: "phone-case",
    printfulProductId: 181,
    sizeLabel: "Model",
    baseCost: {
      "*": 9.38,
      "iPhone 14": 10.95, "iPhone 14 Plus": 10.95,
      "iPhone 14 Pro": 10.95, "iPhone 14 Pro Max": 10.95,
    },
    sizes: [
      "iPhone 17 Pro Max", "iPhone 17 Pro", "iPhone 17 Air", "iPhone 17",
      "iPhone 16 Pro Max", "iPhone 16 Pro", "iPhone 16 Plus", "iPhone 16",
      "iPhone 15 Pro Max", "iPhone 15 Pro", "iPhone 15 Plus", "iPhone 15",
      "iPhone SE",
    ],
    colors: [
      { name: "Clear", value: "#f0f0f0" },
    ],
    variants: {
      Clear: {
        "iPhone 17 Pro Max": 33996, "iPhone 17 Pro": 33995, "iPhone 17 Air": 33994, "iPhone 17": 33993,
        "iPhone 16 Pro Max": 20293, "iPhone 16 Pro": 20292, "iPhone 16 Plus": 20291, "iPhone 16": 20290,
        "iPhone 15 Pro Max": 17619, "iPhone 15 Pro": 17618, "iPhone 15 Plus": 17617, "iPhone 15": 17616,
        "iPhone SE": 11452,
      },
    },
    mockupPosition: {
      area_width: 879,
      area_height: 1830,
      width: 879,
      height: 1830,
      top: 0,
      left: 0,
    },
    printArea: { width: 2.5, height: 5.2 },
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

/**
 * Look up the hex value for a color on a given product. Falls back to a
 * neutral light gray when the product or color isn't found, so list views
 * always have something usable to render against.
 */
export function getColorHex(productId: string | null | undefined, colorName: string | null | undefined): string {
  const FALLBACK = "#e5e5e5";
  if (!productId || !colorName) return FALLBACK;
  const product = getProduct(productId);
  const color = product?.colors.find((c) => c.name === colorName);
  return color?.value ?? FALLBACK;
}
