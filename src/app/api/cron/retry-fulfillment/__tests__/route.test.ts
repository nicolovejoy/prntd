// @vitest-environment node
/**
 * Auth-gate tests for the retry-fulfillment cron route (WP5). The sweep core
 * (retryStuckFulfillments) is real-DB tested in
 * src/lib/__tests__/retry-fulfillment.integration.test.ts; here it's mocked so
 * these tests exercise only the route's Bearer contract.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/printful", () => ({
  createOrder: vi.fn(),
  getOrderByExternalId: vi.fn(),
}));
vi.mock("@/lib/ai", () => ({ generateOrderName: vi.fn() }));
vi.mock("@/lib/design-images", () => ({
  getDesignDisplayImageUrl: vi.fn(),
  getDesignImageById: vi.fn(),
}));
vi.mock("@/lib/retry-fulfillment", () => ({
  retryStuckFulfillments: vi.fn(),
}));

import { GET } from "../route";
import { retryStuckFulfillments } from "@/lib/retry-fulfillment";

const coreMock = vi.mocked(retryStuckFulfillments);
const originalSecret = process.env.CRON_SECRET;

function request(authorization?: string) {
  return new NextRequest("http://localhost/api/cron/retry-fulfillment", {
    method: "GET",
    headers: authorization ? { authorization } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "cron-secret-wp5";
  coreMock.mockResolvedValue({ scanned: 0, results: [] });
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalSecret;
});

describe("cron retry-fulfillment route — auth gate", () => {
  it("500s when CRON_SECRET is not configured (misconfiguration, not an open door)", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(request("Bearer anything"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Not configured" });
    expect(coreMock).not.toHaveBeenCalled();
  });

  it("401s with no Authorization header", async () => {
    const res = await GET(request());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(coreMock).not.toHaveBeenCalled();
  });

  it("401s on a wrong bearer token", async () => {
    const res = await GET(request("Bearer wrong-secret"));
    expect(res.status).toBe(401);
    expect(coreMock).not.toHaveBeenCalled();
  });

  it("401s when the secret is sent without the Bearer prefix", async () => {
    const res = await GET(request("cron-secret-wp5"));
    expect(res.status).toBe(401);
    expect(coreMock).not.toHaveBeenCalled();
  });

  it("runs the sweep and returns its result on the correct Bearer secret", async () => {
    coreMock.mockResolvedValue({
      scanned: 2,
      results: [
        { orderId: "o1", action: "submitted" },
        { orderId: "o2", action: "error" },
      ],
    });

    const res = await GET(request("Bearer cron-secret-wp5"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      scanned: 2,
      results: [
        { orderId: "o1", action: "submitted" },
        { orderId: "o2", action: "error" },
      ],
    });
    expect(coreMock).toHaveBeenCalledTimes(1);
    // The route wires the shared fulfillment deps (db + Printful + naming +
    // image resolution) into the core.
    const deps = coreMock.mock.calls[0][0];
    expect(deps).toHaveProperty("db");
    expect(deps).toHaveProperty("createPrintfulOrder");
    expect(deps).toHaveProperty("getPrintfulOrderByExternalId");
  });
});
