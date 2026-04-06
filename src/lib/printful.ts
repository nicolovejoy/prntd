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
  const confirm = process.env.PRINTFUL_AUTO_CONFIRM !== "false";
  const data = await printfulFetch(`/orders${confirm ? "?confirm=true" : ""}`, {
    method: "POST",
    body: JSON.stringify({
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
};

export const PRINTFUL_BASE_COST = 12.95;
export const PREMIUM_UPCHARGE = 5.0;

export const BELLA_CANVAS_PRODUCT_ID = 71;

// -- Mockup Generator --

export async function createMockupTask(
  variantId: number,
  designImageUrl: string
): Promise<string> {
  const data = await printfulFetch(
    `/mockup-generator/create-task/${BELLA_CANVAS_PRODUCT_ID}`,
    {
      method: "POST",
      body: JSON.stringify({
        variant_ids: [variantId],
        format: "jpg",
        files: [
          {
            placement: "front",
            image_url: designImageUrl,
            position: {
              area_width: 1800,
              area_height: 2400,
              width: 1800,
              height: 1800,
              top: 300,
              left: 0,
            },
          },
        ],
      }),
    }
  );
  return data.result.task_key;
}

export async function pollMockupTask(
  taskKey: string,
  { intervalMs = 2000, timeoutMs = 30000 } = {}
): Promise<{ mockupUrl: string; extraUrls: string[] }> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const data = await printfulFetch(
      `/mockup-generator/task?task_key=${taskKey}`
    );
    const result = data.result;

    if (result.status === "completed") {
      const mockup = result.mockups?.[0];
      if (!mockup?.mockup_url) throw new Error("Mockup completed but no URL");
      return {
        mockupUrl: mockup.mockup_url,
        extraUrls: mockup.extra?.map((e: { url: string }) => e.url) ?? [],
      };
    }

    if (result.status === "failed") {
      throw new Error(`Mockup generation failed: ${result.error ?? "unknown"}`);
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error("Mockup generation timed out");
}
