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
  if (process.env.PRINTFUL_DRY_RUN === "true") {
    const fakeId = `dry-run-${crypto.randomUUID()}`;
    console.warn(
      `[PRINTFUL_DRY_RUN] Skipping real order submission. Returning fake id=${fakeId} for ${params.recipientName} variant=${params.variantId}`
    );
    return {
      id: fakeId,
      status: "draft",
      costs: { total: "0.00" },
      dryRun: true,
    };
  }

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

/**
 * Submit a mockup-generator task. `variantIds` is an array — Printful
 * renders one mockup per variant in a single task, which is how we batch
 * the prefetch fan-out into a single API call.
 */
export async function createMockupTask(
  printfulProductId: number,
  variantIds: number[],
  designImageUrl: string,
  mockupPosition: MockupPosition,
  placement: string
): Promise<string> {
  const data = await printfulFetch(
    `/mockup-generator/create-task/${printfulProductId}`,
    {
      method: "POST",
      body: JSON.stringify({
        variant_ids: variantIds,
        format: "jpg",
        files: [
          {
            placement,
            image_url: designImageUrl,
            position: mockupPosition,
          },
        ],
      }),
    }
  );
  return data.result.task_key;
}

export type MockupResult = {
  variantIds: number[];
  mockupUrl: string;
};

/**
 * Poll a mockup task until completion. Returns one entry per rendered
 * mockup; each entry's `variantIds` tells the caller which variants the
 * URL applies to (Printful groups variants that render to identical
 * mockups, so a single URL can map to multiple variant IDs).
 */
export async function pollMockupTask(
  taskKey: string,
  { intervalMs = 2000, timeoutMs = 55000 } = {}
): Promise<MockupResult[]> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const data = await printfulFetch(
      `/mockup-generator/task?task_key=${taskKey}`
    );
    const result = data.result;

    if (result.status === "completed") {
      const mockups = (result.mockups ?? []) as Array<{
        variant_ids: number[];
        mockup_url: string;
      }>;
      if (mockups.length === 0) {
        throw new Error("Mockup completed but no URLs");
      }
      return mockups.map((m) => ({
        variantIds: m.variant_ids,
        mockupUrl: m.mockup_url,
      }));
    }

    if (result.status === "failed") {
      throw new Error(`Mockup generation failed: ${result.error ?? "unknown"}`);
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error("Mockup generation timed out");
}
