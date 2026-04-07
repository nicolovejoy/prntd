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

// -- Mockup Generator --

import type { MockupPosition } from "./products";

export async function createMockupTask(
  printfulProductId: number,
  variantId: number,
  designImageUrl: string,
  mockupPosition: MockupPosition
): Promise<string> {
  const data = await printfulFetch(
    `/mockup-generator/create-task/${printfulProductId}`,
    {
      method: "POST",
      body: JSON.stringify({
        variant_ids: [variantId],
        format: "jpg",
        files: [
          {
            placement: "front",
            image_url: designImageUrl,
            position: mockupPosition,
          },
        ],
      }),
    }
  );
  return data.result.task_key;
}

export async function pollMockupTask(
  taskKey: string,
  { intervalMs = 2000, timeoutMs = 90000 } = {}
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
