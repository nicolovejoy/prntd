const PRINTFUL_API = "https://api.printful.com";

async function printfulFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${PRINTFUL_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.PRINTFUL_API_KEY}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Printful API error: ${res.status} ${error}`);
  }

  return res.json();
}

export async function getProducts() {
  const data = await printfulFetch("/store/products");
  return data.result;
}

export async function createOrder(params: {
  designImageUrl: string;
  size: string;
  color: string;
  variantId: number;
  recipientName: string;
  address1: string;
  address2?: string;
  city: string;
  stateCode: string;
  countryCode: string;
  zip: string;
}) {
  const data = await printfulFetch("/orders", {
    method: "POST",
    body: JSON.stringify({
      confirm: false,
      recipient: {
        name: params.recipientName,
        address1: params.address1,
        address2: params.address2 ?? "",
        city: params.city,
        state_code: params.stateCode,
        country_code: params.countryCode,
        zip: params.zip,
      },
      items: [
        {
          variant_id: params.variantId,
          quantity: 1,
          files: [
            {
              type: "default",
              url: params.designImageUrl,
            },
          ],
        },
      ],
    }),
  });

  return data.result;
}

export async function getOrderStatus(orderId: string) {
  const data = await printfulFetch(`/orders/${orderId}`);
  return data.result;
}

// Printful variant IDs for Bella+Canvas 3001 Unisex Tee
// Fetched from Printful API 2026-03-26 via scripts/fetch-variants.ts
export const TSHIRT_VARIANTS: Record<string, Record<string, number>> = {
  White: { S: 4011, M: 4012, L: 4013, XL: 4014, "2XL": 4015 },
  Black: { S: 4016, M: 4017, L: 4018, XL: 4019, "2XL": 4020 },
  Navy: { S: 4111, M: 4112, L: 4113, XL: 4114, "2XL": 4115 },
  "Dark Grey Heather": { S: 8460, M: 8461, L: 8462, XL: 8463, "2XL": 8464 },
  Red: { S: 4141, M: 4142, L: 4143, XL: 4144, "2XL": 4145 },
  "True Royal": { S: 4171, M: 4172, L: 4173, XL: 4174, "2XL": 4175 },
  Forest: { S: 8451, M: 8452, L: 8453, XL: 8454, "2XL": 8455 },
  Maroon: { S: 4106, M: 4107, L: 4108, XL: 4109, "2XL": 4110 },
  "Heather Mauve": { S: 18635, M: 18636, L: 18637, XL: 18638, "2XL": 18639 },
  "Soft Cream": { S: 4151, M: 4152, L: 4153, XL: 4154, "2XL": 4155 },
  "Steel Blue": { S: 4161, M: 4162, L: 4163, XL: 4164, "2XL": 4165 },
  Olive: { S: 4121, M: 4122, L: 4123, XL: 4124, "2XL": 4125 },
  Gold: { S: 4081, M: 4082, L: 4083, XL: 4084, "2XL": 4085 },
  "Athletic Heather": { S: 6948, M: 6949, L: 6950, XL: 6951, "2XL": 6952 },
};

export const PRINTFUL_BASE_COST = 12.95;
export const PREMIUM_UPCHARGE = 5.0;
