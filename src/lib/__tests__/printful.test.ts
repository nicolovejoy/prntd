import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createOrder } from "../printful";

const params = {
  designImageUrl: "https://example.com/img.png",
  size: "M",
  color: "Black",
  variantId: 4012,
  recipientName: "Test User",
  address1: "1 Test St",
  city: "Seattle",
  stateCode: "WA",
  countryCode: "US",
  zip: "98101",
};

describe("createOrder PRINTFUL_DRY_RUN", () => {
  const originalFlag = process.env.PRINTFUL_DRY_RUN;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch");
  });

  afterEach(() => {
    process.env.PRINTFUL_DRY_RUN = originalFlag;
    fetchSpy.mockRestore();
  });

  it("does not call fetch when flag is true", async () => {
    process.env.PRINTFUL_DRY_RUN = "true";
    await createOrder(params);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns a shape callers expect (id, costs.total, status)", async () => {
    process.env.PRINTFUL_DRY_RUN = "true";
    const result = await createOrder(params);
    expect(result.id).toMatch(/^dry-run-/);
    expect(result.status).toBe("draft");
    expect(result.costs?.total).toBe("0.00");
  });

  it("calls fetch when flag is unset", async () => {
    delete process.env.PRINTFUL_DRY_RUN;
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ result: { id: 1, costs: { total: "5.00" } } }), {
        status: 200,
      })
    );
    await createOrder(params);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("calls fetch when flag is the string 'false'", async () => {
    process.env.PRINTFUL_DRY_RUN = "false";
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ result: { id: 1, costs: { total: "5.00" } } }), {
        status: 200,
      })
    );
    await createOrder(params);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });
});
