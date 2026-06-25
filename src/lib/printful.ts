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

/**
 * Map our internal placement key to Printful's order-file `type`. Front keeps
 * the production-proven "default" type (the main print area); other placements
 * pass their key through unchanged ("back" → "back", "label_inside" →
 * "label_inside"). Note this differs from the mockup-generator API, which keys
 * files by `placement` and accepts "front" literally.
 */
function placementToOrderFileType(placement: string): string {
  return placement === "front" ? "default" : placement;
}

export type PrintfulOrderItem = {
  variantId: number;
  quantity: number;
  files: { placement: string; url: string }[];
};

export async function createOrder(params: {
  // One print file per placement. `designImageUrl` is the back-compat alias
  // for a single front file; callers that only print the front can keep using
  // it. Multi-placement callers (#25) pass `files`.
  files?: { placement: string; url: string }[];
  designImageUrl?: string;
  // Multi-item cart (#26): a full array of line items. When present it takes
  // precedence over the single-item fields below.
  items?: PrintfulOrderItem[];
  size?: string;
  color?: string;
  variantId?: number;
  recipientName: string;
  address1: string;
  address2?: string;
  city: string;
  stateCode: string;
  countryCode: string;
  zip: string;
}) {
  // Build the line-item array. Multi-item callers pass `items`; single-item
  // callers pass variantId + files (or the designImageUrl alias).
  let items: PrintfulOrderItem[];
  if (params.items && params.items.length > 0) {
    items = params.items;
  } else {
    const files =
      params.files ??
      (params.designImageUrl
        ? [{ placement: "front", url: params.designImageUrl }]
        : []);
    if (files.length === 0 || params.variantId == null) {
      throw new Error("createOrder: no print files / variant supplied");
    }
    items = [{ variantId: params.variantId, quantity: 1, files }];
  }

  if (process.env.PRINTFUL_DRY_RUN === "true") {
    const fakeId = `dry-run-${crypto.randomUUID()}`;
    console.warn(
      `[PRINTFUL_DRY_RUN] Skipping real order submission. Returning fake id=${fakeId} for ${params.recipientName} items=${items.map((it) => `${it.variantId}×${it.quantity}[${it.files.map((f) => f.placement).join(",")}]`).join(" ")}`
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
      items: items.map((it) => ({
        variant_id: it.variantId,
        quantity: it.quantity,
        files: it.files.map((f) => ({
          type: placementToOrderFileType(f.placement),
          url: f.url,
        })),
      })),
    }),
  });

  return data.result;
}

export async function getOrderStatus(orderId: string) {
  const data = await printfulFetch(`/orders/${orderId}`);
  return data.result;
}

export type EstimatedCosts = {
  subtotal: number;
  shipping: number;
  tax: number;
  total: number;
};

/**
 * Parse the `costs` block from a /orders/estimate-costs response into numbers.
 * Pure (no network) so it's unit-testable; Printful returns the amounts as
 * strings. Missing fields default to 0.
 */
export function parseEstimateCosts(result: {
  costs?: Record<string, string | number | undefined>;
}): EstimatedCosts {
  const c = result.costs ?? {};
  const num = (v: string | number | undefined) =>
    v == null ? 0 : typeof v === "number" ? v : parseFloat(v) || 0;
  return {
    subtotal: num(c.subtotal),
    shipping: num(c.shipping),
    tax: num(c.tax),
    total: num(c.total),
  };
}

/**
 * Live cost estimate for an order of N items at a destination — including the
 * bundled shipping total (2nd+ item ships much cheaper in the same shipment),
 * which is the savings the cart surfaces (#26). `items` mirror createOrder's
 * shape (variant + per-placement files). Returns null in dry-run / on error so
 * callers fall back to the flat estimate (estimateShipping).
 */
export async function estimateOrderCosts(params: {
  recipient: {
    countryCode: string;
    stateCode?: string;
    zip?: string;
    city?: string;
    address1?: string;
  };
  items: {
    variantId: number;
    quantity: number;
    files?: { placement: string; url: string }[];
  }[];
}): Promise<EstimatedCosts | null> {
  if (params.items.length === 0) return null;
  if (process.env.PRINTFUL_DRY_RUN === "true") return null;

  try {
    const data = await printfulFetch("/orders/estimate-costs", {
      method: "POST",
      body: JSON.stringify({
        recipient: {
          country_code: params.recipient.countryCode,
          state_code: params.recipient.stateCode ?? "",
          zip: params.recipient.zip ?? "",
          city: params.recipient.city ?? "",
          address1: params.recipient.address1 ?? "",
        },
        items: params.items.map((it) => ({
          variant_id: it.variantId,
          quantity: it.quantity,
          ...(it.files
            ? {
                files: it.files.map((f) => ({
                  type: placementToOrderFileType(f.placement),
                  url: f.url,
                })),
              }
            : {}),
        })),
      }),
    });
    return parseEstimateCosts(data.result ?? {});
  } catch (err) {
    console.error("estimateOrderCosts failed, falling back to flat shipping:", err);
    return null;
  }
}

// -- Mockup Generator --

import type { MockupPosition } from "./blanks";

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
