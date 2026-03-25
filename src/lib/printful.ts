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
  city: string;
  stateCode: string;
  countryCode: string;
  zip: string;
}) {
  const data = await printfulFetch("/orders", {
    method: "POST",
    body: JSON.stringify({
      recipient: {
        name: params.recipientName,
        address1: params.address1,
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

// Printful t-shirt variant IDs for Bella+Canvas 3001 (common unisex tee)
// These are approximate — should be fetched from API for production
export const TSHIRT_VARIANTS: Record<string, Record<string, number>> = {
  White: { S: 4011, M: 4012, L: 4013, XL: 4014, "2XL": 4015 },
  Black: { S: 4016, M: 4017, L: 4018, XL: 4019, "2XL": 4020 },
  Navy: { S: 4021, M: 4022, L: 4023, XL: 4024, "2XL": 4025 },
  "Dark Heather": { S: 4026, M: 4027, L: 4028, XL: 4029, "2XL": 4030 },
};

export const PRINTFUL_BASE_COST = 12.95;
export const PREMIUM_UPCHARGE = 5.0;
