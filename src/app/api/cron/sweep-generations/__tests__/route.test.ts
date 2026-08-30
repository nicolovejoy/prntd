// @vitest-environment node
/**
 * Auth-gate tests for the sweep-generations cron route. The sweep core
 * (sweepOrphanedGenerations) is real-DB tested in
 * src/lib/__tests__/sweep-generations.integration.test.ts; here it's mocked
 * so these tests exercise only the route's Bearer contract — mirrors
 * src/app/api/cron/retry-fulfillment/__tests__/route.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/sweep-generations", () => ({
  sweepOrphanedGenerations: vi.fn(),
  defaultSweepGenerationsDeps: {},
}));

import { GET } from "../route";
import { sweepOrphanedGenerations } from "@/lib/sweep-generations";

const coreMock = vi.mocked(sweepOrphanedGenerations);
const originalSecret = process.env.CRON_SECRET;

function request(authorization?: string) {
  return new NextRequest("http://localhost/api/cron/sweep-generations", {
    method: "GET",
    headers: authorization ? { authorization } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "cron-secret-sweep";
  coreMock.mockResolvedValue({ scanned: 0, failed: 0, reclaimed: 0, skipped: 0, reclaimErrors: 0 });
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalSecret;
});

describe("cron sweep-generations route — auth gate", () => {
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
    const res = await GET(request("cron-secret-sweep"));
    expect(res.status).toBe(401);
    expect(coreMock).not.toHaveBeenCalled();
  });

  it("runs the sweep and returns its result on the correct Bearer secret", async () => {
    coreMock.mockResolvedValue({ scanned: 3, failed: 2, reclaimed: 2, skipped: 0, reclaimErrors: 0 });

    const res = await GET(request("Bearer cron-secret-sweep"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ scanned: 3, failed: 2, reclaimed: 2, skipped: 0, reclaimErrors: 0 });
    expect(coreMock).toHaveBeenCalledTimes(1);
  });
});
